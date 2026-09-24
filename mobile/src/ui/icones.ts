/**
 * Ícones dos atalhos: o servidor guarda o nome usado no app do computador
 * (ex.: "agenda", "cafe"); aqui cada nome vira um emoji, que o Android desenha
 * sem precisar de fonte de ícones.
 */
const EMOJI: Record<string, string> = {
  inicio: '🏠',
  comunicados: '📢',
  mensagens: '💬',
  chamados: '🛟',
  perfil: '👤',
  configuracoes: '⚙️',
  estrela: '⭐',
  mais: '➕',
  relogio: '⏰',
  agenda: '📅',
  lista: '📋',
  coracao: '❤️',
  bandeira: '🚩',
  lapis: '✏️',
  sino: '🔔',
  cafe: '☕',
  caminhao: '🚚',
  impressora: '🖨️',
  computador: '💻',
  imagem: '🖼️',
  video: '🎬',
  carta: '✉️',
  sorriso: '🙂',
  losango: '🔷',
  certo: '✔️',
  claro: '☀️',
  mural: '📌',
  ajustes: '🎚️',
  cadastros: '👥',
  enviar: '📤',
};

/** Atalhos antigos guardavam um caractere solto (mesma tabela do app do computador) */
const ANTIGO: Record<string, string> = {
  '✉': 'carta',
  '★': 'estrela',
  '☆': 'estrela',
  '✚': 'mais',
  '➕': 'mais',
  '☺': 'sorriso',
  '◈': 'losango',
  '◆': 'losango',
  '♦': 'losango',
  '♠': 'bandeira',
  '♥': 'coracao',
  '❤': 'coracao',
  '☎': 'computador',
  '⚙': 'configuracoes',
  '⏰': 'relogio',
  '⌚': 'relogio',
  '✔': 'certo',
  '✓': 'certo',
  '⚑': 'bandeira',
  '⚐': 'bandeira',
  '◷': 'relogio',
  '⧗': 'relogio',
  '▤': 'lista',
  '✎': 'lapis',
  '☀': 'claro',
};

/** Os que a pessoa pode escolher ao montar um atalho (mesma lista do computador) */
export const ICONES_DE_ATALHO = [
  'comunicados',
  'mensagens',
  'perfil',
  'estrela',
  'mais',
  'relogio',
  'agenda',
  'lista',
  'coracao',
  'bandeira',
  'lapis',
  'sino',
  'cafe',
  'caminhao',
  'impressora',
  'computador',
];

export function nomeDoIcone(nome: string): string {
  if (nome in EMOJI) return nome;
  return ANTIGO[nome] ?? 'estrela';
}

export function emojiDoIcone(nome: string): string {
  return EMOJI[nomeDoIcone(nome)] ?? '⭐';
}

/** Cores do azulejo (as mesmas do computador) */
export const CORES_ATALHO = ['#17b3a3', '#3f8fd0', '#6c63c7', '#2ea36f', '#d98324', '#c0554d', '#e0a92b', '#d15c8a'];
