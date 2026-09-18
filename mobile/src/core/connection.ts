/**
 * Conexão com o servidor: registra o aparelho, abre o WebSocket e mantém tudo sincronizado.
 *
 * Mesmo fluxo do app do computador: registro (REST, recebe token) → WebSocket com o token →
 * eventos em tempo real. Se cair, tenta de novo com intervalo progressivo e aleatório.
 * Roda uma vez por processo: o serviço em segundo plano e a tela chamam boot() e compartilham tudo.
 */
import { AppState, Linking, Vibration, type AppStateStatus } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import DpNative from '../specs/NativeDpNative';
import { ApiClient, ApiError, normalizeServerUrl, testServer } from './api';
import { loadConfig, saveConfig } from './storage';
import { getState, setState, type NavRequest } from './store';
import { TYPE_LABELS, type ChatMessage, type DeviceConfig, type DpMessage, type EmployeeProfile, type OperationResult } from './types';
import { messageSeq, parseChatMessage, parseEmployee, parseMessage } from './validation';

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const FIRST_RETRY_SPREAD_MS = 5_000;

let config: DeviceConfig | null = null;
let api: ApiClient | null = null;
let socket: Socket | null = null;
let generation = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = MIN_RETRY_MS;
let everConnected = false;
let booting: Promise<void> | null = null;
let contactsTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------- início

/** Carrega a configuração e conecta. Pode ser chamado várias vezes (só roda uma). */
export function boot(): Promise<void> {
  if (!booting) booting = doBoot();
  return booting;
}

async function doBoot(): Promise<void> {
  config = await loadConfig();
  if (!config.deviceId || !config.deviceSecret) {
    config.deviceId = `CEL-${await DpNative.randomHex(6)}`;
    config.deviceSecret = await DpNative.randomHex(32);
    await saveConfig(config);
  }
  const device = await DpNative.getDeviceInfo();
  setState({
    booted: true,
    serverUrl: config.serverUrl,
    deviceId: config.deviceId,
    device: { manufacturer: device.manufacturer, model: device.model, appVersion: device.appVersion, sdkInt: device.sdkInt },
  });

  AppState.addEventListener('change', onAppStateChange);
  DpNative.onNotificationOpened(() => void consumeLaunchPayload());
  void consumeLaunchPayload();

  if (isConfigured()) {
    DpNative.setAutostart(true);
    connect();
  }
}

function isConfigured(): boolean {
  return Boolean(config?.serverUrl);
}

function onAppStateChange(next: AppStateStatus): void {
  if (next !== 'active') return;
  // Voltou para o app: se estava sem conexão, tenta agora (sem esperar o intervalo)
  const status = getState().connection.status;
  if (isConfigured() && (status === 'disconnected' || status === 'reconnecting')) reconnectNow();
  // A conversa aberta foi vista
  const openChatId = getState().openChatId;
  if (openChatId) void markChatRead(openChatId);
}

// ---------------------------------------------------------------- conexão

function deviceInfo() {
  const d = getState().device;
  const hostname = d ? `${d.manufacturer} ${d.model}`.trim().slice(0, 200) || 'Celular' : 'Celular';
  return { computerId: config!.deviceId!, hostname, appVersion: d?.appVersion ?? '1.0.0', platform: 'android' };
}

function setConnection(patch: Partial<ReturnType<typeof getState>['connection']>): void {
  setState((s) => ({ connection: { ...s.connection, ...patch } }));
  updateServiceText();
}

function updateServiceText(): void {
  const { connection, employee } = getState();
  const text =
    connection.status === 'connected'
      ? `Conectado${employee ? ` · ${employee.name}` : ''}`
      : connection.status === 'unauthorized'
        ? 'Registro recusado pelo servidor. Abra o app.'
        : connection.status === 'not-configured'
          ? 'Abra o app para configurar'
          : 'Sem conexão com o servidor. Tentando de novo...';
  try {
    DpNative.updateServiceStatus(text);
  } catch {
    /* serviço ainda não iniciado */
  }
}

function connect(): void {
  const current = ++generation;
  clearRetry();
  closeSocket();
  if (!config || !isConfigured()) {
    setConnection({ status: 'not-configured', nextRetryAt: null });
    return;
  }
  api = new ApiClient(config.serverUrl!);
  setConnection({ status: everConnected ? 'reconnecting' : 'connecting', nextRetryAt: null });

  void (async () => {
    try {
      const token = await api!.registerDevice(deviceInfo(), config!.deviceSecret!);
      if (current !== generation) return;
      api!.setToken(token);
      openSocket(config!.serverUrl!, token, current);
    } catch (err) {
      if (current !== generation) return;
      scheduleRetry(err, err instanceof ApiError && err.isAuthError);
    }
  })();
}

