/**
 * Chamados para o TI: o funcionário (ou alguém do DP) relata um problema e a
 * conversa acontece dentro do chamado, separada do chat com o Departamento Pessoal.
 */
import { randomBytes } from 'node:crypto';

export const CATEGORIAS = ['COMPUTADOR', 'IMPRESSORA', 'SISTEMA', 'REDE', 'ACESSO', 'OUTRO'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const PRIORIDADES = ['BAIXA', 'NORMAL', 'ALTA'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** ABERTO -> EM_ANDAMENTO -> RESOLVIDO -> FECHADO (quem abriu confirma ou o TI encerra) */
export const STATUS = ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO'] as const;
export type StatusChamado = (typeof STATUS)[number];

/** Status que ainda pedem atenção do TI */
export const STATUS_EM_ABERTO: StatusChamado[] = ['ABERTO', 'EM_ANDAMENTO'];

export interface Chamado {
  id: string;
  /** Número curto, o que as pessoas falam ("chamado 42") */
  numero: number;
  titulo: string;
  descricao: string;
  categoria: Categoria;
  prioridade: Prioridade;
  status: StatusChamado;
  solicitanteId: string;
  solicitanteNome: string;
  computadorId: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  createdAt: string;
  updatedAt: string;
  resolvidoEm: string | null;
}

export type NovoChamado = Omit<Chamado, 'id' | 'numero' | 'createdAt' | 'updatedAt' | 'resolvidoEm'>;

export type AutorMensagem = 'SOLICITANTE' | 'TI';

export interface ChamadoMensagem {
  id: number;
  chamadoId: string;
  autorId: string;
  autorNome: string;
  autorTipo: AutorMensagem;
  conteudo: string;
  createdAt: string;
  lidaEm: string | null;
}

export type NovaMensagem = Omit<ChamadoMensagem, 'id' | 'createdAt' | 'lidaEm'>;

/** Chamado com tudo que a tela precisa mostrar */
export interface ChamadoCompleto extends Chamado {
  mensagens: ChamadoMensagem[];
  /** Prints anexados na abertura (só os ids; a tela busca em /api/midias/:id) */
  midias: { id: string; tipo: 'IMAGEM' | 'VIDEO'; nome: string; url: string }[];
  /** Mensagens do outro lado ainda não lidas */
  naoLidas: number;
}

/** Resumo para as listas */
export interface ChamadoResumo extends Chamado {
  mensagensNaoLidas: number;
  totalMensagens: number;
}

export const LIMITES_CHAMADO = {
  maxTitulo: 120,
  maxDescricao: 4000,
  maxMensagem: 2000,
  /** Prints por chamado */
  maxMidias: 3,
  /** Chamados em aberto por pessoa, para não virar depósito */
  maxAbertosPorPessoa: 10,
} as const;

export const CHAMADO_ID_PATTERN = '^CHM-[0-9a-f]{24}$';

export function gerarIdChamado(): string {
  return `CHM-${randomBytes(12).toString('hex')}`;
}

export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  COMPUTADOR: 'Computador',
  IMPRESSORA: 'Impressora',
  SISTEMA: 'Sistema / programa',
  REDE: 'Rede / internet',
  ACESSO: 'Acesso e senha',
  OUTRO: 'Outro',
};

export const ROTULO_STATUS: Record<StatusChamado, string> = {
  ABERTO: 'Aberto',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
};
