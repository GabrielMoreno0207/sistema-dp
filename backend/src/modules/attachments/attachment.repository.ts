import type { Attachment, NewAttachment, StoredAttachment } from './attachment.types';

/**
 * Contrato de persistência dos anexos. O conteúdo em si fica no AttachmentStorage;
 * aqui só os dados (nome, tipo, tamanho, a que comunicado pertence).
 */
export interface AttachmentRepository {
  create(data: NewAttachment, now: Date): Promise<StoredAttachment>;
  findById(id: string): Promise<StoredAttachment | null>;
  /** Uploads ainda sem comunicado, desta pessoa do DP (é o que o envio "adota") */
  findPending(ids: string[], uploadedBy: string): Promise<StoredAttachment[]>;
  /** Liga os uploads ao comunicado recém-criado, na ordem em que o DP escolheu */
  attachToMessage(ids: string[], messageSeq: number): Promise<void>;
  /** Anexos de vários comunicados de uma vez (lista da Central e caixa de entrada) */
  listForMessages(messageSeqs: number[]): Promise<Map<number, Attachment[]>>;
  delete(id: string): Promise<boolean>;
  /** Uploads abandonados (nunca viraram comunicado) anteriores à data */
  listAbandoned(before: Date): Promise<StoredAttachment[]>;
  /** Nome em disco de todos os anexos registrados (para achar arquivos sem registro) */
  listStoredNames(): Promise<string[]>;
}