function openSocket(serverUrl: string, token: string, current: number): void {
  const s = io(serverUrl, {
    transports: ['websocket'],
    reconnection: false, // reconexão controlada aqui, para sempre registrar de novo
    timeout: 10_000,
    auth: { ...deviceInfo(), token },
  });

  s.on('connect', () => {
    if (current !== generation) return;
    everConnected = true;
    retryDelay = MIN_RETRY_MS;
    setConnection({ status: 'connected', lastError: null, nextRetryAt: null });
    void syncAll();
  });
  s.on('message:new', (payload: unknown) => {
    if (current !== generation) return;
    const message = parseMessage(payload);
    if (message) onNewMessage(message);
  });
  s.on('chat:message', (payload: unknown) => {
    if (current !== generation) return;
    const message = parseChatMessage(payload);
    if (message) onChatMessage(message);
  });
  s.on('session:changed', (payload: unknown) => {
    if (current !== generation) return;
    const raw = typeof payload === 'object' && payload !== null ? (payload as { employee?: unknown }).employee : undefined;
    setEmployee(raw === null ? null : parseEmployee(raw));
    void syncAll();
  });
  s.on('connect_error', (err) => {
    if (current !== generation) return;
    closeSocket();
    scheduleRetry(err, false);
  });
  s.on('disconnect', (reason) => {
    if (current !== generation) return;
    closeSocket();
    scheduleRetry(new Error(`Conexão perdida (${reason})`), false);
  });
  socket = s;
}

function closeSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

function clearRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(err: unknown, unauthorized: boolean): void {
  clearRetry();
  if (unauthorized) retryDelay = MAX_RETRY_MS;
  // Primeira tentativa depois de uma queda: espalha os aparelhos entre 1 e 6 s (servidor reiniciado)
  const firstAfterDrop = everConnected && retryDelay === MIN_RETRY_MS;
  const delay = firstAfterDrop
    ? Math.round(MIN_RETRY_MS + Math.random() * FIRST_RETRY_SPREAD_MS)
    : Math.round(retryDelay * (0.8 + Math.random() * 0.4));
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
  setConnection({
    status: unauthorized ? 'unauthorized' : 'disconnected',
    nextRetryAt: Date.now() + delay,
    lastError: err instanceof Error ? err.message : String(err),
  });
  retryTimer = setTimeout(connect, delay);
}

export function reconnectNow(): void {
  retryDelay = MIN_RETRY_MS;
  connect();
}

// ---------------------------------------------------------------- sincronização

async function syncAll(): Promise<void> {
  const client = api;
  if (!client) return;
  try {
    setEmployee(await client.getSession());
  } catch (err) {
    console.warn('[sessão]', err);
  }
  await Promise.all([syncMessages(), syncContacts()]);
}

async function syncMessages(): Promise<void> {
  const client = api;
  if (!client) return;
  try {
    const messages = await client.listMessages();
    setState({ messages });
    alertUnseen(messages);
  } catch (err) {
    console.warn('[comunicados]', err);
  }
}

async function syncContacts(): Promise<void> {
  const client = api;
  if (!client || !getState().employee) {
    setState({ contacts: [], chatUnread: 0 });
    return;
  }
  try {
    const contacts = await client.getChatContacts();
    setState({ contacts, chatUnread: contacts.reduce((sum, c) => sum + c.unreadCount, 0) });
  } catch (err) {
    console.warn('[chat]', err);
  }
}

function syncContactsSoon(): void {
  if (contactsTimer) clearTimeout(contactsTimer);
  contactsTimer = setTimeout(() => void syncContacts(), 400);
}

function setEmployee(employee: EmployeeProfile | null): void {
  const previous = getState().employee;
  setState({ employee, employeeChecked: true });
  if (!employee) setState({ contacts: [], chatUnread: 0, openChatId: null, thread: [] });
  if (previous?.id !== employee?.id) updateServiceText();
}

// ---------------------------------------------------------------- avisos

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

/**
 * Aviso único de "vários comunicados novos". Como as notificações de comunicado são fixas
 * (não saem com um deslize), esta precisa ser cancelada quando não houver mais não lidos —
 * senão ficaria presa na barra para sempre.
 */
const RESUMO_NOTIFICATION_ID = 9_000;

