import type { Message, MessageRead, MessageWithStats, NewMessage, Recipient, RecipientMessage } from './message.types';

export interface RecipientQuery {
  unreadOnly?: boolean;
  limit?: number;
}

/**
 * Contrato de persistência das mensagens e do controle de leitura.
 * A leitura é por "leitor" (readerId): o funcionário logado ou, sem login, o computador.
 * Trocar o banco = criar outra implementação desta interface.
 */
export interface MessageRepository {
  create(data: NewMessage, now: Date): Promise<Message>;
  findById(id: string): Promise<Message | null>;
  findAllWithStats(limit: number): Promise<MessageWithStats[]>;
  findForRecipient(recipient: Recipient, query: RecipientQuery): Promise<RecipientMessage[]>;
  countUnread(recipient: Recipient): Promise<number>;
  /**
   * Retorna quando foi lida (se já estava lida, mantém a data original).
   * computerId = PC em que foi lida; reader = nome/matrícula do funcionário (guardados para o histórico).
   */
  markRead(
    messageId: string,
    readerId: string,
    computerId: string,
    reader: { name: string; registration: string } | null,
    now: Date,
  ): Promise<string>;
  /** Todas as leituras da mensagem, com nome do funcionário/computador */
  listReads(messageId: string): Promise<MessageRead[]>;
  getReadAt(messageId: string, readerId: string): Promise<string | null>;
  countReads(messageId: string): Promise<number>;
  countRecipients(message: Message): Promise<number>;

  // ---- Limpeza (só a conta do TI, pela Central) ----
  /** Apaga um comunicado e as leituras dele. Retorna false se não existia. */
  delete(messageId: string): Promise<boolean>;
  /** Apaga comunicados anteriores à data (e as leituras). Retorna quantos saíram. */
  deleteOlderThan(date: Date): Promise<number>;
  /** Apaga todos os comunicados e leituras. Retorna quantos saíram. */
  deleteAll(): Promise<number>;
}
