/** Tipos do app (os mesmos dados que o servidor manda para o app do computador) */

export type ConnectionStatus =
  | 'not-configured'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  /** Registro recusado pelo servidor (ex.: aparelho bloqueado) */
  | 'unauthorized';

export const MESSAGE_TYPES = ['COMUNICADO', 'AVISO', 'INFORMATIVO', 'URGENTE'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Arquivo ou imagem que o DP mandou junto com o comunicado */
export interface DpAttachment {
  id: string;
  /** Nome original do arquivo */
  name: string;
  mimeType: string;
  /** Tamanho em bytes */
  size: number;
  /** IMAGE aparece como miniatura no comunicado; FILE, como arquivo para abrir */
  kind: 'IMAGE' | 'FILE';
}

/** Comunicado do DP, do ponto de vista deste aparelho */
export interface DpMessage {
  id: string;
  title: string;
  content: string;
  type: MessageType;
  target: string;
  targetId: string | null;
  sender: string;
  createdAt: string;
  read: boolean;
  readAt: string | null;
  /** O DP pede "li e estou ciente" neste comunicado */
  exigeCiencia: boolean;
  /** Quando esta pessoa confirmou a ciência (null = ainda não confirmou) */
  cienteEm: string | null;
  /** Anexos do comunicado (lista vazia quando não há) */
  attachments: DpAttachment[];
}

/**
 * Acesso administrativo que vem do setor: quem é do Departamento Pessoal ou do
 * TI usa as telas de administração com o próprio login, sem conta à parte.
 */
export type AcessoAdmin = 'NENHUM' | 'DP' | 'TI';

/** Funcionário logado no app */
export interface EmployeeProfile {
  id: string;
  name: string;
  registration: string;
  sector: string | null;
  shift: string | null;
  mustChangePassword: boolean;
  /** 'DP' abre as telas do Departamento Pessoal; 'TI' abre também as do TI */
  acessoAdmin: AcessoAdmin;
}

/** Imagem, vídeo ou documento guardado no servidor */
export interface MidiaPublica {
  id: string;
  tipo: 'IMAGEM' | 'VIDEO' | 'ARQUIVO' | 'AUDIO';
  nome: string;
  mimeType: string;
  tamanho: number;
  url: string;
  /** Mensagem de voz: duração da gravação (servidores antigos não mandam) */
  duracaoMs?: number | null;
}

/** Recado que o DP deixa fixado na tela inicial */
/** Reações de uma mensagem ou recado: uma linha por emoji usado */
export interface ReacaoResumo {
  emoji: string;
  total: number;
  /** Quem está usando o app reagiu com este emoji */
  minha: boolean;
  nomes: string[];
}

export interface MuralPost {
  id: string;
  titulo: string;
  texto: string;
  midia: MidiaPublica | null;
  /** Servidores antigos não mandam */
  reacoes?: ReacaoResumo[];
  ativo: boolean;
  criadoPor: string;
  createdAt: string;
  updatedAt: string;
}

/** Para onde um atalho leva (só telas do próprio aplicativo) */
export type DestinoAtalho = 'COMUNICADOS' | 'CHAT' | 'PERFIL' | 'CONFIGURACOES' | 'MURAL';

/** Azulejo que a pessoa monta na tela inicial */
export interface Atalho {
  id: string;
  userId: string;
  ordem: number;
  rotulo: string;
  icone: string;
  cor: string;
  destino: DestinoAtalho;
  createdAt: string;
}

export type DadosAtalho = Pick<Atalho, 'rotulo' | 'icone' | 'cor' | 'destino'>;

// ---------------------------------------------------------------- chamados para o TI

export type CategoriaChamado = 'COMPUTADOR' | 'IMPRESSORA' | 'SISTEMA' | 'REDE' | 'ACESSO' | 'OUTRO';
export type PrioridadeChamado = 'BAIXA' | 'NORMAL' | 'ALTA';
export type StatusChamado = 'ABERTO' | 'EM_ANDAMENTO' | 'RESOLVIDO' | 'FECHADO';

export interface ChamadoMensagem {
  id: number;
  chamadoId: string;
  autorId: string;
  autorNome: string;
  autorTipo: 'SOLICITANTE' | 'TI';
  conteudo: string;
  createdAt: string;
  lidaEm: string | null;
}

export interface Chamado {
  id: string;
  numero: number;
  titulo: string;
  descricao: string;
  categoria: CategoriaChamado;
  prioridade: PrioridadeChamado;
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

export interface ChamadoResumo extends Chamado {
  mensagensNaoLidas: number;
  totalMensagens: number;
}

export interface ChamadoCompleto extends Chamado {
  mensagens: ChamadoMensagem[];
  midias: { id: string; tipo: 'IMAGEM' | 'VIDEO' | 'ARQUIVO'; nome: string; url: string }[];
  naoLidas: number;
}

export interface NovoChamadoInput {
  titulo: string;
  descricao: string;
  categoria: CategoriaChamado;
  prioridade: PrioridadeChamado;
  midiaIds: string[];
}

// ---------------------------------------------------------------- conversas

export type TipoConversa = 'DIRETA' | 'GRUPO';
export type PapelMembro = 'ADMIN' | 'MEMBRO';
export type TipoMensagemConversa = 'TEXTO' | 'MIDIA' | 'SISTEMA';

/** Pessoa que participa de uma conversa (ou está na lista de contatos) */
export interface Participante {
  id: string;
  nome: string;
  /** Usuário (login) do funcionário; null para as contas do DP */
  matricula: string | null;
  setor: string | null;
  ehDp: boolean;
  fotoMidiaId: string | null;
  ativo: boolean;
  /** A conta foi apagada: a conversa direta com ela não aparece na lista */
  removido: boolean;
}

export interface CitacaoConversa {
  id: number;
  autorNome: string;
  resumo: string;
  apagada: boolean;
}

export interface MensagemConversa {
  id: number;
  conversaId: string;
  autorId: string;
  autorNome: string;
  tipo: TipoMensagemConversa;
  conteudo: string;
  midiaId: string | null;
  midia: MidiaPublica | null;
  automatica: boolean;
  encaminhada: boolean;
  respondeA: number | null;
  respondida: CitacaoConversa | null;
  /** Reações da mensagem (servidores antigos não mandam) */
  reacoes?: ReacaoResumo[];
  createdAt: string;
  apagadaEm: string | null;
}

export interface ConversaResumo {
  id: string;
  tipo: TipoConversa;
  nome: string | null;
  criadoPor: string;
  createdAt: string;
  updatedAt: string;
  participantes: Participante[];
  /** Nome do grupo, ou da outra pessoa na conversa direta */
  titulo: string;
  ultimaMensagem: { conteudo: string; autorNome: string; tipo: TipoMensagemConversa; createdAt: string } | null;
  /** Até quando todo mundo já leu (marca "lida" nas mensagens enviadas) */
  lidaAte: string | null;
  naoLidas: number;
  meuPapel: PapelMembro;
}

/** Aviso de mensagem nova que o servidor manda junto com "conversa:atualizada" */
export interface AvisoDeMensagem {
  mensagemId: number;
  autorId: string;
  autorNome: string;
  resumo: string;
  createdAt: string;
  grupo: string | null;
}

/** Leitura de uma conversa pelo TI (auditoria) */
export interface AcessoTi {
  conversaId: string;
  usuarioNome: string;
  createdAt: string;
}

/** Evento do calendário da tela inicial */
export interface EventoAgenda {
  id: string;
  titulo: string;
  descricao: string;
  /** Data do calendário, AAAA-MM-DD */
  dia: string;
  /** 'HH:MM', ou null quando é o dia inteiro */
  hora: string | null;
  /** PESSOAL: anotação de quem criou; GERAL: publicado pelo DP para todos */
  escopo: 'PESSOAL' | 'GERAL';
  cor: string;
  criadoPor: string;
  criadoPorNome: string;
  createdAt: string;
}

/** Versão do app publicada no servidor (atualização automática) */
export interface VersaoDisponivel {
  versao: string;
  obrigatoria: boolean;
  notas: string;
  sha256: string;
  tamanho: number;
  url: string;
}

// ---------------------------------------------------------------- aparelho

/** Guardado cifrado no aparelho (Android Keystore) */
export interface DeviceConfig {
  serverUrl: string | null;
  /** CEL-XXXXXXXXXXXX: identifica o aparelho no servidor */
  deviceId: string | null;
  /** Segredo da instalação: só este aparelho consegue se registrar com este ID */
  deviceSecret: string | null;
  /** Maior número de comunicado já avisado (evita avisar de novo ao reabrir/religar) */
  lastAlertedSeq: number;
}

/** Arquivo escolhido no celular (seletor ou câmera), antes de ir ao servidor */
export interface ArquivoLocal {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface OperationResult {
  ok: boolean;
  message: string;
}

export const TYPE_LABELS: Record<MessageType, string> = {
  COMUNICADO: 'Comunicado',
  AVISO: 'Aviso',
  INFORMATIVO: 'Informativo',
  URGENTE: 'Urgente',
};

export const CATEGORIAS_CHAMADO: Record<CategoriaChamado, string> = {
  COMPUTADOR: 'Computador',
  IMPRESSORA: 'Impressora',
  SISTEMA: 'Sistema / programa',
  REDE: 'Rede / internet',
  ACESSO: 'Acesso e senha',
  OUTRO: 'Outro',
};

export const PRIORIDADES_CHAMADO: Record<PrioridadeChamado, string> = {
  BAIXA: 'Baixa',
  NORMAL: 'Normal',
  ALTA: 'Alta',
};

export const STATUS_CHAMADO: Record<StatusChamado, string> = {
  ABERTO: 'Aberto',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
};

/** Limites do servidor (conversa.types e chamados) */
export const LIMITES = {
  conteudoMensagem: 4000,
  nomeGrupo: 60,
  paginaMensagens: 50,
};
