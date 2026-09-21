/**
 * Conversas do chat: diretas (duas pessoas) e grupos.
 *
 * Substitui o par fixo (funcionário, pessoa do DP) do modelo anterior: agora
 * qualquer pessoa conversa com qualquer outra, e a conversa com o DP passa a
 * ser apenas uma conversa direta como as demais.
 */
import { randomBytes } from 'node:crypto';

export type TipoConversa = 'DIRETA' | 'GRUPO';
export type PapelMembro = 'ADMIN' | 'MEMBRO';
export type TipoMensagem = 'TEXTO' | 'MIDIA' | 'SISTEMA';

export interface Conversa {
  id: string;
  tipo: TipoConversa;
  /** Só para grupo; conversa direta usa o nome da outra pessoa */
  nome: string | null;
  criadoPor: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membro {
  conversaId: string;
  userId: string;
  papel: PapelMembro;
  entrouEm: string;
  ultimaLeitura: string | null;
  saiuEm: string | null;
}

export interface MensagemConversa {
  id: number;
  conversaId: string;
  autorId: string;
  autorNome: string;
  tipo: TipoMensagem;
  conteudo: string;
  midiaId: string | null;
  automatica: boolean;
  createdAt: string;
  apagadaEm: string | null;
}

export type NovaMensagemConversa = Omit<MensagemConversa, 'id' | 'createdAt' | 'apagadaEm'>;

/** Pessoa que participa: funcionário ou alguém do DP */
export interface Participante {
  id: string;
  nome: string;
  /** Matrícula do funcionário, ou null para o DP */
  matricula: string | null;
  setor: string | null;
  /** true = pessoa do DP (aparece com etiqueta na lista) */
  ehDp: boolean;
  fotoMidiaId: string | null;
  ativo: boolean;
}

/** Como a conversa aparece na lista de cada pessoa */
export interface ConversaResumo extends Conversa {
  participantes: Participante[];
  /** Nome a mostrar: o do grupo, ou o da outra pessoa na conversa direta */
  titulo: string;
  ultimaMensagem: { conteudo: string; autorNome: string; tipo: TipoMensagem; createdAt: string } | null;
  naoLidas: number;
  /** Papel de quem está pedindo a lista */
  meuPapel: PapelMembro;
}

export const LIMITES_CONVERSA = {
  maxConteudo: 4000,
  maxNomeGrupo: 60,
  /** Participantes de um grupo, contando quem criou */
  maxMembrosGrupo: 50,
  /** Mensagens carregadas por vez ao abrir ou rolar para cima */
  paginaMensagens: 50,
} as const;

export const CONVERSA_ID_PATTERN = '^CNV-[0-9a-f]{24}$';

export function gerarIdConversa(): string {
  return `CNV-${randomBytes(12).toString('hex')}`;
}

/** Título da conversa na visão de quem está olhando. */
export function tituloPara(conversa: Conversa, participantes: Participante[], meuId: string): string {
  if (conversa.tipo === 'GRUPO') return conversa.nome ?? 'Grupo';
  const outro = participantes.find((p) => p.id !== meuId);
  return outro?.nome ?? 'Conversa';
}

/** Resumo curto para a lista (a última mensagem pode ser mídia ou de sistema). */
export function resumoDaMensagem(mensagem: MensagemConversa | null): string {
  if (!mensagem) return '';
  if (mensagem.apagadaEm) return 'mensagem apagada';
  if (mensagem.tipo === 'MIDIA') return mensagem.conteudo || 'arquivo';
  return mensagem.conteudo;
}
