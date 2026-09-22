import type { MessageType } from '../../../shared/types';
import type { NomeIcone } from './icones';

export interface MessageTypeMeta {
  label: string;
  /** Nome do ícone da biblioteca (ver lib/icones.tsx) */
  icone: NomeIcone;
  /** Classe CSS com as cores do tipo */
  tone: 'urgent' | 'warning' | 'announcement' | 'info';
}

export const MESSAGE_TYPE_META: Record<MessageType, MessageTypeMeta> = {
  URGENTE: { label: 'Urgente', icone: 'urgente', tone: 'urgent' },
  AVISO: { label: 'Aviso', icone: 'aviso', tone: 'warning' },
  COMUNICADO: { label: 'Comunicado', icone: 'comunicados', tone: 'announcement' },
  INFORMATIVO: { label: 'Informativo', icone: 'informativo', tone: 'info' },
};

/** "Hoje, 10:24" / "Ontem, 16:32" / "12/09/2026, 08:00" */
export function formatMessageDate(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return `Hoje, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Ontem, ${time}`;
  return `${date.toLocaleDateString('pt-BR')}, ${time}`;
}
