import { app, dialog, ipcMain, Menu, powerMonitor, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { PopupChannels } from '../shared/popup-channels';
import {
  CHAT_MESSAGE_MAX,
  IpcChannels,
  type AppState,
  type ConnectionState,
  type DpAttachment,
  type EmployeeProfile,
  type EmployeeState,
  type OperationResult,
  type SettingsView,
} from '../shared/types';
import { ApiClient, ApiError } from './api-client';
import { ChatStore } from './chat-store';
import { getComputerIdentity } from './computer-identity';
import { loadConfig, normalizeServerUrl, saveConfig } from './config';
import { ServerConnection } from './connection';
import { setupFileLogging } from './logger';
import { MessageStore } from './message-store';
import { ATTACHMENT_ID_REGEX, MESSAGE_ID_REGEX, UUID_REGEX } from './message-validation';
import { PopupManager } from './popup-manager';
import { AppTray, loadIcon } from './tray';
import { createMainWindow, createPopupWindow } from './windows';

const APP_ID = 'br.com.empresa.comunicacaodp';
/** Mensagens mais antigas que isso, que chegaram com o PC desligado, entram na lista sem popup */
const POPUP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Iniciado pelo Windows no login: fica só na bandeja */
const startHidden = process.argv.includes('--hidden');

const CONNECTION_LABELS: Record<ConnectionState['status'], string> = {
  connecting: '🟡 Conectando...',
  connected: '🟢 Conectado ao servidor',
  reconnecting: '🟡 Reconectando...',
  disconnected: '🔴 Servidor indisponível',
  'not-configured': '⚪ Servidor não configurado',
  unauthorized: '🔴 Registro não autorizado',
};

const OFFLINE_RESULT: OperationResult = {
  ok: false,
  message: 'Sem conexão com o servidor. Tente novamente quando o status estiver 🟢 Conectado.',
};

let mainWindow: BrowserWindow | null = null;
let quitting = false;

/** Texto de entrada vindo da interface: string aparada, dentro do tamanho, ou null */
function boundedText(value: unknown, max: number, trim = true): string | null {
  if (typeof value !== 'string') return null;
  const text = trim ? value.trim() : value;
  return text.length > 0 && text.length <= max ? text : null;
}

function isMessageId(value: unknown): value is string {
  return typeof value === 'string' && MESSAGE_ID_REGEX.test(value);
}

/** ID de uma pessoa do DP (contato do chat) */
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_ID_REGEX.test(value);
}

/** Só as telas do próprio app (arquivo local, ou o servidor do Vite em desenvolvimento) podem chamar o IPC */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  if (url.startsWith('file://')) return true;
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
  return Boolean(devUrl && url.startsWith(devUrl));
}

/** ipcMain.handle com checagem de origem */
function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) {
      console.warn(`[ipc] chamada recusada em ${channel} vinda de ${event.senderFrame?.url ?? '(desconhecido)'}`);
      throw new Error('Origem não autorizada');
    }
    return handler(...args);
  });
}

/** Registra (ou remove) o início automático com o Windows. Só no aplicativo instalado. */
function applyAutoStart(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

async function testServer(rawUrl: unknown): Promise<OperationResult> {
  const serverUrl = typeof rawUrl === 'string' ? normalizeServerUrl(rawUrl) : null;
  if (!serverUrl) return { ok: false, message: 'Endereço inválido. Use o formato http://IP:PORTA' };
  try {
    const response = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(5_000) });
    const body = (await response.json().catch(() => ({}))) as { status?: string; service?: string };
    if (response.ok && body.status === 'ok' && body.service === 'sistema-dp-backend') {
      return { ok: true, message: `Servidor respondeu corretamente (${serverUrl}).` };
    }
    return { ok: false, message: 'O endereço respondeu, mas não é o servidor do Comunicação DP.' };
  } catch {
    return { ok: false, message: `Não foi possível conectar em ${serverUrl}. Verifique o endereço e a rede.` };
  }
}

/**
 * O Node embutido no Electron confia só nas CAs públicas que traz consigo. Para o HTTPS com
 * certificado da CA interna da empresa (AD CS) funcionar, inclui também as CAs do repositório do Windows.
 * Vale para fetch (API) e WebSocket. Precisa rodar antes de qualquer conexão.
 */