/** Comunicados não lidos que ainda não foram avisados (ex.: chegaram com o celular desligado) */
function alertUnseen(messages: DpMessage[]): void {
  if (!config) return;
  const unseen = messages
    .filter((m) => !m.read && messageSeq(m.id) > config!.lastAlertedSeq)
    .sort((a, b) => messageSeq(a.id) - messageSeq(b.id));
  if (unseen.length === 0) return;
  if (unseen.length > 3 && !isAppActive()) {
    // Muitos de uma vez: um aviso só, para não encher a tela
    void DpNative.showNotification(
      RESUMO_NOTIFICATION_ID,
      unseen.some((m) => m.type === 'URGENTE') ? 'urgentes' : 'comunicados',
      `${unseen.length} comunicados novos do DP`,
      unseen.map((m) => `• ${m.title}`).join('\n'),
      false,
      '',
    );
  } else {
    for (const message of unseen) alertMessage(message);
  }
  rememberAlerted(messageSeq(unseen[unseen.length - 1].id));
}

function rememberAlerted(seq: number): void {
  if (!config || seq <= config.lastAlertedSeq) return;
  config.lastAlertedSeq = seq;
  void saveConfig(config);
}

function alertMessage(message: DpMessage): void {
  const urgent = message.type === 'URGENTE';
  if (isAppActive()) {
    // App aberto: alerta na tela, com som e vibração
    setState((s) => (s.alert ? { alertQueue: [...s.alertQueue, message] } : { alert: message }));
    DpNative.playAlertSound();
    Vibration.vibrate(urgent ? [0, 500, 200, 500] : 300);
    return;
  }
  void DpNative.showNotification(
    messageSeq(message.id),
    urgent ? 'urgentes' : 'comunicados',
    `${TYPE_LABELS[message.type]} do DP: ${message.title}`,
    message.content,
    urgent,
    JSON.stringify({ kind: 'message', id: message.id } satisfies NavRequest),
  );
}

function onNewMessage(message: DpMessage): void {
  setState((s) => ({ messages: [message, ...s.messages.filter((m) => m.id !== message.id)] }));
  if (!config || messageSeq(message.id) > config.lastAlertedSeq) {
    alertMessage(message);
    rememberAlerted(messageSeq(message.id));
  }
}

/** ID estável da notificação de cada conversa */
function chatNotificationId(dpUserId: string): number {
  let hash = 0;
  for (const ch of dpUserId) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000;
  return 500_000 + hash;
}

function onChatMessage(message: ChatMessage): void {
  const { openChatId, thread } = getState();
  const existing = thread.find((m) => m.id === message.id);
  if (openChatId === message.dpUserId) {
    setState({
      thread: existing ? thread.map((m) => (m.id === message.id ? message : m)) : [...thread, message].sort((a, b) => a.id - b.id),
    });
  }
  syncContactsSoon();

  if (message.senderType !== 'DP' || existing) return;
  const viewing = isAppActive() && openChatId === message.dpUserId;
  if (viewing) {
    void markChatRead(message.dpUserId);
    return;
  }
  if (!isAppActive()) {
    void DpNative.showNotification(
      chatNotificationId(message.dpUserId),
      'chat',
      message.senderName,
      message.automatic ? `🤖 ${message.content}` : message.content,
      false,
      JSON.stringify({ kind: 'chat', dpUserId: message.dpUserId } satisfies NavRequest),
    );
  }
}

async function consumeLaunchPayload(): Promise<void> {
  const payload = await DpNative.consumeLaunchPayload();
  if (!payload) return;
  try {
    const request = JSON.parse(payload) as NavRequest;
    if (request.kind === 'message' || request.kind === 'chat') setState({ navRequest: request });
  } catch {
    /* payload inválido: ignora */
  }
}

// ---------------------------------------------------------------- ações da tela

export { testServer };

export async function saveServer(rawUrl: string): Promise<OperationResult> {
  await boot();
  const serverUrl = normalizeServerUrl(rawUrl);
  if (!serverUrl) return { ok: false, message: 'Informe o endereço do servidor.' };
  const test = await testServer(serverUrl);
  if (!test.ok) return test;
  config = { ...config!, serverUrl };
  await saveConfig(config);
  setState({ serverUrl });
  DpNative.setAutostart(true);
  DpNative.startService();
  everConnected = false;
  reconnectNow();
  return { ok: true, message: 'Configuração salva.' };
}

