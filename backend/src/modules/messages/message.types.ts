import type { Attachment } from '../attachments/attachment.types';

export const MESSAGE_TYPES = ['COMUNICADO', 'AVISO', 'INFORMATIVO', 'URGENTE'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/**
 * Destinos previstos. Nesta versão só ALL e COMPUTER estão implementados;
 * os demais já fazem parte do modelo para serem adicionados sem quebrar a API.
 */
export type TargetType = 'ALL' | 'COMPUTER' | 'SECTOR' | 'DEPARTMENT' | 'SHIFT' | 'EMPLOYEE';
/**
 * Destinos aceitos para NOVOS comunicados. Falar com uma pessoa específica é pelo chat;
 * comunicados antigos com destino EMPLOYEE continuam válidos no histórico (isRecipient trata).
 */
export const IMPLEMENTED_TARGETS = ['ALL', 'COMPUTER', 'SECTOR', 'SHIFT'] as const satisfies readonly TargetType[];

export const MESSAGE_LIMITS = { title: 120, content: 5000 } as const;
export const MESSAGE_ID_PATTERN = '^MSG-\\d{6,}$';

export interface Message {
  id: string;
  title: string;
  content: string;
  type: MessageType;
  target: TargetType;
  targetId: string | null;
  sender: string;
  createdAt: string;
  /** Arquivos e imagens que o DP mandou junto (lista vazia quando não há anexo) */
  attachments: Attachment[];
}

/** O que o repositório grava: os anexos são ligados depois, pelo id do comunicado */
export type NewMessage = Omit<Message, 'id' | 'createdAt' | 'attachments'>;

/** Mensagem do ponto de vista de um computador destinatário */
export interface RecipientMessage extends Message {
  read: boolean;
  readAt: string | null;
}

/** Mensagem do ponto de vista do DP (administração) */
export interface MessageWithStats extends Message {
  readCount: number;
  /** Quantos computadores eram destinatários quando a mensagem foi enviada */
  recipientCount: number;
}

/** Uma leitura gravada, com os dados de quem leu (para a Central) */
export interface MessageRead {
  readerId: string;
  readAt: string;
  /** Computador em que foi lida */
  computerId: string | null;
  /** Preenchido quando quem leu é um funcionário (removed = já foi excluído; nome/matrícula guardados na leitura) */
  user: { name: string; registration: string | null; sector: string | null; removed: boolean } | null;
  /** Preenchido quando quem leu é o próprio computador (sem funcionário logado) */
  readerHostname: string | null;
  /** Nome do computador em que foi lida */
  readOnHostname: string | null;
}

export type ReaderType = 'EMPLOYEE' | 'COMPUTER' | 'REMOVED';

/** Quem leu, como a Central mostra */
export interface ReaderView {
  type: ReaderType;
  id: string;
  name: string;
  detail: string | null;
  sector: string | null;
  computer: string | null;
  readAt: string;
}

/** Quem ainda não leu (só para destinos com lista conhecida: funcionário, setor, turno, computador) */
export interface PendingView {
  type: 'EMPLOYEE' | 'COMPUTER';
  id: string;
  name: string;
  detail: string | null;
  sector: string | null;
  situation: string;
}

/**
 * Quem está lendo: o computador e, se houver, o funcionário logado nele.
 * Com funcionário logado, a caixa de entrada e as leituras são dele; sem login, do computador.
 */
export interface Recipient {
  computerId: string;
  registeredAt: string;
  employee: {
    id: string;
    name: string;
    registration: string;
    sector: string | null;
    shift: string | null;
    createdAt: string;
  } | null;
}

/** Chave de leitura: o funcionário logado ou, sem login, o próprio computador */
export function readerIdOf(recipient: Recipient): string {
  return recipient.employee?.id ?? recipient.computerId;
}

/** Mensagens "Todos" valem a partir de quando o leitor passou a existir */
export function allMessagesSince(recipient: Recipient): string {
  return recipient.employee?.createdAt ?? recipient.registeredAt;
}

export function formatMessageId(seq: number): string {
  return `MSG-${String(seq).padStart(6, '0')}`;
}

export function parseMessageId(id: string): number | null {
  const match = /^MSG-(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * Regra de destinatário (a mesma de RECIPIENT_FILTER em message.sqlite-repository.ts).
 * - "Todos": a partir de quando o leitor passou a existir (um PC instalado hoje não herda
 *   meses de histórico como "não lido");
 * - funcionário, setor e turno: valem para o funcionário logado no computador.
 * Novos destinos entram aqui e no SQL.
 */
export function isRecipient(message: Pick<Message, 'target' | 'targetId' | 'createdAt'>, recipient: Recipient): boolean {
  const employee = recipient.employee;
  switch (message.target) {
    case 'ALL':
      return message.createdAt >= allMessagesSince(recipient);
    case 'COMPUTER':
      return message.targetId === recipient.computerId;
    case 'EMPLOYEE':
      return employee !== null && message.targetId === employee.id;
    case 'SECTOR':
      return employee !== null && employee.sector !== null && message.targetId === employee.sector;
    case 'SHIFT':
      return employee !== null && employee.shift !== null && message.targetId === employee.shift;
    default:
      return false;
  }
}
