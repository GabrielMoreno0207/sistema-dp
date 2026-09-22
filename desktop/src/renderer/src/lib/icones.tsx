/**
 * Ícones do sistema, todos vindos da biblioteca (Lucide, via react-icons).
 *
 * Nada de emoji ou caractere solto na interface: cada lugar pede um nome
 * daqui, o que mantém o traço igual em todas as telas e nos dois temas (o
 * ícone herda a cor do texto).
 */
import type { IconType } from 'react-icons';
import {
  LuBell,
  LuBot,
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
  LuVideo,
  LuX,
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
  novidades: LuSparkles,
  ajuda: LuBookOpen,
  // conteúdo
  urgente: LuSiren,
  aviso: LuTriangleAlert,
  informativo: LuInfo,
  anexo: LuPaperclip,
  arquivo: LuFileText,
  grupo: LuUsers,
  vazio: LuInbox,
  certo: LuCheck,
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
} as const;

export type NomeIcone = keyof typeof ICONES;

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

/**
 * Ícone de um atalho criado pela pessoa. Os atalhos antigos guardam um
 * caractere (◈, ✉...); enquanto não forem editados, ele continua aparecendo.
 */
export function IconeDoAtalho({ nome, tamanho }: { nome: string; tamanho?: number }) {
  if (ehNomeDeIcone(nome)) return <Icone nome={nome} tamanho={tamanho} />;
  return <span aria-hidden>{nome}</span>;
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