function friendly(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export async function login(registration: string, password: string): Promise<OperationResult> {
  if (!api || getState().connection.status !== 'connected') return { ok: false, message: 'Sem conexão com o servidor.' };
  try {
    const employee = await api.loginEmployee(registration.trim(), password);
    setEmployee(employee);
    await Promise.all([syncMessages(), syncContacts()]);
    return { ok: true, message: `Bem-vindo(a), ${employee.name}!` };
  } catch (err) {
    return { ok: false, message: friendly(err, 'Não foi possível entrar. Tente novamente.') };
  }
}

export async function logout(): Promise<OperationResult> {
  try {
    await api?.logoutEmployee();
  } catch (err) {
    return { ok: false, message: friendly(err, 'Não foi possível sair agora.') };
  }
  setEmployee(null);
  void syncMessages();
  return { ok: true, message: 'Você saiu.' };
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<OperationResult> {
  if (!api) return { ok: false, message: 'Sem conexão com o servidor.' };
  try {
    await api.changePassword(currentPassword, newPassword);
    const employee = getState().employee;
    if (employee) setEmployee({ ...employee, mustChangePassword: false });
    return { ok: true, message: 'Senha alterada.' };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return { ok: false, message: 'Senha atual incorreta.' };
    return { ok: false, message: friendly(err, 'Não foi possível trocar a senha.') };
  }
}

/**
 * Endereço temporário para abrir um anexo. Null quando não há conexão com o servidor
 * (o link vale 5 minutos e serve tanto para a miniatura quanto para abrir o arquivo).
 */
export async function attachmentLink(attachmentId: string): Promise<string | null> {
  if (!api) return null;
  try {
    return await api.getAttachmentLink(attachmentId);
  } catch (err) {
    console.warn('[anexos] não foi possível obter o link', err);
    return null;
  }
}

/** Abre o anexo no aplicativo do celular que cuida daquele tipo de arquivo. */
export async function openAttachment(attachmentId: string): Promise<OperationResult> {
  const link = await attachmentLink(attachmentId);
  if (!link) {
    return { ok: false, message: 'Sem conexão com o servidor. Abra o anexo quando o app estiver conectado.' };
  }
  try {
    await Linking.openURL(link);
    return { ok: true, message: '' };
  } catch {
    return { ok: false, message: 'Nenhum aplicativo neste celular abre esse tipo de arquivo.' };
  }
}

export async function markRead(messageId: string): Promise<void> {
  const message = getState().messages.find((m) => m.id === messageId);
  if (!message || message.read) return;
  const now = new Date().toISOString();
  setState((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? { ...m, read: true, readAt: now } : m)) }));
  DpNative.cancelNotification(messageSeq(messageId));
  // Notificação fixa: o resumo só sai quando não sobrar comunicado por ler
  if (!getState().messages.some((m) => !m.read)) DpNative.cancelNotification(RESUMO_NOTIFICATION_ID);
  try {
    await api?.markRead(messageId);
  } catch (err) {
    console.warn('[comunicados] leitura não registrada', err);
  }
}

export async function openChat(dpUserId: string | null): Promise<void> {
  setState({ openChatId: dpUserId, thread: [], threadLoading: dpUserId !== null });
  if (!dpUserId || !api) return;
  DpNative.cancelNotification(chatNotificationId(dpUserId));
  try {
    const thread = await api.getChat(dpUserId);
    if (getState().openChatId === dpUserId) setState({ thread, threadLoading: false });
    await markChatRead(dpUserId);
  } catch (err) {
    setState({ threadLoading: false });
    console.warn('[chat]', err);
  }
}

async function markChatRead(dpUserId: string): Promise<void> {
  const contact = getState().contacts.find((c) => c.id === dpUserId);
  if (!api || !contact || contact.unreadCount === 0) return;
  setState((s) => {
    const contacts = s.contacts.map((c) => (c.id === dpUserId ? { ...c, unreadCount: 0 } : c));
    return { contacts, chatUnread: contacts.reduce((sum, c) => sum + c.unreadCount, 0) };
  });
  try {
    await api.markChatRead(dpUserId);
  } catch (err) {
    console.warn('[chat] leitura não registrada', err);
  }
}

export async function sendChat(dpUserId: string, content: string): Promise<OperationResult> {
  const text = content.trim();
  if (!text) return { ok: false, message: 'Escreva a mensagem.' };
  if (!api) return { ok: false, message: 'Sem conexão com o servidor.' };
  try {
    const message = await api.sendChat(dpUserId, text);
    onChatMessage(message);
    return { ok: true, message: 'Enviada.' };
  } catch (err) {
    return { ok: false, message: friendly(err, 'Não foi possível enviar.') };
  }
}

/** Fecha o alerta da tela e mostra o próximo da fila */
export function dismissAlert(): void {
  setState((s) => ({ alert: s.alertQueue[0] ?? null, alertQueue: s.alertQueue.slice(1) }));
}

export function clearNavRequest(): void {
  setState({ navRequest: null });
}

/** Garante o serviço rodando quando o app é aberto (ex.: depois de "Forçar parada") */
export async function ensureService(): Promise<void> {
  if (isConfigured() && !(await DpNative.isServiceRunning())) DpNative.startService();
}
