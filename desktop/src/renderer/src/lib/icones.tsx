/**
 * Ícones do sistema, todos vindos da biblioteca (Lucide, via react-icons).
 *
 * Nada de emoji ou caractere solto na interface: cada lugar pede um nome
 * daqui, o que mantém o traço igual em todas as telas e nos dois temas (o
 * ícone herda a cor do texto).
 */
import type { IconType } from 'react-icons';
import {
  LuBadgeCheck,
  LuRefreshCw,
  LuWifi,
  LuKeyRound,
  LuAppWindow,
  LuCircleHelp,
  LuHandHelping,
  LuHourglass,
  LuCircleDot,
  LuBell,
  LuDiamond,
  LuBot,
  LuCheckCheck,
  LuBookOpen,
  LuCalendar,
  LuCheck,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuClock,
  LuCoffee,
  LuFileText,
  LuFlag,
  LuHeart,
  LuHouse,
  LuImage,
  LuInbox,
  LuInfo,
  LuLifeBuoy,
  LuMegaphone,
  LuMessageSquare,
  LuMonitor,
  LuMinus,
  LuMoon,
  LuPaperclip,
  LuPencil,
  LuPin,
  LuPlus,
  LuPrinter,
  LuSearch,
  LuForward,
  LuSend,
  LuSettings,
  LuSiren,
  LuSlidersHorizontal,
  LuSparkles,
  LuStar,
  LuSun,
  LuTriangleAlert,
  LuTruck,
  LuUser,
  LuUsers,
  LuSquare,
  LuCopy,
  LuMail,
  LuReply,
  LuSmile,
  LuVideo,
  LuX,
  LuMic,
  LuPlay,
  LuPause,
  LuTrash2,
  LuWrench,
} from 'react-icons/lu';

/** Nome usado no resto do aplicativo -> ícone da biblioteca. */
export const ICONES = {
  inicio: LuHouse,
  comunicados: LuMegaphone,
  mensagens: LuMessageSquare,
  chamados: LuLifeBuoy,
  perfil: LuUser,
  configuracoes: LuSettings,
  enviar: LuSend,
  encaminhar: LuForward,
  mural: LuPin,
  cadastros: LuUsers,
  ajustes: LuSlidersHorizontal,
  fila: LuWrench,
  auditoria: LuSearch,
  procurar: LuSearch,
  novidades: LuSparkles,
  ajuda: LuBookOpen,
  // conteúdo
  urgente: LuSiren,
  aviso: LuTriangleAlert,
  informativo: LuInfo,
  anexo: LuPaperclip,
  microfone: LuMic,
  tocar: LuPlay,
  pausar: LuPause,
  lixeira: LuTrash2,
  arquivo: LuFileText,
  grupo: LuUsers,
  vazio: LuInbox,
  certo: LuCheck,
  certoDuplo: LuCheckCheck,
  ciencia: LuBadgeCheck,
  responder: LuReply,
  seta: LuChevronDown,
  anterior: LuChevronLeft,
  proximo: LuChevronRight,
  fechar: LuX,
  minimizar: LuMinus,
  maximizar: LuSquare,
  restaurar: LuCopy,
  robo: LuBot,
  claro: LuSun,
  escuro: LuMoon,
  // atalhos que a pessoa monta
  estrela: LuStar,
  mais: LuPlus,
  relogio: LuClock,
  agenda: LuCalendar,
  lista: LuFileText,
  coracao: LuHeart,
  bandeira: LuFlag,
  lapis: LuPencil,
  sino: LuBell,
  cafe: LuCoffee,
  caminhao: LuTruck,
  impressora: LuPrinter,
  computador: LuMonitor,
  imagem: LuImage,
  video: LuVideo,
  carta: LuMail,
  sorriso: LuSmile,
  losango: LuDiamond,
  atualizar: LuRefreshCw,
  rede: LuWifi,
  chave: LuKeyRound,
  programa: LuAppWindow,
  duvida: LuCircleHelp,
  aceitar: LuHandHelping,
  ampulheta: LuHourglass,
  ponto: LuCircleDot,
} as const;

export type NomeIcone = keyof typeof ICONES;

/**
 * Atalhos criados antes dos ícones de biblioteca guardaram um caractere solto.
 * Alguns deles a fonte do sistema nem desenha, e o azulejo ficava só com o
 * nome: aqui cada caractere antigo vira o ícone equivalente.
 */
const ICONE_ANTIGO: Record<string, NomeIcone> = {
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
  // Os outros do conjunto antigo (◷ ▤ ✎ ⧗ ☀), que a fonte do Windows nem sempre desenha
  '◷': 'relogio',
  '⧗': 'relogio',
  '▤': 'lista',
  '✎': 'lapis',
  '☀': 'claro',
};

/** Existe um ícone com esse nome? (os atalhos antigos guardavam um caractere) */
export function ehNomeDeIcone(nome: string): nome is NomeIcone {
  return nome in ICONES;
}

interface IconeProps {
  nome: NomeIcone;
  /** Tamanho em pixels; o padrão acompanha o texto ao redor */
  tamanho?: number;
  className?: string;
}

/** Desenha o ícone com a cor do texto de onde ele está. */
export function Icone({ nome, tamanho, className }: IconeProps) {
  const Desenho: IconType = ICONES[nome];
  return <Desenho size={tamanho ?? '1.15em'} className={className} aria-hidden focusable="false" />;
}

/** Nome de ícone para um valor guardado: converte o caractere antigo. */
export function nomeDeIconeDoAtalho(nome: string): NomeIcone {
  if (ehNomeDeIcone(nome)) return nome;
  return ICONE_ANTIGO[nome] ?? 'estrela';
}

/**
 * Ícone de um atalho criado pela pessoa. Os atalhos antigos guardam um
 * caractere solto: ele vira o ícone equivalente, e o que não estiver na lista
 * cai na estrela — melhor um ícone genérico do que um quadrado vazio.
 */
export function IconeDoAtalho({ nome, tamanho }: { nome: string; tamanho?: number }) {
  if (ehNomeDeIcone(nome)) return <Icone nome={nome} tamanho={tamanho} />;
  return <Icone nome={nomeDeIconeDoAtalho(nome)} tamanho={tamanho} />;
}

/** Os que a pessoa pode escolher ao montar um atalho. */
export const ICONES_DE_ATALHO: NomeIcone[] = [
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