function trustSystemCertificates(): void {
  const api = tls as unknown as {
    getCACertificates?: (type: 'bundled' | 'system') => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (!api.getCACertificates || !api.setDefaultCACertificates) {
    console.warn('[tls] esta versão do Node não permite usar as CAs do Windows; só as CAs públicas valem');
    return;
  }
  try {
    const bundled = api.getCACertificates('bundled');
    const system = api.getCACertificates('system');
    const all = [...new Set([...bundled, ...system])];
    api.setDefaultCACertificates(all);
    console.log(`[tls] ${all.length} certificados confiáveis (${bundled.length} públicos + ${system.length} do Windows)`);
  } catch (err) {
    console.warn('[tls] não foi possível carregar as CAs do Windows:', err);
  }
}

function start(): void {
  setupFileLogging();
  trustSystemCertificates();
  app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);

  let config = loadConfig();
  applyAutoStart(config.autoStart);

  const identity = getComputerIdentity();
  const computer = identity.info;
  let api = config.serverUrl ? new ApiClient(config.serverUrl) : null;
  const connection = new ServerConnection(
    config.serverUrl,
    computer,
    () => ({ computerSecret: identity.secret }),
    api,
  );
  const store = new MessageStore(join(app.getPath('userData'), 'messages-cache.json'), config.serverUrl);
  // Chat com o DP: só contador (sem popup nem som); o popup é só para comunicados
  const chat = new ChatStore();
  const popup = new PopupManager(createPopupWindow);
  const badge = loadIcon('badge.png');

  // No desligamento/logoff do Windows o 'before-quit' não é garantido: o 'session-end' da janela
  // (ver ensureMainWindow) grava o cache. (powerMonitor 'shutdown' só existe no Linux/macOS.)
  app.on('before-quit', () => store.flush());
  // Voltou da suspensão: a conexão antiga provavelmente morreu; registra de novo já
  powerMonitor.on('resume', () => connection.reconnectNow('retorno da suspensão do Windows'));

  console.log(`[app] Comunicação DP v${computer.appVersion} | ${computer.computerId} (${computer.hostname})`);

  // ---------------------------------------------------------------- janela principal

  function ensureMainWindow(): BrowserWindow {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

    const win = createMainWindow();
    win.setIcon(loadIcon('icon.png'));
    // Fechar a janela só esconde: o app continua na bandeja recebendo mensagens
    win.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    // Logoff/desligamento do Windows: grava o cache e tira o funcionário do PC (PC compartilhado:
    // o próximo a usar não herda a sessão). Melhor esforço: o Windows não espera muito.
    win.on('session-end', () => {
      store.flush();
      const client = api;
      if (employee && client && connection.getState().status === 'connected') {
        console.log(`[funcionário] logoff do Windows: saindo (${employee.name})`);
        void Promise.race([client.logoutEmployee(), new Promise((resolve) => setTimeout(resolve, 2_000))]).catch(
          () => undefined,
        );
      }
    });
    win.on('focus', () => win.flashFrame(false));
    win.webContents.on('did-finish-load', updateUnreadIndicators);
    mainWindow = win;
    return win;
  }

  function showMainWindow(): void {
    const win = ensureMainWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  const tray = new AppTray({
    open: showMainWindow,
    quit: () => {
      quitting = true;
      app.quit();
    },
  });

  // ---------------------------------------------------------------- funcionário logado

  let employee: EmployeeProfile | null = null;
  let employeeChecked = false;

  function setEmployee(next: EmployeeProfile | null, checked = true): void {
    // O chat é da pessoa: sem funcionário (ou outra pessoa entrou) a conversa anterior sai da tela
    if (!next || next.id !== employee?.id) chat.clear();
    employee = next;
    employeeChecked = employeeChecked || checked;
    const state: EmployeeState = { employee, checked: employeeChecked };
    sendToMain(IpcChannels.EmployeeChanged, state);
    updateUnreadIndicators();
  }

  /** Pergunta ao servidor quem está logado neste PC (o vínculo sobrevive a reinícios do app). */
  async function refreshSession(client: ApiClient): Promise<void> {
    try {
      setEmployee(await client.getSession());
    } catch (err) {
      console.warn('[funcionário] não foi possível consultar a sessão:', err instanceof Error ? err.message : err);
      setEmployee(employee);
    }
  }

  function updateUnreadIndicators(): void {
    const announcements = store.getState().unreadCount;
    const chatUnread = chat.getState().unreadCount;
    const total = announcements + chatUnread;
    tray.update(announcements, chatUnread, CONNECTION_LABELS[connection.getState().status], employee?.name ?? null);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(total > 0 ? `(${total}) Comunicação DP` : 'Comunicação DP');
      mainWindow.setOverlayIcon(total > 0 ? badge : null, total > 0 ? `${total} não lidas` : '');
    }
  }

  /** Lista de contatos do chat (pessoas do DP), com não lidas e última mensagem. */
  async function syncChatContacts(): Promise<void> {
    const client = api;
    if (!client || !employee) {
      chat.clear();
      return;
    }
    try {
      chat.setContacts(await client.getChatContacts());
    } catch (err) {
      console.warn('[chat] não foi possível carregar os contatos:', err instanceof Error ? err.message : err);
      if (err instanceof ApiError && err.status === 401) chat.clear(); // sem funcionário logado no servidor
    }
  }

  /** Carrega a conversa com uma pessoa do DP. */
  async function loadConversation(dpUserId: string): Promise<boolean> {
    const client = api;
    if (!client || !employee) return false;
    chat.setLoading(true);
    try {
      chat.setConversation(dpUserId, await client.getChat(dpUserId));
      return true;
    } catch (err) {
      console.warn('[chat] não foi possível carregar a conversa:', err instanceof Error ? err.message : err);
      return false;
    } finally {
      chat.setLoading(false);
    }
  }

  /** Contatos + conversa aberta (após conectar, login, troca de sessão). */
  async function syncChat(): Promise<void> {
    if (!api || !employee) {
      chat.clear();
      return;
    }
    await syncChatContacts();
    const state = chat.getState();
    console.log(`[chat] ${state.contacts.length} pessoas do DP, ${state.unreadCount} mensagens não lidas`);
    if (state.openContactId && chat.hasContact(state.openContactId)) await loadConversation(state.openContactId);
  }

  // Várias mensagens seguidas → uma única atualização da lista de contatos
  let contactsRefreshTimer: NodeJS.Timeout | null = null;
  function refreshContactsSoon(): void {
    if (contactsRefreshTimer) clearTimeout(contactsRefreshTimer);
    contactsRefreshTimer = setTimeout(() => {
      contactsRefreshTimer = null;
      void syncChatContacts();
    }, 400);
  }

  function sendToMain(channel: string, payload: unknown): void {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  // ---------------------------------------------------------------- mensagens

  async function markAsRead(messageId: string): Promise<void> {
    const message = store.get(messageId);
    popup.remove(messageId);
    if (!message || message.read) return;
    try {
      if (!api || connection.getState().status !== 'connected') throw new Error('offline');
      store.markRead(messageId, await api.markRead(messageId), false);
    } catch (err) {
      // Sem conexão (ou sessão recusada): marca localmente e envia quando reconectar
      store.markRead(messageId, new Date().toISOString(), true);
      if (err instanceof ApiError && err.status === 401) connection.reconnectNow('token recusado pela API');
    }
  }

  /** Envia as leituras feitas offline. Retorna false se a sessão foi recusada (vai registrar de novo). */
  async function flushPendingReads(client: ApiClient): Promise<boolean> {
    for (const id of store.getPendingReads()) {
      try {
        store.markRead(id, await client.markRead(id), false);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          // A mensagem não existe mais no servidor (ou não é deste PC): não adianta insistir
          console.warn(`[sync] leitura pendente de ${id} descartada: ${err.message}`);
          store.discardPendingRead(id);
        } else if (err instanceof ApiError && err.status === 401) {
          connection.reconnectNow('token recusado pela API');
          return false;
        } else {
          console.warn(`[sync] leitura pendente de ${id} fica para a próxima conexão:`, err);
        }
      }
    }
    return true;
  }

  // Ao (re)conectar: envia leituras pendentes e sincroniza o que chegou enquanto estava offline
  async function syncWithServer(): Promise<void> {
    const client = api;
    if (!client) return;
    if (!(await flushPendingReads(client))) return;
    try {
      const fresh = store.replaceAll(await client.listMessages());
      console.log(`[sync] ${store.getState().messages.length} mensagens, ${fresh.length} novas não lidas`);
      const recent = fresh.filter((m) => Date.now() - Date.parse(m.createdAt) < POPUP_MAX_AGE_MS);
      popup.enqueue([...recent].reverse()); // mais antigas primeiro
    } catch (err) {
      console.error('[sync] falha ao sincronizar mensagens:', err);
      if (err instanceof ApiError && err.status === 401) connection.reconnectNow('token recusado pela API');
    }
  }

  // ---------------------------------------------------------------- IPC (origem e entradas sempre validadas)

  handle(IpcChannels.GetState, (): AppState => ({
    appVersion: app.getVersion(),
    computer,
    connection: connection.getState(),
    messages: store.getState(),
    chat: chat.getState(),
    employee,
    employeeChecked,
  }));

  handle(IpcChannels.ChatOpen, async (rawId): Promise<OperationResult> => {
    if (rawId === null) {
      chat.setOpen(null);
      return { ok: true, message: '' };
    }
    if (!isUuid(rawId)) return { ok: false, message: 'Contato inválido.' };
    if (!employee) return { ok: false, message: 'Entre com sua matrícula para conversar com o DP.' };
    chat.setOpen(rawId);
    if (!api || connection.getState().status !== 'connected') {
      return chat.isLoaded(rawId)
        ? { ok: true, message: '' }
        : { ok: false, message: 'Sem conexão com o servidor: a conversa aparece quando o app estiver 🟢 Conectado.' };
    }
    return (await loadConversation(rawId))
      ? { ok: true, message: '' }
      : { ok: false, message: 'Não foi possível carregar a conversa. Tente novamente.' };
  });

  handle(IpcChannels.ChatSend, async (rawId, rawContent): Promise<OperationResult> => {
    if (!isUuid(rawId)) return { ok: false, message: 'Escolha com quem do DP você quer conversar.' };
    const content = boundedText(rawContent, CHAT_MESSAGE_MAX);
    if (!content) {
      const tooLong = typeof rawContent === 'string' && rawContent.trim().length > CHAT_MESSAGE_MAX;
      return { ok: false, message: tooLong ? `A mensagem pode ter no máximo ${CHAT_MESSAGE_MAX} caracteres.` : 'Escreva uma mensagem.' };
    }
    if (!employee) return { ok: false, message: 'Entre com sua matrícula para conversar com o DP.' };
    const client = api;
    if (!client || connection.getState().status !== 'connected') {
      return { ok: false, message: 'Sem conexão com o servidor. A mensagem não foi enviada; tente de novo quando estiver 🟢 Conectado.' };
    }
    try {
      chat.add(await client.sendChat(rawId, content));
      refreshContactsSoon();
      return { ok: true, message: 'Mensagem enviada.' };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Não foi possível enviar. Tente novamente.' };
    }
  });

  handle(IpcChannels.ChatMarkRead, async (rawId) => {
    const client = api;
    if (!isUuid(rawId) || !client || !employee || chat.contactUnread(rawId) === 0) return;
    if (connection.getState().status !== 'connected') return; // marca quando voltar a abrir o chat conectado
    try {
      await client.markChatRead(rawId);
      chat.markRead(rawId, new Date().toISOString());
    } catch (err) {
      console.warn('[chat] não foi possível marcar como lidas:', err instanceof Error ? err.message : err);
    }
  });

  handle(IpcChannels.EmployeeLogin, async (rawRegistration, rawPassword): Promise<OperationResult> => {
    const registration = boundedText(rawRegistration, 32);
    const password = boundedText(rawPassword, 128, false);
    if (!registration || !password) return { ok: false, message: 'Informe a matrícula e a senha.' };
    const client = api;
    if (!client || connection.getState().status !== 'connected') return OFFLINE_RESULT;
    try {
      const profile = await client.loginEmployee(registration, password);
      console.log(`[funcionário] login: ${profile.name} (matrícula ${profile.registration})`);
      setEmployee(profile);
      await Promise.all([syncWithServer(), syncChat()]); // comunicados do setor/turno + conversa com o DP
      return { ok: true, message: `Bem-vindo(a), ${profile.name}!` };
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Não foi possível entrar. Tente novamente.' };
    }
  });

  handle(IpcChannels.EmployeeLogout, async (): Promise<OperationResult> => {
    const client = api;
    if (!client || connection.getState().status !== 'connected') return OFFLINE_RESULT;
    try {
      await client.logoutEmployee();
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Não foi possível sair. Tente novamente.' };
    }
    console.log(`[funcionário] logout: ${employee?.name ?? '(ninguém)'}`);
    setEmployee(null);
    // Não deixa na tela (nem nos alertas) mensagens da pessoa anterior
    popup.clear();
    store.reset(config.serverUrl);
    await syncWithServer();
    return { ok: true, message: 'Você saiu. Este computador continua recebendo os comunicados gerais.' };
  });

  handle(IpcChannels.EmployeeChangePassword, async (rawCurrent, rawNext): Promise<OperationResult> => {
    const currentPassword = boundedText(rawCurrent, 128, false);
    const newPassword = boundedText(rawNext, 128, false);
    if (!currentPassword || !newPassword) return { ok: false, message: 'Preencha a senha atual e a nova senha.' };
    if (newPassword.length < 8) return { ok: false, message: 'A nova senha precisa ter pelo menos 8 caracteres.' };
    const client = api;
    if (!client || connection.getState().status !== 'connected') return OFFLINE_RESULT;
    if (!employee) return { ok: false, message: 'Entre com sua matrícula para alterar a senha.' };
    try {
      await client.changeEmployeePassword(currentPassword, newPassword);
      await refreshSession(client); // atualiza o perfil (ex.: some a troca obrigatória de senha)
      if (chat.getState().contacts.length === 0) await syncChat();
      return { ok: true, message: 'Senha alterada.' };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { ok: false, message: 'Senha atual incorreta.' };
      return { ok: false, message: err instanceof ApiError ? err.message : 'Não foi possível alterar a senha.' };
    }
  });

  handle(IpcChannels.MarkAsRead, async (messageId) => {
    if (isMessageId(messageId)) await markAsRead(messageId);
  });

  // ---------------------------------------------------------------- anexos

  /** Só anexos de comunicados que este computador recebeu (a interface manda só o id) */
  function findAttachment(rawId: unknown): DpAttachment | null {
    if (!isAttachmentId(rawId)) return null;
    for (const message of store.getState().messages) {
      const found = message.attachments.find((a) => a.id === rawId);
      if (found) return found;
    }
    return null;
  }

  /** Baixa o anexo do servidor. Devolve o conteúdo ou a mensagem do que deu errado. */
  async function fetchAttachment(attachment: DpAttachment): Promise<{ content: Buffer } | { error: string }> {
    const client = api;
    if (!client || connection.getState().status !== 'connected') {
      return { error: 'Sem conexão com o servidor. Abra o anexo quando o status estiver 🟢 Conectado.' };
    }
    try {
      return { content: await client.downloadAttachment(attachment.id) };
    } catch (err) {
      console.warn(`[anexo] falha ao baixar ${attachment.id}:`, err instanceof Error ? err.message : err);
      if (err instanceof ApiError && err.status === 404) {
        return { error: 'Este anexo não está mais no servidor.' };
      }
      return { error: 'Não foi possível baixar o anexo. Tente novamente.' };
    }
  }

  handle(IpcChannels.AttachmentOpen, async (rawId): Promise<OperationResult> => {
    const attachment = findAttachment(rawId);
    if (!attachment) return { ok: false, message: 'Anexo não encontrado.' };
    const result = await fetchAttachment(attachment);
    if ('error' in result) return { ok: false, message: result.error };

    // Pasta temporária só deste app; o Windows limpa depois
    const folder = join(app.getPath('temp'), 'comunicacao-dp-anexos');
    const file = join(folder, `${attachment.id}-${attachment.name}`);
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(file, result.content);
      const failure = await shell.openPath(file);
      if (failure) return { ok: false, message: `O Windows não conseguiu abrir o arquivo: ${failure}` };
      return { ok: true, message: `Abrindo ${attachment.name}...` };
    } catch (err) {
      console.error('[anexo] falha ao gravar o arquivo temporário:', err);
      return { ok: false, message: 'Não foi possível abrir o anexo neste computador.' };
    }
  });

  handle(IpcChannels.AttachmentSave, async (rawId): Promise<OperationResult> => {
    const attachment = findAttachment(rawId);
    if (!attachment) return { ok: false, message: 'Anexo não encontrado.' };

    const win = ensureMainWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Salvar anexo',
      defaultPath: join(app.getPath('downloads'), attachment.name),
      buttonLabel: 'Salvar',
    });
    if (canceled || !filePath) return { ok: false, message: '' };

    const result = await fetchAttachment(attachment);
    if ('error' in result) return { ok: false, message: result.error };
    try {
      await writeFile(filePath, result.content);
      return { ok: true, message: `Salvo em ${filePath}` };
    } catch (err) {
      console.error('[anexo] falha ao salvar:', err);
      return { ok: false, message: 'Não foi possível salvar o arquivo nessa pasta.' };
    }
  });

  handle(IpcChannels.AttachmentImage, async (rawId): Promise<string | null> => {
    const attachment = findAttachment(rawId);
    if (!attachment || attachment.kind !== 'IMAGE') return null;
    const result = await fetchAttachment(attachment);
    if ('error' in result) return null;
    return `data:${attachment.mimeType};base64,${result.content.toString('base64')}`;
  });

  handle(PopupChannels.GetState, () => popup.getState());
  handle(PopupChannels.Dismiss, (messageId) => {
    if (isMessageId(messageId)) popup.remove(messageId);
  });
  handle(PopupChannels.View, (messageId) => {
    if (isMessageId(messageId)) popup.view(messageId);
  });

  handle(IpcChannels.GetSettings, (): SettingsView => ({
    serverUrl: config.serverUrl,
    autoStart: config.autoStart,
    autoStartAvailable: app.isPackaged,
  }));

  handle(IpcChannels.TestServer, (serverUrl) => testServer(serverUrl));

  handle(IpcChannels.SaveSettings, (input): OperationResult => {
    const data = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const rawUrl = typeof data.serverUrl === 'string' ? data.serverUrl.trim() : '';
    const serverUrl = rawUrl ? normalizeServerUrl(rawUrl) : null;
    if (rawUrl && !serverUrl) return { ok: false, message: 'Endereço inválido. Use o formato http://IP:PORTA' };
    const autoStart = data.autoStart === true;

    saveConfig({ serverUrl, autoStart });
    applyAutoStart(autoStart);

    const previous = config;
    config = loadConfig();
    if (config.serverUrl !== previous.serverUrl) {
      console.log(`[config] servidor alterado para ${config.serverUrl ?? '(nenhum)'}`);
      api = config.serverUrl ? new ApiClient(config.serverUrl) : null;
      store.reset(config.serverUrl);
      setEmployee(null, false); // o login era do servidor anterior
      connection.reconfigure(config.serverUrl, api);
    }
    return { ok: true, message: 'Configurações salvas.' };
  });

  // ---------------------------------------------------------------- eventos

  popup.on('view', (messageId) => {
    showMainWindow();
    sendToMain(IpcChannels.OpenMessage, messageId);
    void markAsRead(messageId);
  });

  connection.on('change', (state) => {
    console.log(`[conexão] ${state.status}${state.lastError ? ` (${state.lastError})` : ''}`);
    sendToMain(IpcChannels.ConnectionChanged, state);
    updateUnreadIndicators();
  });

  // Ao (re)conectar: primeiro quem está logado, depois as mensagens (que dependem disso)
  connection.on('connected', () => {
    const client = api;
    if (!client) return;
    void refreshSession(client).then(() => Promise.all([syncWithServer(), syncChat()]));
  });

  // O servidor mudou a sessão (expirou, funcionário desativado, senha redefinida pelo DP, setor/turno alterado)
  connection.on('sessionChanged', (next) => {
    console.log(`[funcionário] sessão alterada pelo servidor: ${next ? `${next.name} (${next.registration})` : 'nenhum funcionário'}`);
    if (!next && employee) {
      // Mesmo cuidado do logout: nada da pessoa anterior fica na tela
      popup.clear();
      store.reset(config.serverUrl);
    }
    setEmployee(next);
    void syncWithServer();
    void syncChat();
  });

  // Chat: só atualiza o contador e a conversa (sem popup nem som)
  connection.on('chat', (message) => {
    if (!employee || message.employeeId !== employee.id) return;
    chat.add(message);
    // Não lidas e última mensagem de cada contato ficam exatamente como no servidor
    // (inclui contato novo: pessoa do DP que ainda não estava na lista)
    refreshContactsSoon();
    if (message.senderType === 'DP') console.log(`[chat] mensagem de ${message.senderName}`);
  });

  chat.on('change', (state) => {
    sendToMain(IpcChannels.ChatChanged, state);
    updateUnreadIndicators();
  });

  connection.on('message', (message) => {
    if (!store.add(message)) return;
    console.log(`[mensagem] recebida ${message.id} (${message.type}): ${message.title}`);
    popup.enqueue([message]);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
  });

  store.on('change', (state) => {
    sendToMain(IpcChannels.MessagesChanged, state);
    updateUnreadIndicators();
  });

  app.on('second-instance', showMainWindow);

  const win = ensureMainWindow();
  if (!startHidden) win.once('ready-to-show', () => win.show());
  connection.start();
}

// Em desenvolvimento, dados separados do app instalado ("Comunicação DP-dev"): os dois podem rodar
// juntos, e o teste não mexe na configuração, identidade nem cache da instalação real.
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')}-dev`);

// Uma única instância por computador: abrir de novo só mostra a janela existente
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('before-quit', () => {
    quitting = true;
  });
  // Sem janelas visíveis o app continua rodando na bandeja
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(start);
}
