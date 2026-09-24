/** Estado do app: um só objeto, compartilhado pela tela e pelo serviço em segundo plano */
import { useSyncExternalStore } from 'react';
import type {
  Atalho,
  ConnectionStatus,
  ConversaResumo,
  DpMessage,
  EmployeeProfile,
  MidiaPublica,
  MuralPost,
  VersaoDisponivel,
} from './types';

/** Notificação tocada: a tela abre o comunicado, a conversa ou o chamado */
export type NavRequest =
  | { kind: 'message'; id: string }
  | { kind: 'conversa'; conversaId: string }
  | { kind: 'chamado'; chamadoId: string }
  | { kind: 'atualizacao' };

/** Etapa da atualização do app (baixar → conferir → abrir o instalador) */
export type EtapaAtualizacao = 'nenhuma' | 'disponivel' | 'baixando' | 'pronta' | 'erro';

export interface AppData {
  /** Configuração carregada do aparelho */
  booted: boolean;
  serverUrl: string | null;
  deviceId: string | null;
  device: { manufacturer: string; model: string; appVersion: string; sdkInt: number } | null;

  connection: { status: ConnectionStatus; lastError: string | null; nextRetryAt: number | null };
  /** Muda a cada novo registro no servidor: as imagens buscam de novo com o token novo */
  sessao: number;

  employee: EmployeeProfile | null;
  /** Já perguntou ao servidor quem está logado (evita piscar a tela de login) */
  employeeChecked: boolean;

  /** Comunicados, mais recentes primeiro */
  messages: DpMessage[];

  /** Conversas do chat, a mais movimentada primeiro */
  conversas: ConversaResumo[];
  conversasNaoLidas: number;
  /** Conversa aberta na tela (não avisa mensagem nova dela) */
  conversaAberta: string | null;
  /** Aumenta a cada "conversa:atualizada": a conversa aberta recarrega */
  conversaVersao: Record<string, number>;

  chamadosNaoLidos: number;
  /** Aumenta a cada "chamado:atualizado" */
  chamadosVersao: number;

  mural: MuralPost | null;
  atalhos: Atalho[];
  foto: MidiaPublica | null;

  /** Alerta na tela (comunicado que chegou com o app aberto) */
  alert: DpMessage | null;
  alertQueue: DpMessage[];

  /** Notificação tocada: a tela abre o comunicado, a conversa ou o chamado */
  navRequest: NavRequest | null;

  atualizacao: { etapa: EtapaAtualizacao; versao: VersaoDisponivel | null; progresso: string; erro: string | null };
}

let state: AppData = {
  booted: false,
  serverUrl: null,
  deviceId: null,
  device: null,
  connection: { status: 'not-configured', lastError: null, nextRetryAt: null },
  sessao: 0,
  employee: null,
  employeeChecked: false,
  messages: [],
  conversas: [],
  conversasNaoLidas: 0,
  conversaAberta: null,
  conversaVersao: {},
  chamadosNaoLidos: 0,
  chamadosVersao: 0,
  mural: null,
  atalhos: [],
  foto: null,
  alert: null,
  alertQueue: [],
  navRequest: null,
  atualizacao: { etapa: 'nenhuma', versao: null, progresso: '', erro: null },
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
