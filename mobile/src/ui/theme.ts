/** Cores do app (claro e escuro seguem o tema do celular) */
import { useColorScheme } from 'react-native';
import type { MessageType } from '../core/types';

const light = {
  bg: '#f4f6f9',
  surface: '#ffffff',
  surface2: '#f1f4f8',
  text: '#1c2430',
  textSoft: '#4a5465',
  muted: '#7a8494',
  border: '#e2e7ee',
  primary: '#1d4ed8',
  primarySoft: '#e8efff',
  onPrimary: '#ffffff',
  header: '#14213d',
  onHeader: '#ffffff',
  success: '#1faa59',
  warning: '#f2b01e',
  danger: '#e5484d',
  bubbleMine: '#1d4ed8',
  onBubbleMine: '#ffffff',
  bubbleOther: '#ffffff',
  overlay: 'rgba(12, 18, 32, 0.55)',
};

const dark: typeof light = {
  bg: '#0e131c',
  surface: '#161d29',
  surface2: '#1d2533',
  text: '#e6ebf2',
  textSoft: '#b4bdca',
  muted: '#8792a3',
  border: '#273142',
  primary: '#3b6ff0',
  primarySoft: '#1b2a4d',
  onPrimary: '#ffffff',
  header: '#0a0f18',
  onHeader: '#ffffff',
  success: '#2ec46b',
  warning: '#f2b01e',
  danger: '#f0555a',
  bubbleMine: '#2f5fd8',
  onBubbleMine: '#ffffff',
  bubbleOther: '#1d2533',
  overlay: 'rgba(0, 0, 0, 0.65)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Cor de cada tipo de comunicado (as mesmas da Central e do app do computador) */
export const TONES: Record<MessageType, { color: string; soft: string; softDark: string; icon: string }> = {
  URGENTE: { color: '#dc2626', soft: '#fde8e8', softDark: '#3a1717', icon: '🚨' },
  AVISO: { color: '#d97706', soft: '#fff4e0', softDark: '#3a2a10', icon: '⚠️' },
  COMUNICADO: { color: '#2563eb', soft: '#e8efff', softDark: '#162448', icon: '📢' },
  INFORMATIVO: { color: '#0891b2', soft: '#e0f6fa', softDark: '#0f2f38', icon: 'ℹ️' },
};

export function formatDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Hoje, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Ontem, ${time}`;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${time}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
