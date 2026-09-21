import { EventEmitter } from 'node:events';
import { io, type Socket } from 'socket.io-client';
import type { ChatMessage, ComputerInfo, ConnectionState, ConnectionStatus, DpMessage, EmployeeProfile } from '../shared/types';
import { ApiError, type ApiClient } from './api-client';
import { parseChatMessage, parseEmployee, parseMessage } from './message-validation';

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Espalha a primeira reconexão depois de uma queda (servidor reiniciado derruba todos os PCs juntos) */
const FIRST_RETRY_SPREAD_MS = 5_000;

export interface ServerConnectionEvents {
  change: [ConnectionState];
  connected: [];
  message: [DpMessage];
  /** O servidor mudou a sessão do funcionário (expirou, desativado, senha redefinida, setor/turno alterado...) */
  sessionChanged: [EmployeeProfile | null];
  /** Mensagem nova no chat do funcionário logado (do DP, ou dele mesmo enviada de outro PC) */
  chat: [ChatMessage];
  /** O DP mudou o recado do mural: o app busca o novo */
  mural: [];
}

export interface ConnectionCredentials {
  computerSecret: string;
}

/**
 * Mantém a conexão em tempo real com o backend.
 *
 * Fluxo: registra o computador (REST, recebe token) -> abre o WebSocket com o token -> aguarda eventos.
 * Se cair, tenta de novo com intervalo progressivo (1s, 2s, 4s ... até 30s).
 * Não faz polling: enquanto conectado, só o WebSocket fica aberto.
 */
export class ServerConnection extends EventEmitter<ServerConnectionEvents> {
  private state: ConnectionState;
  private socket: Socket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryDelay = MIN_RETRY_MS;
  private everConnected = false;
  private stopped = false;
  /**
   * Muda a cada tentativa, parada ou reconfiguração. Resultados de tentativas antigas
   * (registro que demorou, eventos de socket velho) são descartados em vez de atrapalhar a atual.
   */
  private generation = 0;

  constructor(
    private serverUrl: string | null,
    private readonly computer: ComputerInfo,
    private readonly getCredentials: () => ConnectionCredentials,
    private api: ApiClient | null,
  ) {
    super();
    this.state = ServerConnection.initialState(serverUrl);
  }

  private static initialState(serverUrl: string | null): ConnectionState {
    return { status: serverUrl ? 'connecting' : 'not-configured', serverUrl, nextRetryAt: null, lastError: null };
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  start(): void {
    if (!this.serverUrl) {
      this.update({ status: 'not-configured' });
      return;
    }
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.clearRetry();
    this.closeSocket();
  }

  /**
   * Registra de novo imediatamente, sem esperar o intervalo de tentativa.
   * Usado quando a API recusa o token (DP liberou a credencial) e na volta da suspensão do Windows.
   */
  reconnectNow(reason: string): void {
    if (this.stopped || !this.serverUrl) return;
    console.log(`[conexão] reconectando agora: ${reason}`);
    this.clearRetry();
    this.closeSocket();
    this.retryDelay = MIN_RETRY_MS;
    void this.connect();
  }

  /** Troca o servidor ou a chave (tela Configurações) e reconecta do zero. */
  reconfigure(serverUrl: string | null, api: ApiClient | null): void {
    this.stop();
    this.serverUrl = serverUrl;
    this.api = api;
    this.everConnected = false;
    this.retryDelay = MIN_RETRY_MS;
    this.state = ServerConnection.initialState(serverUrl);
    this.emit('change', this.getState());
    this.start();
  }

  private update(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.getState());
  }

  private isStale(generation: number): boolean {
    return generation !== this.generation || this.stopped;
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    const { api, serverUrl } = this;
    if (this.stopped || !api || !serverUrl) return;

    const { computerSecret } = this.getCredentials();

    this.update({ status: this.everConnected ? 'reconnecting' : 'connecting', nextRetryAt: null });
    try {
      const token = await api.registerComputer(this.computer, computerSecret);
      if (this.isStale(generation)) return; // tentativa antiga: o token dela não vale mais
      api.setToken(token);
      this.openSocket(serverUrl, token, generation);
    } catch (err) {
      if (this.isStale(generation)) return;
      this.scheduleRetry(err, err instanceof ApiError && err.isAuthError ? 'unauthorized' : 'disconnected');
    }
  }

  private openSocket(serverUrl: string, token: string, generation: number): void {
    this.closeSocket();

    const socket = io(serverUrl, {
      transports: ['websocket'],
      reconnection: false, // a reconexão é controlada aqui, para sempre re-registrar o PC
      timeout: CONNECT_TIMEOUT_MS,
      auth: { ...this.computer, token },
    });

    socket.on('connect', () => {
      if (this.isStale(generation)) return;
      this.everConnected = true;
      this.retryDelay = MIN_RETRY_MS;
      this.update({ status: 'connected', nextRetryAt: null, lastError: null });
      this.emit('connected');
    });

    socket.on('session:changed', (payload: unknown) => {
      if (this.isStale(generation)) return;
      const raw = typeof payload === 'object' && payload !== null ? (payload as { employee?: unknown }).employee : undefined;
      if (raw === null) {
        this.emit('sessionChanged', null);
        return;
      }
      const employee = parseEmployee(raw);
      if (employee) this.emit('sessionChanged', employee);
      else console.warn('[conexão] session:changed com formato inválido ignorado');
    });

    socket.on('chat:message', (payload: unknown) => {
      if (this.isStale(generation)) return;
      const message = parseChatMessage(payload);
      if (message) this.emit('chat', message);
      else console.warn('[conexão] mensagem de chat com formato inválido ignorada');
    });

    // Só o aviso: o conteúdo vem pela API, com o token do PC
    socket.on('mural:atualizado', () => {
      if (this.isStale(generation)) return;
      this.emit('mural');
    });

    socket.on('message:new', (payload: unknown) => {
      if (this.isStale(generation)) return;
      const message = parseMessage(payload);
      if (message) this.emit('message', message);
      else console.warn('[conexão] mensagem com formato inválido ignorada');
    });

    socket.on('connect_error', (err) => {
      if (this.isStale(generation)) return;
      this.closeSocket();
      this.scheduleRetry(err);
    });

    socket.on('disconnect', (reason) => {
      if (this.isStale(generation)) return;
      this.closeSocket();
      this.scheduleRetry(new Error(`Conexão perdida (${reason})`));
    });

    this.socket = socket;
  }

  private closeSocket(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleRetry(err: unknown, status: Extract<ConnectionStatus, 'disconnected' | 'unauthorized'> = 'disconnected'): void {
    if (this.stopped) return;
    this.clearRetry();

    // Chave recusada: tenta de novo devagar (o DP pode corrigir no servidor)
    if (status === 'unauthorized') this.retryDelay = MAX_RETRY_MS;
    // Primeira tentativa depois de uma queda: espalha os PCs entre 1 e 6 s. Se o servidor reiniciou,
    // centenas de PCs caem no mesmo instante e não voltam todos juntos.
    // Nas seguintes: intervalo progressivo com jitter de ±20%.
    const firstAfterDrop = this.everConnected && this.retryDelay === MIN_RETRY_MS;
    const delay = firstAfterDrop
      ? Math.round(MIN_RETRY_MS + Math.random() * FIRST_RETRY_SPREAD_MS)
      : Math.round(this.retryDelay * (0.8 + Math.random() * 0.4));
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);

    this.update({
      status,
      nextRetryAt: Date.now() + delay,
      lastError: err instanceof Error ? err.message : String(err),
    });
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }
}
