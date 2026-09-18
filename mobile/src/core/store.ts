/** Estado do app: um só objeto, compartilhado pela tela e pelo serviço em segundo plano */
import { useSyncExternalStore } from 'react';
import type { ChatContact, ChatMessage, ConnectionStatus, DpMessage, EmployeeProfile } from './types';

export type NavRequest = { kind: 'message'; id: string } | { kind: 'chat'; dpUserId: string };

export interface AppData {
  /** Configuração carregada do aparelho */
  booted: boolean;
  serverUrl: string | null;
  deviceId: string | null;
  device: { manufacturer: string; model: string; appVersion: string; sdkInt: number } | null;

  connection: { status: ConnectionStatus; lastError: string | null; nextRetryAt: number | null };

  employee: EmployeeProfile | null;
  /** Já perguntou ao servidor quem está logado (evita piscar a tela de login) */
  employeeChecked: boolean;

  /** Comunicados, mais recentes primeiro */
  messages: DpMessage[];

  contacts: ChatContact[];
  chatUnread: number;
  openChatId: string | null;
  thread: ChatMessage[];
  threadLoading: boolean;

  /** Alerta na tela (comunicado que chegou com o app aberto) */
  alert: DpMessage | null;
  alertQueue: DpMessage[];

  /** Notificação tocada: a tela abre o comunicado ou a conversa */
  navRequest: NavRequest | null;
}

let state: AppData = {
  booted: false,
  serverUrl: null,
  deviceId: null,
  device: null,
  connection: { status: 'not-configured', lastError: null, nextRetryAt: null },
  employee: null,
  employeeChecked: false,
  messages: [],
  contacts: [],
  chatUnread: 0,
  openChatId: null,
  thread: [],
  threadLoading: false,
  alert: null,
  alertQueue: [],
  navRequest: null,
};

const listeners = new Set<() => void>();

export function getState(): AppData {
  return state;
}

export function setState(patch: Partial<AppData> | ((current: AppData) => Partial<AppData>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Estado atual para as telas (re-renderiza a cada mudança) */
export function useApp(): AppData {
  return useSyncExternalStore(subscribe, getState);
}
