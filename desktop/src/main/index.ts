import {
  app,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  protocol,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { PopupChannels } from '../shared/popup-channels';
import {
  CHAT_MESSAGE_MAX,
  IpcChannels,
  type AppState,
  type Atalho,
  type ConnectionState,
  type DadosAtalho,
  type DestinoAtalho,
  type DpAttachment,
  type EmployeeProfile,
  type EmployeeState,
  type CategoriaChamado,
  type MidiaPublica,
  type MuralPost,
  type NovoChamadoInput,
  type PrioridadeChamado,
  type StatusChamado,
  type OperationResult,
  type SettingsView,
} from '../shared/types';
import { AdminClient } from './admin-client';
import { ApiClient, ApiError } from './api-client';
import { Atualizador } from './atualizador';
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

  // Conteúdo da nova tela inicial: recado do mural, atalhos da pessoa e a foto dela
  let adminClient = config.serverUrl ? new AdminClient(config.serverUrl) : null;
  let mural: MuralPost | null = null;
  let atalhos: Atalho[] = [];
  let foto: MidiaPublica | null = null;

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

  /**
   * Mídias do mural e fotos de perfil: a tela pede por dpmidia://m/<id> e o
   * servidor responde aqui, com o token do PC. O Range do vídeo passa junto,
   * então arrastar a barra funciona sem baixar o arquivo inteiro.
   *
   * Registrado uma única vez na inicialização: registrar de novo derruba o
   * processo principal (foi o que aconteceu na 1.7.0).
   */
  function registrarProtocoloDeMidia(): void {
    try {
      protocol.handle('dpmidia', async (request) => {
        const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
        if (!api || !/^MID-[0-9a-f]{24}$/.test(id)) return new Response('', { status: 404 });
        try {
          const resposta = await api.buscarMidia(id, request.headers.get('Range') ?? undefined);
          // Repassa só o que o <img>/<video> precisa: qualquer cabeçalho estranho
          // vindo do servidor não derruba a exibição.
          const cabecalhos = new Headers();
          for (const nome of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
            const valor = resposta.headers.get(nome);
            if (valor) cabecalhos.set(nome, valor);
          }
          return new Response(resposta.body, { status: resposta.status, headers: cabecalhos });
        } catch (err) {
          console.error('[mídia] falha ao buscar do servidor:', err);
          return new Response('', { status: 502 });
        }
      });
    } catch (err) {
      // Nunca derruba o aplicativo por causa da mídia: sem o protocolo, a tela
      // segue funcionando e só as imagens/vídeos deixam de aparecer.
      console.error('[mídia] não consegui registrar o protocolo dpmidia:', err);
    }
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

  /** Recado do mural: vale para qualquer pessoa, mesmo sem ninguém logado no PC */
  async function syncMural(): Promise<void> {
    if (!api || connection.getState().status !== 'connected') return;
    try {
      const anterior = mural?.id ?? null;
      mural = await api.obterMural();
      sendToMain(IpcChannels.MuralChanged, mural);
      if ((mural?.id ?? null) !== anterior) {
        console.log(`[mural] ${mural ? `recado em exibição: ${mural.titulo}` : 'nenhum recado em exibição'}`);
      }
    } catch (err) {
      console.error('[mural] falha ao buscar o recado:', err);
    }
  }

  /** Atalhos e foto são de quem está logado; sem funcionário, a tela fica sem eles */
  async function syncPerfil(): Promise<void> {
    if (!api || connection.getState().status !== 'connected' || !employee) {
      atalhos = [];
      foto = null;
      sendToMain(IpcChannels.AtalhosChanged, atalhos);
      sendToMain(IpcChannels.FotoChanged, foto);
      return;
    }
    try {
      [atalhos, foto] = await Promise.all([api.listarAtalhos(), api.obterFoto()]);
      sendToMain(IpcChannels.AtalhosChanged, atalhos);
      sendToMain(IpcChannels.FotoChanged, foto);
    } catch (err) {
      console.error('[perfil] falha ao buscar atalhos/foto:', err);
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
    mural,
    atalhos,
    foto,
    admin: adminClient?.user ?? null,
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
      adminClient?.esquecer();
      adminClient = config.serverUrl ? new AdminClient(config.serverUrl) : null;
      sendToMain(IpcChannels.AdminChanged, null);
      store.reset(config.serverUrl);
      setEmployee(null, false); // o login era do servidor anterior
      connection.reconfigure(config.serverUrl, api);
    }
    return { ok: true, message: 'Configurações salvas.' };
  });

  const TIPOS_IMAGEM: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };

  /** Abre o seletor de arquivo e devolve a imagem lida do disco. */
  async function escolherImagem(
    titulo: string,
  ): Promise<{ conteudo: Buffer; mimeType: string; nome: string; erro?: string } | null> {
    const escolha = await dialog.showOpenDialog({
      title: titulo,
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (escolha.canceled || escolha.filePaths.length === 0) return null;

    const caminho = escolha.filePaths[0];
    const nome = caminho.split(/[\/]/).pop() ?? 'imagem';
    const mimeType = TIPOS_IMAGEM[caminho.slice(caminho.lastIndexOf('.')).toLowerCase()];
    if (!mimeType) {
      return { conteudo: Buffer.alloc(0), mimeType: '', nome, erro: 'Escolha uma imagem JPG, PNG ou WEBP.' };
    }
    const conteudo = await readFile(caminho);
    if (conteudo.length > 10 * 1024 * 1024) {
      return { conteudo, mimeType, nome, erro: 'A imagem passa de 10 MB.' };
    }
    return { conteudo, mimeType, nome };
  }

  // ---------------------------------------------------------------- chamados para o TI

  const CHAMADO_ID = /^CHM-[0-9a-f]{24}$/;
  const CATEGORIAS: CategoriaChamado[] = ['COMPUTADOR', 'IMPRESSORA', 'SISTEMA', 'REDE', 'ACESSO', 'OUTRO'];
  const PRIORIDADES: PrioridadeChamado[] = ['BAIXA', 'NORMAL', 'ALTA'];
  const STATUS_CHAMADO: StatusChamado[] = ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO'];

  function textoValido(valor: unknown, maximo: number): string | null {
    if (typeof valor !== 'string') return null;
    const limpo = valor.trim();
    return limpo && limpo.length <= maximo ? limpo : null;
  }

  handle(IpcChannels.ChamadosList, async () => {
    const saida = await comApi((client) => client.listarChamados());
    return 'dados' in saida ? { ok: true, chamados: saida.dados, message: '' } : { ok: false, chamados: [], message: saida.message };
  });

  handle(IpcChannels.ChamadoAbrir, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as Partial<NovoChamadoInput> | null;
    const titulo = textoValido(entrada?.titulo, 120);
    const descricao = textoValido(entrada?.descricao, 4000);
    const categoria = CATEGORIAS.includes(entrada?.categoria as CategoriaChamado) ? (entrada?.categoria as CategoriaChamado) : null;
    const prioridade = PRIORIDADES.includes(entrada?.prioridade as PrioridadeChamado)
      ? (entrada?.prioridade as PrioridadeChamado)
      : 'NORMAL';
    const midiaIds = Array.isArray(entrada?.midiaIds) ? entrada.midiaIds.filter((id): id is string => typeof id === 'string') : [];
    if (!titulo || !descricao || !categoria) return { ok: false, message: 'Preencha o título, a descrição e a categoria.' };

    const saida = await comApi((client) => client.abrirChamado({ titulo, descricao, categoria, prioridade, midiaIds }));
    if (!('dados' in saida)) return saida;
    sendToMain(IpcChannels.ChamadosChanged, null);
    return { ok: true, message: `Chamado ${saida.dados.numero} aberto.` };
  });

  handle(IpcChannels.ChamadoDetalhe, async (id) => {
    if (typeof id !== 'string' || !CHAMADO_ID.test(id)) return { ok: false, chamado: null, message: 'Chamado inválido.' };
    const saida = await comApi((client) => client.detalheChamado(id));
    return 'dados' in saida ? { ok: true, chamado: saida.dados, message: '' } : { ok: false, chamado: null, message: saida.message };
  });

  handle(IpcChannels.ChamadoResponder, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { id?: unknown; conteudo?: unknown } | null;
    const id = typeof entrada?.id === 'string' && CHAMADO_ID.test(entrada.id) ? entrada.id : null;
    const conteudo = textoValido(entrada?.conteudo, 2000);
    if (!id || !conteudo) return { ok: false, message: 'Escreva a mensagem.' };
    const saida = await comApi((client) => client.responderChamado(id, conteudo));
    if (!('dados' in saida)) return saida;
    sendToMain(IpcChannels.ChamadosChanged, null);
    return { ok: true, message: '' };
  });

  handle(IpcChannels.ChamadoFechar, async (id): Promise<OperationResult> => {
    if (typeof id !== 'string' || !CHAMADO_ID.test(id)) return { ok: false, message: 'Chamado inválido.' };
    const saida = await comApi((client) => client.fecharChamado(id));
    if (!('dados' in saida)) return saida;
    sendToMain(IpcChannels.ChamadosChanged, null);
    return { ok: true, message: 'Chamado fechado.' };
  });

  handle(IpcChannels.ChamadoLidas, async (id): Promise<OperationResult> => {
    if (typeof id !== 'string' || !CHAMADO_ID.test(id)) return { ok: false, message: 'Chamado inválido.' };
    const saida = await comApi((client) => client.marcarChamadoLido(id));
    if (!('dados' in saida)) return saida;
    sendToMain(IpcChannels.ChamadosChanged, null);
    return { ok: true, message: '' };
  });

  /** Print para anexar ao chamado: escolhe no disco e envia com o token do PC. */
  handle(IpcChannels.ChamadoEnviarImagem, async () => {
    const escolhida = await escolherImagem('Escolha o print do problema');
    if (!escolhida) return { ok: false, midiaId: null, nome: '', message: '' };
    if (escolhida.erro) return { ok: false, midiaId: null, nome: '', message: escolhida.erro };

    const envio = await comApi((client) => client.enviarMidia(escolhida.conteudo, escolhida.mimeType, escolhida.nome));
    if (!('dados' in envio)) return { ok: false, midiaId: null, nome: '', message: envio.message };
    return { ok: true, midiaId: envio.dados.id, nome: escolhida.nome, message: '' };
  });

  // ---------------------------------------------------------------- conta do DP/TI no aplicativo

  /**
   * Chamada com a credencial do DP. Diferente de comApi(), que usa o token do
   * computador: aqui quem age é a pessoa do DP logada nesta máquina.
   */
  async function comAdmin<T>(
    acao: (client: AdminClient) => Promise<T>,
  ): Promise<{ ok: true; dados: T } | OperationResult> {
    if (!adminClient || !adminClient.autenticado) {
      return { ok: false, message: 'Entre com a conta do DP para usar esta função.' };
    }
    try {
      return { ok: true, dados: await acao(adminClient) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) sendToMain(IpcChannels.AdminChanged, null);
      const mensagem = err instanceof ApiError ? err.message : 'Não foi possível concluir. Tente de novo.';
      return { ok: false, message: mensagem };
    }
  }

  handle(IpcChannels.AdminLogin, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { username?: unknown; password?: unknown } | null;
    const username = textoValido(entrada?.username, 64);
    const password = typeof entrada?.password === 'string' ? entrada.password : '';
    if (!username || !password) return { ok: false, message: 'Informe o usuário e a senha.' };
    if (!adminClient) return { ok: false, message: 'Configure o endereço do servidor antes de entrar.' };

    try {
      const usuario = await adminClient.login(username, password);
      sendToMain(IpcChannels.AdminChanged, usuario);
      console.log(`[admin] ${usuario.name} entrou${usuario.superAdmin ? ' (TI)' : ''}`);
      return { ok: true, message: '' };
    } catch (err) {
      const mensagem = err instanceof ApiError ? err.message : 'Não consegui falar com o servidor.';
      return { ok: false, message: mensagem };
    }
  });

  handle(IpcChannels.AdminLogout, async (): Promise<OperationResult> => {
    await adminClient?.logout();
    sendToMain(IpcChannels.AdminChanged, null);
    return { ok: true, message: '' };
  });

  handle(IpcChannels.AdminFila, async (incluirEncerrados) => {
    const saida = await comAdmin((client) => client.filaChamados(incluirEncerrados === true));
    return 'dados' in saida ? { ok: true, chamados: saida.dados, message: '' } : { ok: false, chamados: [], message: saida.message };
  });

  handle(IpcChannels.AdminChamadoDetalhe, async (id) => {
    if (typeof id !== 'string' || !CHAMADO_ID.test(id)) return { ok: false, chamado: null, message: 'Chamado inválido.' };
    const saida = await comAdmin((client) => client.detalheChamado(id));
    return 'dados' in saida ? { ok: true, chamado: saida.dados, message: '' } : { ok: false, chamado: null, message: saida.message };
  });

  handle(IpcChannels.AdminChamadoResponder, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { id?: unknown; conteudo?: unknown } | null;
    const id = typeof entrada?.id === 'string' && CHAMADO_ID.test(entrada.id) ? entrada.id : null;
    const conteudo = textoValido(entrada?.conteudo, 2000);
    if (!id || !conteudo) return { ok: false, message: 'Escreva a mensagem.' };
    const saida = await comAdmin((client) => client.responderChamado(id, conteudo));
    return 'dados' in saida ? { ok: true, message: '' } : saida;
  });

  handle(IpcChannels.AdminChamadoStatus, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { id?: unknown; status?: unknown } | null;
    const id = typeof entrada?.id === 'string' && CHAMADO_ID.test(entrada.id) ? entrada.id : null;
    const status = STATUS_CHAMADO.includes(entrada?.status as StatusChamado) ? (entrada?.status as StatusChamado) : null;
    if (!id || !status) return { ok: false, message: 'Chamado ou situação inválida.' };
    const saida = await comAdmin((client) => client.mudarStatusChamado(id, status));
    return 'dados' in saida ? { ok: true, message: '' } : saida;
  });

  handle(IpcChannels.AdminMuralList, async () => {
    const saida = await comAdmin((client) => client.listarMural());
    return 'dados' in saida ? { ok: true, posts: saida.dados, message: '' } : { ok: false, posts: [], message: saida.message };
  });

  handle(IpcChannels.AdminMuralSalvar, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { id?: unknown; titulo?: unknown; texto?: unknown; midiaId?: unknown; ativo?: unknown } | null;
    const titulo = textoValido(entrada?.titulo, 120);
    const texto = textoValido(entrada?.texto, 4000);
    const id = typeof entrada?.id === 'string' ? entrada.id : null;
    const midiaId = typeof entrada?.midiaId === 'string' ? entrada.midiaId : null;
    const ativo = entrada?.ativo !== false;
    if (!titulo || !texto) return { ok: false, message: 'Preencha o título e o texto.' };

    const saida = await comAdmin((client) =>
      id
        ? client.atualizarMural(id, { titulo, texto, midiaId, ativo })
        : client.publicarMural({ titulo, texto, midiaId, ativo }),
    );
    if (!('dados' in saida)) return saida;
    await syncMural();
    return { ok: true, message: id ? 'Recado alterado.' : 'Recado publicado no mural.' };
  });

  handle(IpcChannels.AdminMuralRemover, async (id): Promise<OperationResult> => {
    if (typeof id !== 'string') return { ok: false, message: 'Recado inválido.' };
    const saida = await comAdmin((client) => client.removerMural(id));
    if (!('dados' in saida)) return saida;
    await syncMural();
    return { ok: true, message: 'Recado removido.' };
  });

  /** Imagem ou vídeo para o mural, enviado com a credencial do DP. */
  handle(IpcChannels.AdminMuralMidia, async () => {
    const escolha = await dialog.showOpenDialog({
      title: 'Escolha a imagem ou o vídeo do mural',
      properties: ['openFile'],
      filters: [{ name: 'Imagens e vídeos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'] }],
    });
    if (escolha.canceled || escolha.filePaths.length === 0) return { ok: false, midia: null, message: '' };

    const caminho = escolha.filePaths[0];
    const nome = caminho.split(/[\/]/).pop() ?? 'arquivo';
    const tipos: Record<string, string> = {
      ...TIPOS_IMAGEM,
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };
    const mimeType = tipos[caminho.slice(caminho.lastIndexOf('.')).toLowerCase()];
    if (!mimeType) return { ok: false, midia: null, message: 'Formato não aceito.' };

    const conteudo = await readFile(caminho);
    const limiteMb = mimeType.startsWith('video/') ? 200 : 10;
    if (conteudo.length > limiteMb * 1024 * 1024) {
      return { ok: false, midia: null, message: 'O arquivo passa do limite de ' + limiteMb + ' MB.' };
    }

    const envio = await comAdmin((client) => client.enviarMidia(conteudo, mimeType, nome));
    return 'dados' in envio ? { ok: true, midia: envio.dados, message: '' } : { ok: false, midia: null, message: envio.message };
  });

  /**
   * Rotas que as telas administrativas podem chamar com a credencial do DP.
   * A lista existe para a tela não conseguir usar o token em qualquer endereço:
   * o que não estiver aqui é recusado antes de sair do aplicativo.
   */
  const ROTAS_ADMIN: { metodo: string; padrao: RegExp }[] = [
    { metodo: 'GET', padrao: /^\/api\/messages(\?limit=\d{1,4})?$/ },
    { metodo: 'POST', padrao: /^\/api\/messages$/ },
    { metodo: 'GET', padrao: /^\/api\/messages\/[\w-]{1,40}\/reads$/ },
    { metodo: 'DELETE', padrao: /^\/api\/attachments\/ATT-[0-9a-f]{24}$/ },
    { metodo: 'GET', padrao: /^\/api\/employees$/ },
    { metodo: 'POST', padrao: /^\/api\/employees$/ },
    { metodo: 'PATCH', padrao: /^\/api\/employees\/[\w-]{1,64}$/ },
    { metodo: 'DELETE', padrao: /^\/api\/employees\/[\w-]{1,64}$/ },
    { metodo: 'POST', padrao: /^\/api\/employees\/[\w-]{1,64}\/password$/ },
    { metodo: 'GET', padrao: /^\/api\/sectors$/ },
    { metodo: 'POST', padrao: /^\/api\/sectors$/ },
    { metodo: 'PATCH', padrao: /^\/api\/sectors\/[\w-]{1,64}$/ },
    { metodo: 'DELETE', padrao: /^\/api\/sectors\/[\w-]{1,64}$/ },
    { metodo: 'GET', padrao: /^\/api\/computers$/ },
    { metodo: 'GET', padrao: /^\/api\/chats$/ },
    { metodo: 'GET', padrao: /^\/api\/chats\/[\w-]{1,64}\/messages$/ },
    { metodo: 'POST', padrao: /^\/api\/chats\/[\w-]{1,64}\/messages$/ },
    { metodo: 'POST', padrao: /^\/api\/chats\/[\w-]{1,64}\/read$/ },
    { metodo: 'GET', padrao: /^\/api\/auto-replies$/ },
    { metodo: 'POST', padrao: /^\/api\/auto-replies$/ },
    { metodo: 'PUT', padrao: /^\/api\/auto-replies\/[\w-]{1,64}$/ },
    { metodo: 'DELETE', padrao: /^\/api\/auto-replies\/[\w-]{1,64}$/ },
    { metodo: 'GET', padrao: /^\/api\/auth\/me$/ },
    { metodo: 'POST', padrao: /^\/api\/auth\/password$/ },
    { metodo: 'GET', padrao: /^\/api\/admin\/users$/ },
    { metodo: 'POST', padrao: /^\/api\/admin\/users$/ },
    { metodo: 'PATCH', padrao: /^\/api\/admin\/users\/[\w-]{1,64}$/ },
    { metodo: 'POST', padrao: /^\/api\/admin\/users\/[\w-]{1,64}\/password$/ },
    { metodo: 'GET', padrao: /^\/api\/admin\/chats$/ },
    { metodo: 'POST', padrao: /^\/api\/admin\/chats\/purge$/ },
    { metodo: 'POST', padrao: /^\/api\/admin\/messages\/purge$/ },
  ];

  handle(IpcChannels.AdminApi, async (bruto) => {
    const entrada = bruto as { method?: unknown; path?: unknown; body?: unknown } | null;
    const metodo = typeof entrada?.method === 'string' ? entrada.method.toUpperCase() : '';
    const caminho = typeof entrada?.path === 'string' ? entrada.path : '';
    const permitida = ROTAS_ADMIN.some((rota) => rota.metodo === metodo && rota.padrao.test(caminho));
    if (!permitida) {
      console.warn('[admin] rota recusada: ' + metodo + ' ' + caminho);
      return { ok: false, dados: null, message: 'Operação não permitida.' };
    }

    const saida = await comAdmin((client) => client.chamar(metodo, caminho, entrada?.body));
    return 'dados' in saida ? { ok: true, dados: saida.dados, message: '' } : { ok: false, dados: null, message: saida.message };
  });

  /** Anexos do comunicado: escolhe no disco e envia com a credencial do DP. */
  handle(IpcChannels.AdminAnexo, async () => {
    const escolha = await dialog.showOpenDialog({
      title: 'Escolha os arquivos do comunicado',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Imagens e documentos',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip'],
        },
      ],
    });
    if (escolha.canceled || escolha.filePaths.length === 0) return { ok: false, anexos: [], message: '' };
    if (escolha.filePaths.length > 5) return { ok: false, anexos: [], message: 'No máximo 5 arquivos por comunicado.' };

    const anexos: { id: string; name: string; size: number }[] = [];
    for (const caminho of escolha.filePaths) {
      const nome = caminho.split(/[\/]/).pop() ?? 'arquivo';
      const conteudo = await readFile(caminho);
      if (conteudo.length > 10 * 1024 * 1024) {
        return { ok: false, anexos, message: nome + ' passa de 10 MB.' };
      }
      const envio = await comAdmin((client) => client.enviarAnexo(conteudo, nome));
      if (!('dados' in envio)) return { ok: false, anexos, message: envio.message };
      anexos.push({ id: envio.dados.id, name: envio.dados.name, size: envio.dados.size });
    }
    return { ok: true, anexos, message: '' };
  });

  // ---------------------------------------------------------------- atalhos e foto de perfil

  const DESTINOS_VALIDOS: DestinoAtalho[] = ['COMUNICADOS', 'CHAT', 'PERFIL', 'CONFIGURACOES', 'MURAL'];
  const COR_VALIDA = /^#[0-9a-fA-F]{6}$/;

  /** Confere o que veio da tela antes de mandar para o servidor. */
  function lerDadosAtalho(bruto: unknown): DadosAtalho | null {
    if (!bruto || typeof bruto !== 'object') return null;
    const { rotulo, icone, cor, destino } = bruto as Record<string, unknown>;
    if (typeof rotulo !== 'string' || !rotulo.trim() || rotulo.length > 24) return null;
    if (typeof icone !== 'string' || !icone.trim() || icone.length > 8) return null;
    if (typeof cor !== 'string' || !COR_VALIDA.test(cor)) return null;
    if (typeof destino !== 'string' || !DESTINOS_VALIDOS.includes(destino as DestinoAtalho)) return null;
    return { rotulo: rotulo.trim(), icone: icone.trim(), cor, destino: destino as DestinoAtalho };
  }

  async function comApi<T>(acao: (client: ApiClient) => Promise<T>): Promise<{ ok: true; dados: T } | OperationResult> {
    if (!api || connection.getState().status !== 'connected') {
      return { ok: false, message: 'Sem conexão com o servidor.' };
    }
    try {
      return { ok: true, dados: await acao(api) };
    } catch (err) {
      const mensagem = err instanceof ApiError ? err.message : 'Não foi possível concluir. Tente de novo.';
      return { ok: false, message: mensagem };
    }
  }

  handle(IpcChannels.AtalhoCreate, async (bruto): Promise<OperationResult> => {
    const dados = lerDadosAtalho(bruto);
    if (!dados) return { ok: false, message: 'Preencha nome, ícone, cor e destino do atalho.' };
    const saida = await comApi((client) => client.criarAtalho(dados));
    if (!('dados' in saida)) return saida;
    await syncPerfil();
    return { ok: true, message: 'Atalho criado.' };
  });

  handle(IpcChannels.AtalhoUpdate, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { id?: unknown; dados?: unknown } | null;
    const id = typeof entrada?.id === 'string' ? entrada.id : null;
    const dados = lerDadosAtalho(entrada?.dados);
    if (!id || !dados) return { ok: false, message: 'Atalho inválido.' };
    const saida = await comApi((client) => client.atualizarAtalho(id, dados));
    if (!('dados' in saida)) return saida;
    await syncPerfil();
    return { ok: true, message: 'Atalho alterado.' };
  });

  handle(IpcChannels.AtalhoDelete, async (bruto): Promise<OperationResult> => {
    if (typeof bruto !== 'string') return { ok: false, message: 'Atalho inválido.' };
    const saida = await comApi((client) => client.removerAtalho(bruto));
    if (!('dados' in saida)) return saida;
    await syncPerfil();
    return { ok: true, message: 'Atalho removido.' };
  });

  handle(IpcChannels.AtalhoReorder, async (bruto): Promise<OperationResult> => {
    if (!Array.isArray(bruto) || bruto.some((id) => typeof id !== 'string')) {
      return { ok: false, message: 'Ordem inválida.' };
    }
    const saida = await comApi((client) => client.reordenarAtalhos(bruto as string[]));
    if (!('dados' in saida)) return saida;
    await syncPerfil();
    return { ok: true, message: '' };
  });

  /** Escolhe a imagem no disco, envia ao servidor e passa a ser a foto da pessoa. */
  handle(IpcChannels.FotoUpload, async (): Promise<OperationResult> => {
    const escolhida = await escolherImagem('Escolha a sua foto');
    if (!escolhida) return { ok: false, message: '' };
    if (escolhida.erro) return { ok: false, message: escolhida.erro };

    const envio = await comApi(async (client) => {
      const midia = await client.enviarMidia(escolhida.conteudo, escolhida.mimeType, escolhida.nome);
      return client.definirFoto(midia.id);
    });
    if (!('dados' in envio)) return envio;
    await syncPerfil();
    return { ok: true, message: 'Foto atualizada.' };
  });

  handle(IpcChannels.FotoRemove, async (): Promise<OperationResult> => {
    const saida = await comApi((client) => client.removerFoto());
    if (!('dados' in saida)) return saida;
    await syncPerfil();
    return { ok: true, message: 'Foto removida.' };
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
    void refreshSession(client).then(() => Promise.all([syncWithServer(), syncChat(), syncMural(), syncPerfil()]));
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

  // O DP trocou o recado do mural: busca na hora, sem esperar reconectar
  connection.on('mural', () => {
    void syncMural();
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

  registrarProtocoloDeMidia();

  const win = ensureMainWindow();
  if (!startHidden) win.once('ready-to-show', () => win.show());
  connection.start();

  // Rede de segurança para o mural: se o aviso do servidor se perder (socket caído,
  // rede instável), uma busca periódica mantém o recado em dia mesmo assim.
  const RECARGA_MURAL_MS = 15 * 60_000;
  const timerMural = setInterval(() => void syncMural(), RECARGA_MURAL_MS);
  app.on('before-quit', () => clearInterval(timerMural));

  // Atualização automática: todo dia de madrugada o app pergunta ao servidor se
  // há versão nova, baixa, confere o hash e instala sem ninguém precisar mexer.
  // Só no aplicativo instalado: rodando pelo código-fonte não existe instalador.
  if (app.isPackaged) {
    const atualizador = new Atualizador({
      obterApi: () => api,
      estaConectado: () => connection.getState().status === 'connected',
      versaoAtual: app.getVersion(),
      horario: process.env.HORARIO_ATUALIZACAO,
      log: (mensagem) => console.log(`[atualizador] ${mensagem}`),
    });
    atualizador.iniciar();
    app.on('before-quit', () => atualizador.parar());
  }
}

// Esquema próprio para as mídias do servidor. Declarado antes do app ficar pronto,
// como o Electron exige. A tela usa dpmidia://m/<id> em <img> e <video>; o processo
// principal busca no servidor com o token do PC e repassa (inclusive o Range do vídeo).
// O User-Agent padrão do Electron leva o nome do produto ("Comunicação DP"), e os
// acentos quebram a montagem dos cabeçalhos do protocolo dpmidia:// — a imagem
// nem chegava a ser pedida ao servidor. Com um nome sem acentos, funciona.
app.userAgentFallback = `ComunicacaoDP/${app.getVersion()} (Windows)`;

protocol.registerSchemesAsPrivileged([
  { scheme: 'dpmidia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

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
