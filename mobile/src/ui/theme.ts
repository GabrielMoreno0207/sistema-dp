/** Cores do app (as mesmas do app do computador; claro e escuro seguem o tema do celular) */
import { useColorScheme, useWindowDimensions } from 'react-native';
import type { MessageType } from '../core/types';

const light = {
  dark: false,
  bg: '#f0f2f5',
  surface: '#ffffff',
  surface2: '#f4f6f9',
  text: '#1c2430',
  textSoft: '#4a5465',
  muted: '#5c6878',
  border: '#e2e7ee',
  fieldBorder: '#cfd6e0',
  /** Verde-água do sistema */
  primary: '#17b3a3',
  primaryDark: '#0d7a6f',
  primarySoft: '#e3f5f2',
  /** Texto sobre o verde-água */
  onPrimary: '#06312c',
  /** Link e botão de texto (contraste melhor que o verde-água puro) */
  link: '#0b6f64',
  header: '#20374a',
  onHeader: '#eaf1f5',
  headerSoft: '#9fb4c1',
  success: '#1faa59',
  warning: '#f2b01e',
  danger: '#e5484d',
  dangerText: '#b3231f',
  okBg: '#e4f6ec',
  okText: '#12633a',
  errorBg: '#fdecec',
  errorText: '#a61b1b',
  warnBg: '#fff4e0',
  warnText: '#8a5300',
  infoBg: '#e0f6fa',
  infoText: '#0b5566',
  bubbleMine: '#e7f6f4',
  onBubbleMine: '#1c2430',
  bubbleOther: '#ffffff',
  badge: '#c62828',
  overlay: 'rgba(10, 20, 28, 0.55)',
};

const dark: typeof light = {
  dark: true,
  bg: '#0e151b',
  surface: '#172129',
  surface2: '#1e2b34',
  text: '#e4ecf1',
  textSoft: '#b3c1cc',
  muted: '#93a7b4',
  border: '#253440',
  fieldBorder: '#32444f',
  primary: '#17b3a3',
  primaryDark: '#12968a',
  primarySoft: 'rgba(23, 179, 163, 0.16)',
  onPrimary: '#06312c',
  link: '#52d6c5',
  header: '#131f28',
  onHeader: '#eaf1f5',
  headerSoft: '#9fb4c1',
  success: '#2ec46b',
  warning: '#f2b01e',
  danger: '#f0555a',
  dangerText: '#ff8e8e',
  okBg: 'rgba(31, 170, 89, 0.18)',
  okText: '#7fe0a6',
  errorBg: 'rgba(229, 72, 77, 0.2)',
  errorText: '#ffa1a1',
  warnBg: 'rgba(242, 176, 30, 0.18)',
  warnText: '#f3c96b',
  infoBg: 'rgba(8, 145, 178, 0.22)',
  infoText: '#86d7ec',
  bubbleMine: 'rgba(23, 179, 163, 0.18)',
  onBubbleMine: '#e4ecf1',
  bubbleOther: '#1e2b34',
  badge: '#c62828',
  overlay: 'rgba(0, 0, 0, 0.65)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

/**
 * Layout responsivo: em tablet ou celular deitado o conteúdo fica centralizado
 * com largura de leitura, e algumas grades ganham mais colunas.
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const largo = width >= 700;
  return {
    width,
    height,
    largo,
    /** Largura máxima do conteúdo das páginas */
    maxWidth: largo ? 760 : width,
    /** Colunas da grade de atalhos */
    colunasAtalhos: width >= 900 ? 6 : width >= 600 ? 4 : 3,
  };
}

/** Cor de cada tipo de comunicado (as mesmas do app do computador) */
export const TONES: Record<MessageType, { color: string; soft: string; softDark: string; icon: string }> = {
  URGENTE: { color: '#dc2626', soft: '#fde8e8', softDark: '#3a1717', icon: '🚨' },
  AVISO: { color: '#d97706', soft: '#fff4e0', softDark: '#3a2a10', icon: '⚠️' },
  COMUNICADO: { color: '#0d7a6f', soft: '#e3f5f2', softDark: '#10312d', icon: '📢' },
  INFORMATIVO: { color: '#0891b2', soft: '#e0f6fa', softDark: '#0f2f38', icon: 'ℹ️' },
};

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
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
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Na lista de conversas: hora se for hoje, "Ontem" ou a data curta */
export function formatListDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return formatTime(iso);
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** Separador de dia dentro da conversa */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** "Ana Paula" → "AP"; "Livia (DP)" → "L" */
export function iniciais(nome: string): string {
  const palavras = nome
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (palavras.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
}
