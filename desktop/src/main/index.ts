import {
  app,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  protocol,
  shell,
  BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as tls from 'node:tls';
import { PopupChannels } from '../shared/popup-channels';
import {
  IpcChannels,
  type AcessoAdmin,
  type AppState,
  type Atalho,
  type ConnectionState,
  type DadosAtalho,
  type DestinoAtalho,
  type DpAttachment,
  type EmployeeProfile,
  type EmployeeState,
  type IdentidadeChat,
  type CategoriaChamado,
  type MidiaPublica,
  type MuralPost,
  type NovoChamadoInput,
  type PrioridadeChamado,
  type StatusChamado,
  type OperationResult,
  type SettingsView,
} from '../shared/types';
import { nomeDeArquivo } from '../shared/arquivo';
import { AdminClient } from './admin-client';
import { ApiClient, ApiError } from './api-client';
import { Atualizador } from './atualizador';
import { getComputerIdentity } from './computer-identity';
import { horarioAtualizacao, loadConfig, normalizeServerUrl, saveConfig } from './config';
import { ServerConnection, type AvisoDoServidor } from './connection';
import { setupFileLogging } from './logger';
import { MessageStore } from './message-store';
import { ATTACHMENT_ID_REGEX, MESSAGE_ID_REGEX } from './message-validation';
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

/**
 * Chave de um alerta na fila do popup. São duas formas:
 *   comunicado      -> MSG-000042
 *   mensagem do chat -> CNV-<id da conversa>#<id da mensagem>
 * Conferir só a do comunicado deixava o alerta de mensagem sem resposta: os
 * botões "Fechar" e "Responder" não faziam nada e o alerta ficava na tela.
 */
const CHAVE_DE_MENSAGEM = /^CNV-[0-9a-f]{24}#\d{1,12}$/;
function isChaveDeAlerta(value: unknown): value is string {
  return typeof value === 'string' && (MESSAGE_ID_REGEX.test(value) || CHAVE_DE_MENSAGEM.test(value));
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
    return { ok: false, message: 'O endereço respondeu, mas não é o servidor do Comunica Trinys.' };
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

  console.log(`[app] Comunica Trinys v${computer.appVersion} | ${computer.computerId} (${computer.hostname})`);

  // ---------------------------------------------------------------- janela principal

  function ensureMainWindow(): BrowserWindow {
    if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

    const win = createMainWindow();
    win.setIcon(loadIcon('icon.png'));
    // Fechar a janela (X da barra, Alt+F4) não encerra o sistema: pede a senha.
    // Quem só quer tirar da frente tem o botão de minimizar na bandeja.
    win.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        pedirSenhaParaFechar();
      }
    });
    win.on('maximize', () => sendToMain(IpcChannels.JanelaEstado, true));
    win.on('unmaximize', () => sendToMain(IpcChannels.JanelaEstado, false));
    // Logoff/desligamento do Windows: só grava o cache. O login persiste: ao ligar o PC de
    // novo, a pessoa continua logada (para trocar de pessoa, "Sair" no aplicativo).
    win.on('session-end', () => {
      store.flush();
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
    quit: () => pedirSenhaParaFechar(),
  });

  // ---------------------------------------------------------------- fechar o sistema

  /**
   * Encerrar o aplicativo exige a senha do TI: nos computadores da fábrica ele
   * precisa continuar aberto para receber os comunicados.
   *
   * Guardamos só o resumo SHA-256 — a senha não fica escrita no programa. Dá
   * para trocar sem recompilar, pondo SENHA_FECHAR no .env ao lado do executável.
   *
   * Isto é uma tranca contra fechar sem querer (ou de propósito, pela janela):
   * quem tiver o Gerenciador de Tarefas ainda consegue encerrar o processo.
   */
  const RESUMO_SENHA_PADRAO = '74eaa0a540c22261919aa2c906f4108e5d3b1451f455a364f4579400eae5b2ad';

  function senhaDeFecharConfere(senha: string): boolean {
    const esperado = process.env.SENHA_FECHAR
      ? createHash('sha256').update(process.env.SENHA_FECHAR).digest('hex')
      : RESUMO_SENHA_PADRAO;
    const recebido = createHash('sha256').update(senha).digest('hex');
    // timingSafeEqual: comparar byte a byte não conta o tempo a favor de quem tenta adivinhar
    return timingSafeEqual(Buffer.from(recebido, 'hex'), Buffer.from(esperado, 'hex'));
  }

  /** Traz a janela para a frente com a caixa da senha aberta. */
  function pedirSenhaParaFechar(): void {
    showMainWindow();
    sendToMain(IpcChannels.PedirSenhaParaFechar, null);
  }

  handle(IpcChannels.JanelaFechar, async (bruto): Promise<OperationResult> => {
    const senha = typeof bruto === 'string' ? bruto : '';
    if (!senha || !senhaDeFecharConfere(senha)) {
      console.warn('[janela] tentativa de fechar com senha errada');
      return { ok: false, message: 'Senha incorreta.' };
    }
    console.log('[janela] senha conferida: encerrando o sistema');
    quitting = true;
    setTimeout(() => app.quit(), 150);
    return { ok: true, message: 'Encerrando...' };
  });

  ipcMain.on(IpcChannels.JanelaMinimizar, (event) => {
    if (!isTrustedSender(event as unknown as IpcMainInvokeEvent)) return;
    mainWindow?.minimize();
  });

  ipcMain.on(IpcChannels.JanelaEsconder, (event) => {
    if (!isTrustedSender(event as unknown as IpcMainInvokeEvent)) return;
    mainWindow?.hide();
  });

  handle(IpcChannels.JanelaMaximizar, async () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  handle(IpcChannels.JanelaEstado, async () => mainWindow?.isMaximized() ?? false);

  // ---------------------------------------------------------------- funcionário logado

  let employee: EmployeeProfile | null = null;
  let employeeChecked = false;

  function setEmployee(next: EmployeeProfile | null, checked = true): void {
    const trocou = !next || next.id !== employee?.id;
    employee = next;
    if (trocou) {
      // Foto e atalhos também são da pessoa: saem da tela na hora, antes mesmo
      // de buscar os da nova (senão a foto de quem saiu fica aparecendo)
      foto = null;
      atalhos = [];
      sendToMain(IpcChannels.FotoChanged, foto);
      sendToMain(IpcChannels.AtalhosChanged, atalhos);
      void syncPerfil();
    }
    employeeChecked = employeeChecked || checked;
    const state: EmployeeState = { employee, checked: employeeChecked };
    sendToMain(IpcChannels.EmployeeChanged, state);
    updateUnreadIndicators();
    // Trocou quem está no aplicativo: o contador do chat é de outra pessoa
    void syncNaoLidasConversas();
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

  /** Mensagens não lidas no chat novo (todas as conversas), para a bandeja */
  let naoLidasConversas = 0;

  /** Conversa aberta na tela (a própria tela avisa): não alerta o que já está à vista. */
  let conversaEmFoco: string | null = null;

  ipcMain.on(IpcChannels.ConversaEmFoco, (event, conversaId: unknown) => {
    if (!isTrustedSender(event as unknown as IpcMainInvokeEvent)) return;
    conversaEmFoco = typeof conversaId === 'string' ? conversaId : null;
    // Ao abrir a conversa, os alertas dela deixam de fazer sentido
    if (conversaEmFoco) popup.limparConversa(conversaEmFoco);
  });

  /**
   * Alerta de mensagem nova, igual ao dos comunicados. Fica de fora o que a
   * própria pessoa escreveu e a conversa que já está aberta na tela.
   */
  function alertarMensagem(conversaId: string, aviso: AvisoDoServidor | null): void {
    // O aviso vem pela sala do funcionário do PC; com a conta do DP/TI aberta,
    // quem está no aplicativo é outra pessoa e o alerta não é para ela
    if (!aviso || !employee || usandoComoDp() || aviso.autorId === employee.id) return;
    const janelaAtiva = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused();
    if (janelaAtiva && conversaEmFoco === conversaId) return;

    popup.enfileirarMensagem({
      id: `${conversaId}#${aviso.mensagemId}`,
      conversaId,
      autorNome: aviso.autorNome,
      grupo: aviso.grupo,
      resumo: aviso.resumo || 'enviou uma mensagem',
      createdAt: aviso.createdAt,
    });
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
  }

  function updateUnreadIndicators(): void {
    const announcements = store.getState().unreadCount;
    const chatUnread = naoLidasConversas;
    const total = announcements + chatUnread;
    tray.update(announcements, chatUnread, CONNECTION_LABELS[connection.getState().status], employee?.name ?? null);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(total > 0 ? `(${total}) Comunica Trinys` : 'Comunica Trinys');
      mainWindow.setOverlayIcon(total > 0 ? badge : null, total > 0 ? `${total} não lidas` : '');
    }
  }

  /**
   * Contador do chat novo. Segue a mesma credencial da tela de mensagens: o
   * funcionário logado no PC ou, sem ele, a conta do DP/TI.
   */
  async function syncNaoLidasConversas(): Promise<void> {
    const anterior = naoLidasConversas;
    try {
      const resumo = usandoComoDp()
        ? await comAdmin((client) => client.chamar<{ naoLidas: number }>('GET', '/api/conversas/resumo'))
        : await comApi((client) => client.chamar<{ naoLidas: number }>('GET', '/api/conversas/resumo'));
      naoLidasConversas = 'dados' in resumo ? (resumo.dados?.naoLidas ?? 0) : 0;
    } catch {
      naoLidasConversas = 0;
    }
    if (naoLidasConversas !== anterior) updateUnreadIndicators();
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
    employee,
    employeeChecked,
    mural,
    atalhos,
    foto,
    admin: adminClient?.user ?? null,
  }));

  handle(IpcChannels.EmployeeLogin, async (rawRegistration, rawPassword): Promise<OperationResult> => {
    const registration = boundedText(rawRegistration, 32);
    const password = boundedText(rawPassword, 128, false);
    if (!registration || !password) return { ok: false, message: 'Informe o usuário e a senha.' };
    const client = api;
    if (!client || connection.getState().status !== 'connected') return OFFLINE_RESULT;
    try {
      const profile = await client.loginEmployee(registration, password);
      console.log(`[funcionário] login: ${profile.name} (usuário ${profile.registration})`);
      setEmployee(profile);
      await Promise.all([syncWithServer(), syncNaoLidasConversas()]); // comunicados do setor/turno + conversas
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
    if (!employee) return { ok: false, message: 'Entre com seu usuário para alterar a senha.' };
    try {
      await client.changeEmployeePassword(currentPassword, newPassword);
      await refreshSession(client); // atualiza o perfil (ex.: some a troca obrigatória de senha)
      return { ok: true, message: 'Senha alterada.' };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { ok: false, message: 'Senha atual incorreta.' };
      return { ok: false, message: err instanceof ApiError ? err.message : 'Não foi possível alterar a senha.' };
    }
  });

  handle(IpcChannels.MarkAsRead, async (messageId) => {
    if (isMessageId(messageId)) await markAsRead(messageId);
  });

  // "Li e estou ciente": precisa de conexão, porque fica registrado no servidor
  /**
   * Link de uma mensagem, aberto no navegador padrão. Só http e https: um
   * "file:" ou um "javascript:" vindo de uma mensagem não tem nada que abrir
   * pelo aplicativo.
   */
  handle(IpcChannels.AbrirLink, async (bruto): Promise<OperationResult> => {
    const texto = typeof bruto === 'string' ? bruto.trim() : '';
    if (texto.length > 2000) return { ok: false, message: 'Endereço grande demais.' };
    let url: URL;
    try {
      url = new URL(texto);
    } catch {
      return { ok: false, message: 'Endereço inválido.' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, message: 'Só abro endereços http e https.' };
    }
    await shell.openExternal(url.toString());
    return { ok: true, message: '' };
  });

  /** "Copiar" do bloco de código: vai pela área de transferência do Windows. */
  handle(IpcChannels.CopiarTexto, async (bruto): Promise<OperationResult> => {
    const texto = typeof bruto === 'string' ? bruto : '';
    if (!texto) return { ok: false, message: 'Nada para copiar.' };
    if (texto.length > 200_000) return { ok: false, message: 'Texto grande demais para copiar.' };
    clipboard.writeText(texto);
    return { ok: true, message: 'Código copiado.' };
  });

  handle(IpcChannels.ConfirmarCiencia, async (messageId) => {
    if (!isMessageId(messageId)) return { ok: false, message: 'Comunicado inválido.' };
    if (!api || connection.getState().status !== 'connected') {
      return { ok: false, message: 'Sem conexão com o servidor. Tente de novo em instantes.' };
    }
    try {
      const cienteEm = await api.confirmarCiencia(messageId);
      store.markCiencia(messageId, cienteEm);
      popup.remove(messageId);
      return { ok: true, message: 'Confirmação registrada.' };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return { ok: false, message: 'Entre com o seu usuário para confirmar a ciência.' };
      }
      return { ok: false, message: err instanceof ApiError ? err.message : 'Não foi possível confirmar.' };
    }
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
    // nomeDeArquivo porque comunicados antigos foram gravados com o caminho
    // inteiro no nome; sem isso o join monta um caminho inválido e a gravação falha
    const file = join(folder, `${attachment.id}-${nomeDeArquivo(attachment.name)}`);
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(file, result.content);
      const failure = await shell.openPath(file);
      if (failure) return { ok: false, message: `O Windows não conseguiu abrir o arquivo: ${failure}` };
      return { ok: true, message: `Abrindo ${nomeDeArquivo(attachment.name)}...` };
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
      defaultPath: join(app.getPath('downloads'), nomeDeArquivo(attachment.name)),
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
    // Chave desconhecida (alerta que já saiu da fila, por exemplo): dispensa o
    // que está à vista, para o clique nunca ficar sem resposta
    if (isChaveDeAlerta(messageId)) popup.dispensar(messageId);
    else popup.dispensarAtual();
  });
  handle(PopupChannels.View, (messageId) => {
    if (isChaveDeAlerta(messageId)) popup.view(messageId);
    else popup.dispensarAtual();
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

  /** Tipos aceitos nos anexos das conversas (o servidor confere de novo). */
  const TIPOS_ANEXO: Record<string, string> = {
    ...TIPOS_IMAGEM,
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.zip': 'application/zip',
  };

  /**
   * Abre o seletor de arquivo e devolve o caminho da imagem escolhida.
   * Não há limite de tamanho: o envio lê o arquivo do disco em partes.
   */
  async function escolherImagem(
    titulo: string,
  ): Promise<{ caminho: string; mimeType: string; nome: string; erro?: string } | null> {
    const escolha = await dialog.showOpenDialog({
      title: titulo,
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (escolha.canceled || escolha.filePaths.length === 0) return null;

    const caminho = escolha.filePaths[0];
    const nome = caminho.split(/[\/]/).pop() ?? 'imagem';
    const mimeType = TIPOS_IMAGEM[caminho.slice(caminho.lastIndexOf('.')).toLowerCase()];
    if (!mimeType) return { caminho, mimeType: '', nome, erro: 'Escolha uma imagem JPG, PNG ou WEBP.' };
    return { caminho, mimeType, nome };
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

    const envio = await comApi((client) => client.enviarMidia(escolhida.caminho, escolhida.mimeType, escolhida.nome));
    if (!('dados' in envio)) return { ok: false, midiaId: null, nome: '', message: envio.message };
    return { ok: true, midiaId: envio.dados.id, nome: escolhida.nome, message: '' };
  });

  // ---------------------------------------------------------------- conta do DP/TI no aplicativo

  /** Acesso administrativo que o setor do funcionário logado dá (vem do servidor). */
  function acessoPeloSetor(): AcessoAdmin {
    return employee?.acessoAdmin ?? 'NENHUM';
  }

  /**
   * Chamada como DP. São duas credenciais possíveis, nesta ordem:
   *   1. a conta do DP/TI aberta no aplicativo (login no canto superior direito);
   *   2. o token do próprio computador, quando quem está logado é do setor do
   *      DP ou do TI — nesse caso o servidor reconhece o acesso pelo setor.
   */
  async function comAdmin<T>(
    acao: (client: AdminClient | ApiClient) => Promise<T>,
  ): Promise<{ ok: true; dados: T } | OperationResult> {
    const comConta = adminClient?.autenticado === true;
    const cliente = comConta ? adminClient : acessoPeloSetor() !== 'NENHUM' ? api : null;
    if (!cliente) {
      return { ok: false, message: 'Entre com a conta do DP para usar esta função.' };
    }
    try {
      return { ok: true, dados: await acao(cliente) };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && comConta) sendToMain(IpcChannels.AdminChanged, null);
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
      void syncNaoLidasConversas();
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
    void syncNaoLidasConversas();
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

  handle(IpcChannels.AdminChamadoAceitar, async (bruto): Promise<OperationResult> => {
    if (typeof bruto !== 'string' || !CHAMADO_ID.test(bruto)) return { ok: false, message: 'Chamado inválido.' };
    const saida = await comAdmin((client) => client.aceitarChamado(bruto));
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

    // Imagem e vídeo vão sem limite de tamanho: o arquivo sobe do disco em partes
    const envio = await comAdmin((client) => client.enviarMidia(caminho, mimeType, nome));
    return 'dados' in envio ? { ok: true, midia: envio.dados, message: '' } : { ok: false, midia: null, message: envio.message };
  });

  /**
   * Rotas que as telas administrativas podem chamar com a credencial do DP.
   * A lista existe para a tela não conseguir usar o token em qualquer endereço:
   * o que não estiver aqui é recusado antes de sair do aplicativo.
   */
  const ROTAS_ADMIN: { metodo: string; padrao: RegExp }[] = [
    { metodo: 'GET', padrao: /^\/api\/messages(\?limit=\d{1,4})?$/ },
    // Lista do DP (o token do computador em /api/messages significa "as minhas")
    { metodo: 'GET', padrao: /^\/api\/admin\/messages(\?limit=\d{1,4})?$/ },
    { metodo: 'POST', padrao: /^\/api\/messages$/ },
    { metodo: 'GET', padrao: /^\/api\/messages\/[\w-]{1,40}\/reads$/ },
    { metodo: 'POST', padrao: /^\/api\/messages\/[\w-]{1,40}\/avisar-pendentes$/ },
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
    { metodo: 'DELETE', padrao: /^\/api\/admin\/messages\/[\w-]{1,40}$/ },
    { metodo: 'DELETE', padrao: /^\/api\/admin\/chats\/[\w-]{1,64}\/[\w-]{1,64}$/ },
    { metodo: 'POST', padrao: /^\/api\/admin\/chats\/purge$/ },
    { metodo: 'POST', padrao: /^\/api\/admin\/messages\/purge$/ },
    // Comunicado e mural agendados
    { metodo: 'GET', padrao: /^\/api\/agendamentos(\?tipo=(COMUNICADO|MURAL))?$/ },
    { metodo: 'POST', padrao: /^\/api\/agendamentos\/(comunicado|mural)$/ },
    { metodo: 'DELETE', padrao: /^\/api\/agendamentos\/AGD-[0-9a-f]{24}$/ },
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
      const nome = nomeDeArquivo(caminho);
      // Imagem vai sem limite; documento tem teto, e quem recusa é o servidor
      const envio = await comAdmin((client) => client.enviarAnexo(caminho, nome));
      if (!('dados' in envio)) return { ok: false, anexos, message: envio.message };
      anexos.push({ id: envio.dados.id, name: envio.dados.name, size: envio.dados.size });
    }
    return { ok: true, anexos, message: '' };
  });

  // ---------------------------------------------------------------- conversas do chat

  /**
   * Rotas do chat liberadas para a tela. Como no canal administrativo, o que
   * não estiver nesta lista é recusado antes de sair do aplicativo.
   */
  const MIDIA_ID = new RegExp('^MID-[0-9a-f]{24}$');
  /** Aviso para a tela: as conversas foram apagadas pelo TI (troca a lista em vez de juntar) */
  const CONVERSAS_LIMPAS = '*';
  /** Caracteres que o Windows não aceita em nome de arquivo */
  const NOME_PROIBIDO = new RegExp('[\\/:*?"<>|]', 'g');
  const CNV = 'CNV-[0-9a-f]{24}';
  const ROTAS_CONVERSA: { metodo: string; padrao: RegExp }[] = [
    { metodo: 'GET', padrao: new RegExp('^/api/contatos$') },
    { metodo: 'GET', padrao: new RegExp('^/api/conversas$') },
    { metodo: 'GET', padrao: new RegExp('^/api/conversas/resumo$') },
    { metodo: 'POST', padrao: new RegExp('^/api/conversas/direta$') },
    { metodo: 'POST', padrao: new RegExp('^/api/conversas/grupo$') },
    { metodo: 'GET', padrao: new RegExp('^/api/conversas/' + CNV + '$') },
    { metodo: 'GET', padrao: new RegExp('^/api/conversas/' + CNV + '/mensagens([?]antes=\\d{1,12})?$') },
    { metodo: 'POST', padrao: new RegExp('^/api/conversas/' + CNV + '/mensagens$') },
    { metodo: 'POST', padrao: new RegExp('^/api/conversas/' + CNV + '/lidas$') },
    { metodo: 'GET', padrao: new RegExp('^/api/conversas/' + CNV + '/buscar[?]termo=.{1,200}$') },
    { metodo: 'DELETE', padrao: new RegExp('^/api/conversas/mensagens/\\d{1,12}$') },
    { metodo: 'PUT', padrao: new RegExp('^/api/conversas/mensagens/\\d{1,12}/reacao$') },
    { metodo: 'POST', padrao: new RegExp('^/api/conversas/' + CNV + '/membros$') },
    { metodo: 'DELETE', padrao: new RegExp('^/api/conversas/' + CNV + '/membros/[\\w-]{1,64}$') },
    { metodo: 'POST', padrao: new RegExp('^/api/conversas/' + CNV + '/sair$') },
    { metodo: 'PUT', padrao: new RegExp('^/api/conversas/' + CNV + '/nome$') },
    // "Só o DP e o TI me mandam mensagem" (tela Ajustes)
    { metodo: 'GET', padrao: new RegExp('^/api/conversas/preferencias$') },
    { metodo: 'PUT', padrao: new RegExp('^/api/conversas/preferencias$') },
    // Calendário da tela inicial
    { metodo: 'GET', padrao: new RegExp('^/api/eventos[?]de=\\d{4}-\\d{2}-\\d{2}&ate=\\d{4}-\\d{2}-\\d{2}$') },
    { metodo: 'POST', padrao: new RegExp('^/api/eventos$') },
    { metodo: 'PUT', padrao: new RegExp('^/api/eventos/EVT-[0-9a-f]{24}$') },
    { metodo: 'DELETE', padrao: new RegExp('^/api/eventos/EVT-[0-9a-f]{24}$') },
    // Área do TI (cada leitura fica registrada no servidor)
    { metodo: 'GET', padrao: new RegExp('^/api/admin/conversas$') },
    { metodo: 'GET', padrao: new RegExp('^/api/admin/conversas/acessos$') },
    { metodo: 'GET', padrao: new RegExp('^/api/admin/conversas/' + CNV + '/mensagens([?]antes=\\d{1,12})?$') },
    { metodo: 'DELETE', padrao: new RegExp('^/api/admin/conversas/' + CNV + '$') },
  ];

  /** Tem alguém do DP/TI usando o aplicativo neste momento? */
  function usandoComoDp(): boolean {
    return adminClient?.autenticado === true;
  }

  /**
   * Quem está conversando neste computador. A conta do DP/TI tem preferência:
   * enquanto ela está aberta, é essa pessoa que está usando o aplicativo — as
   * conversas são dela, e não do funcionário logado no PC.
   */
  function identidadeDoChat(): IdentidadeChat | null {
    const usuario = adminClient?.autenticado ? adminClient.user : null;
    if (usuario) return { id: usuario.id, nome: usuario.name, ehDp: true, ehTi: usuario.superAdmin };
    if (employee) return { id: employee.id, nome: employee.name, ehDp: false, ehTi: false };
    return null;
  }

  handle(IpcChannels.ConversasIdentidade, async () => identidadeDoChat());

  handle(IpcChannels.ConversasApi, async (bruto) => {
    const entrada = bruto as { method?: unknown; path?: unknown; body?: unknown } | null;
    const metodo = typeof entrada?.method === 'string' ? entrada.method.toUpperCase() : '';
    const caminho = typeof entrada?.path === 'string' ? entrada.path : '';
    const permitida = ROTAS_CONVERSA.some((rota) => rota.metodo === metodo && rota.padrao.test(caminho));
    if (!permitida) {
      console.warn('[conversas] rota recusada: ' + metodo + ' ' + caminho);
      return { ok: false, dados: null, message: 'Operação não permitida.' };
    }

    // A área do TI é sempre da conta administrativa; o resto segue quem está no chat
    const comCredencialDoDp = caminho.startsWith('/api/admin/') || usandoComoDp();
    const saida = comCredencialDoDp
      ? await comAdmin((client) => client.chamar<unknown>(metodo, caminho, entrada?.body))
      : await comApi((client) => client.chamar<unknown>(metodo, caminho, entrada?.body));
    // Abrir uma conversa zera as não lidas dela: a bandeja, o título da janela e
    // o contador do menu precisam saber na hora (antes só mudavam com mensagem nova)
    if ('dados' in saida && metodo === 'POST' && caminho.endsWith('/lidas')) {
      void syncNaoLidasConversas();
      sendToMain(IpcChannels.ConversasContador, null);
    }

    return 'dados' in saida
      ? { ok: true, dados: saida.dados ?? null, message: '' }
      : { ok: false, dados: null, message: saida.message };
  });

  /** Arquivo anexado a uma mensagem: imagem, vídeo ou documento. */
  handle(IpcChannels.ConversasAnexar, async () => {
    const escolha = await dialog.showOpenDialog({
      title: 'Escolha o arquivo para enviar',
      properties: ['openFile'],
      filters: [
        {
          name: 'Imagens, vídeos e documentos',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip'],
        },
      ],
    });
    if (escolha.canceled || escolha.filePaths.length === 0) return { ok: false, midia: null, message: '' };

    const caminho = escolha.filePaths[0];
    const nome = caminho.split(/[\\/]/).pop() ?? 'arquivo';
    const mimeType = TIPOS_ANEXO[caminho.slice(caminho.lastIndexOf('.')).toLowerCase()];
    if (!mimeType) return { ok: false, midia: null, message: 'Formato não aceito.' };

    // Imagem e vídeo sem limite; documento tem teto, conferido no servidor
    const envio = usandoComoDp()
      ? await comAdmin((client) => client.enviarMidia(caminho, mimeType, nome))
      : await comApi((client) => client.enviarMidia(caminho, mimeType, nome));
    return 'dados' in envio ? { ok: true, midia: envio.dados, message: '' } : { ok: false, midia: null, message: envio.message };
  });

  /**
   * Arquivo arrastado para dentro da conversa. A tela manda o caminho no disco
   * (o preload pega com webUtils); aqui a extensão é conferida antes de subir,
   * e o servidor ainda confere o conteúdo de verdade.
   */
  handle(IpcChannels.ConversasSoltarArquivo, async (bruto) => {
    const caminho = typeof bruto === 'string' ? bruto : '';
    if (!caminho || caminho.length > 4096) return { ok: false, midia: null, message: 'Arquivo inválido.' };

    let ehArquivo = false;
    try {
      ehArquivo = (await stat(caminho)).isFile();
    } catch {
      ehArquivo = false;
    }
    if (!ehArquivo) return { ok: false, midia: null, message: 'Solte um arquivo, não uma pasta.' };

    const nome = caminho.split(/[\/]/).pop() ?? 'arquivo';
    const mimeType = TIPOS_ANEXO[caminho.slice(caminho.lastIndexOf('.')).toLowerCase()];
    if (!mimeType) {
      return { ok: false, midia: null, message: 'Formato não aceito. Envie imagem, vídeo ou documento.' };
    }

    const envio = usandoComoDp()
      ? await comAdmin((client) => client.enviarMidia(caminho, mimeType, nome))
      : await comApi((client) => client.enviarMidia(caminho, mimeType, nome));
    return 'dados' in envio ? { ok: true, midia: envio.dados, message: '' } : { ok: false, midia: null, message: envio.message };
  });

  /**
   * Mensagem de voz gravada na tela. O áudio chega em memória (é pequeno: uns
   * 250 KB por minuto), vai para um arquivo temporário e sobe como as outras mídias.
   */
  handle(IpcChannels.ConversasEnviarAudio, async (bruto) => {
    const entrada = bruto as { dados?: unknown; mimeType?: unknown; duracaoMs?: unknown } | null;
    const dados = entrada?.dados instanceof ArrayBuffer ? Buffer.from(entrada.dados) : null;
    const mimeType = typeof entrada?.mimeType === 'string' ? entrada.mimeType.split(';')[0].trim().toLowerCase() : '';
    const duracaoMs = typeof entrada?.duracaoMs === 'number' && Number.isFinite(entrada.duracaoMs) ? entrada.duracaoMs : 0;
    const extensao = ({ 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a' } as Record<string, string>)[mimeType];
    if (!dados || dados.length === 0 || !extensao) return { ok: false, midia: null, message: 'Gravação inválida.' };
    if (dados.length > 50 * 1024 * 1024) return { ok: false, midia: null, message: 'A gravação ficou grande demais.' };

    const pasta = join(app.getPath('temp'), 'comunicacao-dp-conversas');
    const nome = `mensagem-de-voz${extensao}`;
    const arquivo = join(pasta, `audio-${Date.now()}-${Math.random().toString(16).slice(2)}${extensao}`);
    try {
      await mkdir(pasta, { recursive: true });
      await writeFile(arquivo, dados);
      const envio = usandoComoDp()
        ? await comAdmin((client) => client.enviarMidia(arquivo, mimeType, nome, duracaoMs))
        : await comApi((client) => client.enviarMidia(arquivo, mimeType, nome, duracaoMs));
      return 'dados' in envio ? { ok: true, midia: envio.dados, message: '' } : { ok: false, midia: null, message: envio.message };
    } catch (err) {
      console.error('[conversas] falha ao enviar a mensagem de voz:', err);
      return { ok: false, midia: null, message: 'Não foi possível enviar a mensagem de voz.' };
    } finally {
      await rm(arquivo, { force: true }).catch(() => undefined);
    }
  });

  /**
   * Imagem colada no campo da conversa (print, imagem copiada do navegador). Chega
   * em memória, vai para um arquivo temporário e sobe como os outros anexos.
   */
  handle(IpcChannels.ConversasColarImagem, async (bruto) => {
    const entrada = bruto as { dados?: unknown; mimeType?: unknown } | null;
    const dados = entrada?.dados instanceof ArrayBuffer ? Buffer.from(entrada.dados) : null;
    const mimeType = typeof entrada?.mimeType === 'string' ? entrada.mimeType.toLowerCase() : '';
    const extensao = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' } as Record<string, string>)[mimeType];
    if (!dados || dados.length === 0 || !extensao) return { ok: false, midia: null, message: 'Esse conteúdo não é uma imagem que dá para enviar.' };

    const pasta = join(app.getPath('temp'), 'comunicacao-dp-conversas');
    const agora = new Date();
    const doDia = `${agora.getFullYear()}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}`;
    const hora = `${String(agora.getHours()).padStart(2, '0')}${String(agora.getMinutes()).padStart(2, '0')}${String(agora.getSeconds()).padStart(2, '0')}`;
    const nome = `imagem-${doDia}-${hora}${extensao}`;
    const arquivo = join(pasta, `colada-${Date.now()}-${Math.random().toString(16).slice(2)}${extensao}`);
    try {
      await mkdir(pasta, { recursive: true });
      await writeFile(arquivo, dados);
      const envio = usandoComoDp()
        ? await comAdmin((client) => client.enviarMidia(arquivo, mimeType, nome))
        : await comApi((client) => client.enviarMidia(arquivo, mimeType, nome));
      return 'dados' in envio ? { ok: true, midia: envio.dados, message: '' } : { ok: false, midia: null, message: envio.message };
    } catch (err) {
      console.error('[conversas] falha ao enviar a imagem colada:', err);
      return { ok: false, midia: null, message: 'Não foi possível enviar a imagem colada.' };
    } finally {
      await rm(arquivo, { force: true }).catch(() => undefined);
    }
  });

  /**
   * Copia a imagem de uma mensagem para a área de transferência (para colar no
   * WhatsApp, Word, e-mail...). PNG e JPG vão direto; WEBP, GIF e BMP passam
   * pelo decodificador do Chromium (uma janela escondida) e viram PNG.
   */
  handle(IpcChannels.ConversasCopiarImagem, async (bruto): Promise<OperationResult> => {
    const midiaId = typeof bruto === 'string' && MIDIA_ID.test(bruto) ? bruto : null;
    if (!midiaId) return { ok: false, message: 'Imagem inválida.' };
    const baixada = usandoComoDp()
      ? await comAdmin((client) => client.baixarMidia(midiaId))
      : await comApi((client) => client.baixarMidia(midiaId));
    if (!('dados' in baixada)) return baixada;
    try {
      let imagem = nativeImage.createFromBuffer(baixada.dados);
      if (imagem.isEmpty()) imagem = await decodificarNoChromium(baixada.dados);
      if (imagem.isEmpty()) return { ok: false, message: 'Não consegui copiar essa imagem.' };
      // Electron 44: área de transferência no padrão do navegador (ClipboardItem)
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(imagem.toPNG())], { type: 'image/png' }) })]);
      return { ok: true, message: 'Imagem copiada. Cole com Ctrl+V.' };
    } catch (err) {
      console.error('[conversas] falha ao copiar a imagem:', err);
      return { ok: false, message: 'Não consegui copiar essa imagem.' };
    }
  });

  /** WEBP/GIF/BMP: o nativeImage só lê PNG e JPG; o Chromium desenha e devolve PNG */
  async function decodificarNoChromium(dados: Buffer): Promise<Electron.NativeImage> {
    const janela = new BrowserWindow({ show: false, width: 1, height: 1, webPreferences: { offscreen: true, sandbox: true } });
    try {
      await janela.loadURL('data:text/html,<html></html>');
      const png: string = await janela.webContents.executeJavaScript(`
        (async () => {
          const bytes = Uint8Array.from(atob(${JSON.stringify(dados.toString('base64'))}), (c) => c.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes]));
          const tela = document.createElement('canvas');
          tela.width = bitmap.width;
          tela.height = bitmap.height;
          tela.getContext('2d').drawImage(bitmap, 0, 0);
          return tela.toDataURL('image/png');
        })()
      `);
      return nativeImage.createFromDataURL(png);
    } catch {
      return nativeImage.createEmpty();
    } finally {
      janela.destroy();
    }
  }

  /** Documento recebido no chat: baixa e abre no programa padrão do Windows. */
  handle(IpcChannels.ConversasAbrirArquivo, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { midiaId?: unknown; nome?: unknown } | null;
    const midiaId = typeof entrada?.midiaId === 'string' && MIDIA_ID.test(entrada.midiaId) ? entrada.midiaId : null;
    if (!midiaId) return { ok: false, message: 'Arquivo inválido.' };
    // O nome vem da tela só para o arquivo temporário sair com um nome legível
    const nome = (typeof entrada?.nome === 'string' ? entrada.nome : 'arquivo').replace(NOME_PROIBIDO, '_').slice(0, 120);

    const baixado = usandoComoDp()
      ? await comAdmin((client) => client.baixarMidia(midiaId))
      : await comApi((client) => client.baixarMidia(midiaId));
    if (!('dados' in baixado)) return baixado;

    const pasta = join(app.getPath('temp'), 'comunicacao-dp-conversas');
    const arquivo = join(pasta, `${midiaId}-${nome}`);
    try {
      await mkdir(pasta, { recursive: true });
      await writeFile(arquivo, baixado.dados);
      const falha = await shell.openPath(arquivo);
      if (falha) return { ok: false, message: `O Windows não conseguiu abrir o arquivo: ${falha}` };
      return { ok: true, message: `Abrindo ${nome}...` };
    } catch (err) {
      console.error('[conversas] falha ao gravar o arquivo temporário:', err);
      return { ok: false, message: 'Não foi possível abrir o arquivo neste computador.' };
    }
  });

  // ---------------------------------------------------------------- atalhos e foto de perfil

  const DESTINOS_VALIDOS: DestinoAtalho[] = ['COMUNICADOS', 'CHAT', 'PERFIL', 'CONFIGURACOES', 'MURAL'];
  const COR_VALIDA = /^#[0-9a-fA-F]{6}$/;

  /** Confere o que veio da tela antes de mandar para o servidor. */
  function lerDadosAtalho(bruto: unknown): DadosAtalho | null {
    if (!bruto || typeof bruto !== 'object') return null;
    const { rotulo, icone, cor, destino } = bruto as Record<string, unknown>;
    if (typeof rotulo !== 'string' || !rotulo.trim() || rotulo.length > 24) return null;
    if (typeof icone !== 'string' || !icone.trim() || icone.length > 24) return null;
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

  /** Reação ao recado do mural, em nome do funcionário logado neste PC */
  handle(IpcChannels.MuralReagir, async (bruto): Promise<OperationResult> => {
    const entrada = bruto as { postId?: unknown; emoji?: unknown } | null;
    const postId = typeof entrada?.postId === 'string' && /^MUR-[0-9a-f]{24}$/.test(entrada.postId) ? entrada.postId : null;
    const emoji = typeof entrada?.emoji === 'string' && entrada.emoji.length <= 16 ? entrada.emoji : null;
    if (!postId) return { ok: false, message: 'Recado inválido.' };
    const resposta = await comApi((client) => client.chamar('PUT', `/api/mural/${postId}/reacao`, { emoji }));
    if (!('dados' in resposta)) return resposta;
    await syncMural(); // o recado volta com as reações atualizadas
    return { ok: true, message: '' };
  });

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

  /** Foto original aceita para enquadrar (o recorte sai bem menor) */
  const FOTO_ORIGINAL_MAX = 25 * 1024 * 1024;
  /** Recorte que a tela devolve: JPEG quadrado de 512 px */
  const FOTO_RECORTE_MAX = 3 * 1024 * 1024;

  /**
   * Escolhe a imagem no disco e devolve para a tela, que mostra o enquadramento.
   * Nada vai ao servidor aqui: só o recorte final é enviado (FotoSalvar).
   */
  handle(IpcChannels.FotoEscolher, async () => {
    const escolhida = await escolherImagem('Escolha a sua foto');
    if (!escolhida) return { ok: false, dataUrl: null, message: '' };
    if (escolhida.erro) return { ok: false, dataUrl: null, message: escolhida.erro };
    try {
      if ((await stat(escolhida.caminho)).size > FOTO_ORIGINAL_MAX) {
        return { ok: false, dataUrl: null, message: 'A imagem passa de 25 MB. Escolha uma menor.' };
      }
      const bytes = await readFile(escolhida.caminho);
      return { ok: true, dataUrl: `data:${escolhida.mimeType};base64,${bytes.toString('base64')}`, message: '' };
    } catch (err) {
      console.error('[perfil] falha ao ler a imagem:', err);
      return { ok: false, dataUrl: null, message: 'Não foi possível ler a imagem.' };
    }
  });

  /** A foto atual, para a pessoa enquadrar de novo. */
  handle(IpcChannels.FotoAtual, async () => {
    const atual = foto;
    if (!atual) return { ok: false, dataUrl: null, message: '' };
    const baixada = await comApi((client) => client.baixarMidia(atual.id));
    if (!('dados' in baixada)) return { ok: false, dataUrl: null, message: baixada.message };
    return { ok: true, dataUrl: `data:${atual.mimeType};base64,${baixada.dados.toString('base64')}`, message: '' };
  });

  /** Recebe o recorte da tela, envia ao servidor e passa a ser a foto da pessoa. */
  handle(IpcChannels.FotoSalvar, async (bruto): Promise<OperationResult> => {
    const jpeg = bruto instanceof Uint8Array ? Buffer.from(bruto) : null;
    // Confere a assinatura do JPEG: só o recorte gerado pela tela chega aqui
    if (!jpeg || jpeg.length < 4 || jpeg.length > FOTO_RECORTE_MAX || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      return { ok: false, message: 'Imagem inválida.' };
    }
    const pasta = join(app.getPath('temp'), 'comunicacao-dp-perfil');
    const arquivo = join(pasta, `foto-${Date.now()}.jpg`);
    try {
      await mkdir(pasta, { recursive: true });
      await writeFile(arquivo, jpeg);
      const envio = await comApi(async (client) => {
        const midia = await client.enviarMidia(arquivo, 'image/jpeg', 'foto-perfil.jpg');
        return client.definirFoto(midia.id);
      });
      if (!('dados' in envio)) return envio;
      await syncPerfil();
      return { ok: true, message: 'Foto atualizada.' };
    } finally {
      await rm(arquivo, { force: true }).catch(() => undefined);
    }
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

  // "Responder" no alerta de mensagem: abre o aplicativo já na conversa
  popup.on('conversa', (conversaId) => {
    showMainWindow();
    sendToMain(IpcChannels.OpenConversa, conversaId);
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
    void refreshSession(client).then(() =>
      Promise.all([syncWithServer(), syncMural(), syncPerfil(), syncNaoLidasConversas()]),
    );
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
    void syncNaoLidasConversas();
  });

  // O DP trocou o recado do mural: busca na hora, sem esperar reconectar
  connection.on('mural', () => {
    void syncMural();
  });

  // Chat novo: a tela de mensagens recarrega a conversa e a lista
  connection.on('conversa', (conversaId, aviso) => {
    sendToMain(IpcChannels.ConversasChanged, conversaId);
    void syncNaoLidasConversas();
    alertarMensagem(conversaId, aviso);
  });

  connection.on('message', (message) => {
    if (!store.add(message)) return;
    console.log(`[mensagem] recebida ${message.id} (${message.type}): ${message.title}`);
    popup.enqueue([message]);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
  });

  // O TI apagou comunicados ou conversas: refaz as listas a partir do servidor
  connection.on('limpeza', (o) => {
    console.log(`[limpeza] o TI apagou ${o}: atualizando`);
    if (o === 'comunicados') void syncWithServer();
    else {
      sendToMain(IpcChannels.ConversasChanged, CONVERSAS_LIMPAS);
      void syncNaoLidasConversas();
    }
  });

  connection.on('lembrete', (messageId) => {
    const message = store.get(messageId);
    if (!message) return;
    // Já leu (e já confirmou, quando o comunicado pede): não incomoda de novo
    const pendente = !message.read || (message.exigeCiencia && !message.cienteEm);
    if (!pendente) return;
    console.log(`[mensagem] lembrete do DP para ${messageId}`);
    popup.enqueue([message]);
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
      horario: horarioAtualizacao() ?? undefined,
      log: (mensagem) => console.log(`[atualizador] ${mensagem}`),
      avisarTela: (info) => {
        // Obrigatória fecha o aplicativo mesmo com alguém usando o PC: a janela
        // vem para a frente (pode estar na bandeja) para o aviso ser visto
        if (info?.obrigatoria) {
          const janela = ensureMainWindow();
          if (janela.isMinimized()) janela.restore();
          janela.show();
          janela.focus();
        }
        sendToMain(IpcChannels.AtualizacaoInstalando, info);
      },
    });
    atualizador.iniciar();

    // Publicaram pelo versionador: confere na hora, em vez de esperar as 03:00
    connection.on('atualizacao', (versao) => {
      void atualizador.verificarSeVelha(`aviso do servidor (versão ${versao})`, 10_000);
    });
    // Conexão de volta: cobre a verificação que caiu por estar offline
    connection.on('connected', () => {
      void atualizador.verificarSeVelha('conexão restabelecida', 60 * 60_000);
    });

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
