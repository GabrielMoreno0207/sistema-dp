/**
 * Agendamentos: comunicado ou recado do mural que o DP/TI deixa pronto para
 * sair numa data e hora certas. O servidor confere os vencidos a cada poucos
 * segundos e envia pelo mesmo caminho do envio na hora (alerta, notificação no
 * celular, lista de leituras).
 */
import { randomBytes } from 'node:crypto';
import type { SendMessageInput } from '../messages/message.service';

export type TipoAgendamento = 'COMUNICADO' | 'MURAL';

/**
 * PENDENTE: esperando a hora. ENVIANDO: sendo enviado agora (evita mandar duas vezes).
 * ENVIADO / FALHOU: já passou; CANCELADO: tirado antes da hora.
 */
export type StatusAgendamento = 'PENDENTE' | 'ENVIANDO' | 'ENVIADO' | 'FALHOU' | 'CANCELADO';

export interface DadosMuralAgendado {
  titulo: string;
  texto: string;
  midiaId: string | null;
}

export type DadosAgendamento = SendMessageInput | DadosMuralAgendado;

export interface Agendamento {
  id: string;
  tipo: TipoAgendamento;
  dados: DadosAgendamento;
  /** Quando sai (ISO, com fuso) */
  executarEm: string;
  status: StatusAgendamento;
  criadoPorId: string;
  criadoPorNome: string;
  /** Id do comunicado ou do recado criado no envio */
  resultadoId: string | null;
  /** Motivo, quando falhou */
  erro: string | null;
  enviadoEm: string | null;
  createdAt: string;
}

export const AGENDAMENTO_ID_PATTERN = '^AGD-[0-9a-f]{24}$';

export const LIMITES_AGENDAMENTO = {
  /** Folga mínima: marcar para "agora" é só enviar */
  antecedenciaMinimaMs: 60 * 1000,
  /** Até onde dá para marcar */
  antecedenciaMaximaMs: 366 * 24 * 60 * 60 * 1000,
  /** Quantos pendentes cabem ao mesmo tempo */
  maxPendentes: 200,
  /** A cada quanto o servidor confere os vencidos */
  intervaloMs: 20 * 1000,
} as const;

export function gerarIdAgendamento(): string {
  return `AGD-${randomBytes(12).toString('hex')}`;
}
