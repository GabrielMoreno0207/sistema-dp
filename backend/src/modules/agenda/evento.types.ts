/**
 * Agenda: eventos que aparecem no calendário da tela inicial.
 *
 * Há dois escopos. PESSOAL é a anotação de quem criou — ninguém mais enxerga.
 * GERAL é o que o Departamento Pessoal (ou o TI) publica para a empresa toda,
 * como feriado, parada de linha e data de pagamento.
 */
import { randomBytes } from 'node:crypto';

export type EscopoEvento = 'PESSOAL' | 'GERAL';

export interface Evento {
  id: string;
  titulo: string;
  descricao: string;
  /** Data do calendário, no formato AAAA-MM-DD (sem fuso) */
  dia: string;
  /** 'HH:MM', ou null quando é o dia inteiro */
  hora: string | null;
  escopo: EscopoEvento;
  cor: string;
  criadoPor: string;
  criadoPorNome: string;
  createdAt: string;
}

export type NovoEvento = Omit<Evento, 'id' | 'createdAt'>;

export const LIMITES_EVENTO = {
  maxTitulo: 120,
  maxDescricao: 1000,
  /** Quantos eventos pessoais cada pessoa pode ter no mesmo dia */
  porDiaPorPessoa: 20,
} as const;

export const EVENTO_ID_PATTERN = '^EVT-[0-9a-f]{24}$';
export const DIA_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
export const HORA_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';
export const COR_PATTERN = '^#[0-9a-fA-F]{6}$';

export function gerarIdEvento(): string {
  return `EVT-${randomBytes(12).toString('hex')}`;
}

/** Confere se é uma data de calendário existente (rejeita 31/02, por exemplo). */
export function diaValido(dia: string): boolean {
  if (!new RegExp(DIA_PATTERN).test(dia)) return false;
  const [ano, mes, diaDoMes] = dia.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, diaDoMes));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === diaDoMes;
}
