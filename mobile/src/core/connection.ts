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
import { ApiClient, ApiError, normalizeServerUrl, testServer, type Metodo } from './api';
import { lerAtualizacaoRapida, verificarAtualizacao } from './atualizacao';
import { loadConfig, saveConfig } from './storage';
import { getState, setState, type NavRequest } from './store';
import {
  TYPE_LABELS,
  type Atalho,
  type AvisoDeMensagem,
  type ConversaResumo,
  type DeviceConfig,
  type DpMessage,
  type EmployeeProfile,
  type MidiaPublica,
  type MuralPost,
  type OperationResult,
} from './types';
import { messageSeq, parseEmployee, parseMessage } from './validation';

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
let conversasTimer: ReturnType<typeof setTimeout> | null = null;

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
  // Com atualização rápida instalada, a versão em uso é a dela (é a que o TI vê em Aparelhos)
  const versaoRapida = await lerAtualizacaoRapida();
  setState({
    booted: true,
    serverUrl: config.serverUrl,
    deviceId: config.deviceId,
    device: {
      manufacturer: device.manufacturer,
      model: device.model,
      appVersion: versaoRapida || device.appVersion,
      apkVersion: device.appVersion,
      sdkInt: device.sdkInt,
    },
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
  const aberta = getState().conversaAberta;
  if (aberta) void marcarConversaLida(aberta);
}

/** Cliente da API já autenticado (null enquanto não conectou) */
export function getApi(): ApiClient | null {
  return api;
}

/**
 * Chamada à API para as telas, no mesmo formato do app do computador:
 * nunca lança erro, devolve { ok, dados, message }.
 */
export async function chamar<T = unknown>(
  method: Metodo,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; dados: T | null; message: string }> {
  if (!api) return { ok: false, dados: null, message: 'Sem conexão com o servidor.' };
  try {
    return { ok: true, dados: await api.request<T>(method, path, body), message: '' };
  } catch (err) {
    return { ok: false, dados: null, message: friendly(err, 'Não foi possível falar com o servidor.') };
  }
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
  const client = new ApiClient(config.serverUrl!);
  setConnection({ status: everConnected ? 'reconnecting' : 'connecting', nextRetryAt: null });

  void (async () => {
    try {
      const token = await client.registerDevice(deviceInfo(), config!.deviceSecret!);
      if (current !== generation) return;
      client.setToken(token);
      api = client;
      setState((s) => ({ sessao: s.sessao + 1 }));
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
  const valido = () => current === generation;

  s.on('connect', () => {
    if (!valido()) return;
    everConnected = true;
    retryDelay = MIN_RETRY_MS;
    setConnection({ status: 'connected', lastError: null, nextRetryAt: null });
    void syncAll();
  });
  s.on('message:new', (payload: unknown) => {
    if (!valido()) return;
    const message = parseMessage(payload);
    if (message) onNewMessage(message);
  });
  // O DP cutucou quem ainda não leu: o aviso do comunicado volta a aparecer
  s.on('comunicado:lembrete', (payload: unknown) => {
    if (!valido()) return;
    const id = (payload as { messageId?: unknown } | null)?.messageId;
    const message = getState().messages.find((m) => m.id === id);
    if (message) alertMessage(message, true);
    else void syncMessages();
  });
  s.on('session:changed', (payload: unknown) => {
    if (!valido()) return;
    const raw = typeof payload === 'object' && payload !== null ? (payload as { employee?: unknown }).employee : undefined;
    setEmployee(raw === null ? null : parseEmployee(raw));
    void syncAll();
  });
  s.on('conversa:atualizada', (payload: unknown) => {
    if (!valido()) return;
    const dados = (payload ?? {}) as { conversaId?: unknown; mensagem?: AvisoDeMensagem | null };
    if (typeof dados.conversaId === 'string') onConversaAtualizada(dados.conversaId, dados.mensagem ?? null);
  });
  s.on('mural:atualizado', () => {
    if (valido()) void syncMural();
  });
  // O TI apagou comunicados ou conversas: as listas vêm de novo do servidor
  s.on('dados:limpos', (payload: unknown) => {
    if (!valido()) return;
    const o = (payload as { o?: unknown } | null)?.o;
    if (o === 'comunicados') void syncMessages();
    if (o === 'conversas') {
      setState((st) => ({ limpezaConversas: st.limpezaConversas + 1 }));
      void syncConversas();
    }
  });
  s.on('chamado:atualizado', (payload: unknown) => {
    if (!valido()) return;
    const chamadoId = (payload as { chamadoId?: unknown } | null)?.chamadoId;
    setState((st) => ({ chamadosVersao: st.chamadosVersao + 1 }));
    void syncChamados().then(() => {
      if (typeof chamadoId === 'string' && !isAppActive()) {
        void DpNative.showNotification(
          idDaNotificacao(chamadoId, 700_000),
          'chat',
          'Chamado para o TI',
          'Seu chamado tem novidade. Toque para ver.',
          false,
          JSON.stringify({ kind: 'chamado', chamadoId } satisfies NavRequest),
        );
      }
    });
  });
  s.on('atualizacao:publicada', (payload: unknown) => {
    if (!valido()) return;
    const app = (payload as { app?: unknown } | null)?.app;
    if (app === 'mobile' || app === 'mobile-ota') void verificarAtualizacao();
  });
  s.on('connect_error', (err) => {
    if (!valido()) return;
    closeSocket();
    scheduleRetry(err, false);
  });
  s.on('disconnect', (reason) => {
    if (!valido()) return;
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
  await Promise.all([syncMessages(), syncConversas(), syncMural(), syncPerfil(), syncChamados()]);
  void verificarAtualizacao();
}

export async function syncMessages(): Promise<void> {
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

export async function syncConversas(): Promise<void> {
  const client = api;
  if (!client || !getState().employee) {
    setState({ conversas: [], conversasNaoLidas: 0 });
    return;
  }
  try {
    const { conversas } = await client.request<{ conversas: ConversaResumo[] }>('GET', '/api/conversas');
    const aberta = getState().conversaAberta;
    // A conversa aberta na tela já está lida (a marcação no servidor vem logo depois)
    const lista = conversas.map((c) => (c.id === aberta ? { ...c, naoLidas: 0 } : c));
    setState({ conversas: lista, conversasNaoLidas: lista.reduce((soma, c) => soma + c.naoLidas, 0) });
  } catch (err) {
    console.warn('[conversas]', err);
  }
}

function syncConversasLogo(): void {
  if (conversasTimer) clearTimeout(conversasTimer);
  conversasTimer = setTimeout(() => void syncConversas(), 300);
}

export async function syncMural(): Promise<void> {
  const client = api;
  if (!client) return;
  try {
    const { post } = await client.request<{ post: MuralPost | null }>('GET', '/api/mural');
    setState({ mural: post ?? null });
  } catch (err) {
    console.warn('[mural]', err);
  }
}

/** Atalhos e foto de perfil de quem está logado */
export async function syncPerfil(): Promise<void> {
  const client = api;
  if (!client || !getState().employee) {
    setState({ atalhos: [], foto: null });
    return;
  }
  try {
    const [atalhos, foto] = await Promise.all([
      client.request<{ atalhos?: Atalho[] }>('GET', '/api/atalhos'),
      client.request<{ foto?: MidiaPublica | null }>('GET', '/api/perfil/foto'),
    ]);
    setState({ atalhos: atalhos.atalhos ?? [], foto: foto.foto ?? null });
  } catch (err) {
    console.warn('[perfil]', err);
  }
}

export async function syncChamados(): Promise<void> {
  const client = api;
  if (!client || !getState().employee) {
    setState({ chamadosNaoLidos: 0 });
    return;
  }
  try {
    const resumo = await client.request<{ naoLidas?: number }>('GET', '/api/chamados/resumo');
    setState({ chamadosNaoLidos: Number(resumo.naoLidas ?? 0) });
  } catch (err) {
    console.warn('[chamados]', err);
  }
}

function setEmployee(employee: EmployeeProfile | null): void {
  const previous = getState().employee;
  setState({ employee, employeeChecked: true });
  if (!employee) {
    setState({ conversas: [], conversasNaoLidas: 0, conversaAberta: null, atalhos: [], foto: null, chamadosNaoLidos: 0 });
  }
  if (previous?.id !== employee?.id) updateServiceText();
}

// ---------------------------------------------------------------- avisos

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

/** ID estável de notificação a partir de um texto (conversa, chamado) */
function idDaNotificacao(chave: string, base: number): number {
  let hash = 0;
  for (const ch of chave) hash = (hash * 31 + ch.charCodeAt(0)) % 100_000;
  return base + hash;
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
  // O servidor tem menos comunicados do que este celular lembra (banco recriado ou
  // outro servidor): recomeça a contagem, senão os novos nunca seriam avisados
  const maiorNoServidor = messages.reduce((maior, m) => Math.max(maior, messageSeq(m.id)), 0);
  if (maiorNoServidor < config.lastAlertedSeq) {
    config.lastAlertedSeq = maiorNoServidor;
    void saveConfig(config);
  }
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

function alertMessage(message: DpMessage, lembrete = false): void {
  const urgent = message.type === 'URGENTE';
  if (isAppActive()) {
    // App aberto: alerta na tela, com som e vibração
    setState((s) =>
      s.alert?.id === message.id || s.alertQueue.some((m) => m.id === message.id)
        ? {}
        : s.alert
          ? { alertQueue: [...s.alertQueue, message] }
          : { alert: message },
    );
    DpNative.playAlertSound();
    Vibration.vibrate(urgent ? [0, 500, 200, 500] : 300);
    return;
  }
  void DpNative.showNotification(
    messageSeq(message.id),
    urgent ? 'urgentes' : 'comunicados',
    `${lembrete ? 'Lembrete: ' : ''}${TYPE_LABELS[message.type]} do DP: ${message.title}`,
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

function onConversaAtualizada(conversaId: string, aviso: AvisoDeMensagem | null): void {
  setState((s) => ({ conversaVersao: { ...s.conversaVersao, [conversaId]: (s.conversaVersao[conversaId] ?? 0) + 1 } }));
  syncConversasLogo();

  const eu = getState().employee?.id;
  if (!aviso || aviso.autorId === eu) return;
  const vendo = isAppActive() && getState().conversaAberta === conversaId;
  if (vendo) {
    void marcarConversaLida(conversaId);
    return;
  }
  if (isAppActive()) {
    Vibration.vibrate(120);
    return;
  }
  void DpNative.showNotification(
    idDaNotificacao(conversaId, 500_000),
    'chat',
    aviso.grupo ? `${aviso.autorNome} · ${aviso.grupo}` : aviso.autorNome,
    aviso.resumo,
    false,
    JSON.stringify({ kind: 'conversa', conversaId } satisfies NavRequest),
  );
}

async function consumeLaunchPayload(): Promise<void> {
  const payload = await DpNative.consumeLaunchPayload();
  if (!payload) return;
  try {
    const request = JSON.parse(payload) as NavRequest;
    if (['message', 'conversa', 'chamado', 'atualizacao'].includes(request.kind)) setState({ navRequest: request });
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
  // Outro servidor: a numeração dos comunicados é outra, a contagem de avisos recomeça
  config = { ...config!, serverUrl, lastAlertedSeq: serverUrl === config!.serverUrl ? config!.lastAlertedSeq : 0 };
  await saveConfig(config);
  setState({ serverUrl });
  DpNative.setAutostart(true);
  DpNative.startService();
  everConnected = false;
  reconnectNow();
  return { ok: true, message: 'Configuração salva.' };
}

export function friendly(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export async function login(registration: string, password: string): Promise<OperationResult> {
  if (!api || getState().connection.status !== 'connected') return { ok: false, message: 'Sem conexão com o servidor.' };
  try {
    const employee = await api.loginEmployee(registration.trim(), password);
    setEmployee(employee);
    await Promise.all([syncMessages(), syncConversas(), syncPerfil(), syncChamados()]);
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
 * Endereço temporário para abrir um anexo de comunicado. Null quando não há conexão
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

/** Abre o anexo do comunicado no aplicativo do celular que cuida daquele tipo de arquivo. */
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

/** "Li e estou ciente" de um comunicado que pede confirmação */
export async function confirmarCiencia(messageId: string): Promise<OperationResult> {
  if (!api) return { ok: false, message: 'Sem conexão com o servidor.' };
  try {
    const cienteEm = await api.confirmarCiencia(messageId);
    setState((s) => ({ messages: s.messages.map((m) => (m.id === messageId ? { ...m, cienteEm, read: true } : m)) }));
    return { ok: true, message: 'Ciência confirmada.' };
  } catch (err) {
    return { ok: false, message: friendly(err, 'Não foi possível confirmar agora.') };
  }
}

/** A tela avisa qual conversa está aberta: enquanto ela estiver à vista, não notifica */
export function conversaEmFoco(conversaId: string | null): void {
  setState({ conversaAberta: conversaId });
  if (conversaId) {
    DpNative.cancelNotification(idDaNotificacao(conversaId, 500_000));
    void marcarConversaLida(conversaId);
  }
}

export async function marcarConversaLida(conversaId: string): Promise<void> {
  const conversa = getState().conversas.find((c) => c.id === conversaId);
  setState((s) => {
    const conversas = s.conversas.map((c) => (c.id === conversaId ? { ...c, naoLidas: 0 } : c));
    return { conversas, conversasNaoLidas: conversas.reduce((soma, c) => soma + c.naoLidas, 0) };
  });
  if (!api || (conversa && conversa.naoLidas === 0)) return;
  try {
    await api.request('POST', `/api/conversas/${conversaId}/lidas`);
  } catch (err) {
    console.warn('[conversas] leitura não registrada', err);
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
