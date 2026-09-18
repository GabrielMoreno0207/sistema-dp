import type { MessageType } from '../../../shared/types';

export interface MessageTypeMeta {
  label: string;
  icon: string;
  /** Classe CSS com as cores do tipo */
  tone: 'urgent' | 'warning' | 'announcement' | 'info';
}

export const MESSAGE_TYPE_META: Record<MessageType, MessageTypeMeta> = {
  URGENTE: { label: 'Urgente', icon: '🚨', tone: 'urgent' },
  AVISO: { label: 'Aviso', icon: '⚠️', tone: 'warning' },
  COMUNICADO: { label: 'Comunicado', icon: '📢', tone: 'announcement' },
  INFORMATIVO: { label: 'Informativo', icon: 'ℹ️', tone: 'info' },
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
