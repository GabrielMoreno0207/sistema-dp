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
  /** Veio de outra conversa (a tela mostra "encaminhada") */
  encaminhada: boolean;
  /** Id da mensagem que esta responde (null = mensagem solta) */
  respondeA: number | null;
  createdAt: string;
  apagadaEm: string | null;
}

export type NovaMensagemConversa = Omit<MensagemConversa, 'id' | 'createdAt' | 'apagadaEm'>;

/** Pessoa que participa: funcionário ou alguém do DP */
export interface Participante {
  id: string;
  nome: string;
  /** Usuário do funcionário, ou null para o DP */
  matricula: string | null;
  setor: string | null;
  /** true = pessoa do DP (aparece com etiqueta na lista) */
  ehDp: boolean;
  fotoMidiaId: string | null;
  /** Conta desativada pelo DP continua aparecendo (a pessoa pode voltar) */
  ativo: boolean;
  /** A conta foi apagada: a conversa direta com ela sai da lista */
  removido: boolean;
}

/** Como a conversa aparece na lista de cada pessoa */
export interface ConversaResumo extends Conversa {
  participantes: Participante[];
  /**
   * Até quando todo mundo já leu. Serve para marcar "lida" nas mensagens que
   * a pessoa mandou: é a leitura mais atrasada entre os outros participantes.
   */
  lidaAte: string | null;
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
  /** Quantos resultados a busca dentro da conversa devolve */
  buscaMaxima: 40,
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

/**
 * Resumo curto para a lista. A última mensagem pode ser mídia ou aviso de
 * sistema; avisos de sistema aparecem, mas não contam como mensagem nova.
 */
export function resumoDaMensagem(mensagem: MensagemConversa | null): string {
  if (!mensagem) return '';
  if (mensagem.apagadaEm) return 'mensagem apagada';
  if (mensagem.tipo === 'MIDIA') return mensagem.conteudo || 'arquivo';
  return mensagem.conteudo;
}
