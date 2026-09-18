import { nullableText, text, type SqliteDatabase } from '../../database/sqlite';
import type { MessageRepository, RecipientQuery } from './message.repository';
import {
  allMessagesSince,
  formatMessageId,
  parseMessageId,
  readerIdOf,
  type Message,
  type MessageRead,
  type MessageType,
  type MessageWithStats,
  type NewMessage,
  type Recipient,
  type RecipientMessage,
  type TargetType,
} from './message.types';

function toMessage(row: Record<string, unknown>): Message {
  return {
    id: formatMessageId(Number(row.seq)),
    title: text(row, 'title'),
    content: text(row, 'content'),
    type: text(row, 'type') as MessageType,
    target: text(row, 'target') as TargetType,
    targetId: nullableText(row, 'target_id'),
    sender: text(row, 'sender'),
    createdAt: text(row, 'created_at'),
    attachments: [], // preenchidos pelo MessageService (ficam em outra tabela)
  };
}

/**
 * Regra de destinatário em SQL (mesma de isRecipient em message.types.ts).
 * Parâmetros vêm de recipientParams(). Novos destinos: atualizar os dois lugares.
 */
const RECIPIENT_FILTER = `(
  (m.target = 'ALL' AND m.created_at >= :since)
  OR (m.target = 'COMPUTER' AND m.target_id = :computerId)
  OR (m.target = 'EMPLOYEE' AND m.target_id = :employeeId)
  OR (m.target = 'SECTOR' AND m.target_id = :sector)
  OR (m.target = 'SHIFT' AND m.target_id = :shift)
)`;

/** Parâmetros nomeados usados por RECIPIENT_FILTER e pelo JOIN de leituras */
function recipientParams(recipient: Recipient) {
  return {
    computerId: recipient.computerId,
    since: allMessagesSince(recipient),
    employeeId: recipient.employee?.id ?? null,
    sector: recipient.employee?.sector ?? null,
    shift: recipient.employee?.shift ?? null,
    readerId: readerIdOf(recipient),
  };
}

/** Destinatários de cada mensagem (para o "X de N" da Central) */
const RECIPIENT_COUNT = `CASE m.target
  WHEN 'ALL' THEN (SELECT COUNT(*) FROM computers c WHERE c.registered_at <= m.created_at)
  WHEN 'SECTOR' THEN (SELECT COUNT(*) FROM users u WHERE u.role = 'EMPLOYEE' AND u.status = 'ACTIVE' AND u.sector = m.target_id)
  WHEN 'SHIFT' THEN (SELECT COUNT(*) FROM users u WHERE u.role = 'EMPLOYEE' AND u.status = 'ACTIVE' AND u.shift = m.target_id)
  ELSE 1
END`;

export class SqliteMessageRepository implements MessageRepository {
  private readonly sql;

  constructor(db: SqliteDatabase) {
    this.sql = {
      insert: db.prepare(
        `INSERT INTO messages (title, content, type, target, target_id, sender, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ),
      findBySeq: db.prepare('SELECT * FROM messages WHERE seq = ?'),
      findAllWithStats: db.prepare(
        `SELECT m.*,
           (SELECT COUNT(*) FROM message_reads r WHERE r.message_seq = m.seq) AS read_count,
           ${RECIPIENT_COUNT} AS recipient_count
         FROM messages m ORDER BY m.seq DESC LIMIT ?`,
      ),
      countRecipients: db.prepare(`SELECT ${RECIPIENT_COUNT} AS total FROM messages m WHERE m.seq = ?`),
      findForRecipient: db.prepare(
        `SELECT m.*, r.read_at FROM messages m
         LEFT JOIN message_reads r ON r.message_seq = m.seq AND r.reader_id = :readerId
         WHERE ${RECIPIENT_FILTER} AND (:unreadOnly = 0 OR r.read_at IS NULL)
         ORDER BY m.seq DESC LIMIT :limit`,
      ),
      countUnread: db.prepare(
        `SELECT COUNT(*) AS total FROM messages m
         LEFT JOIN message_reads r ON r.message_seq = m.seq AND r.reader_id = :readerId
         WHERE ${RECIPIENT_FILTER} AND r.read_at IS NULL`,
      ),
      insertRead: db.prepare(
        `INSERT INTO message_reads (message_seq, reader_id, computer_id, reader_name, reader_registration, read_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      ),
      listReads: db.prepare(
        `SELECT r.reader_id, r.read_at, r.computer_id,
           COALESCE(u.name, r.reader_name) AS user_name,
           COALESCE(u.registration, r.reader_registration) AS user_registration,
           u.sector AS user_sector,
           (u.id IS NULL AND r.reader_name IS NOT NULL) AS user_removed,
           rc.hostname AS reader_hostname, pc.hostname AS read_on_hostname
         FROM message_reads r
         LEFT JOIN users u ON u.id = r.reader_id
         LEFT JOIN computers rc ON rc.computer_id = r.reader_id
         LEFT JOIN computers pc ON pc.computer_id = r.computer_id
         WHERE r.message_seq = ?
         ORDER BY r.read_at`,
      ),
      getReadAt: db.prepare('SELECT read_at FROM message_reads WHERE message_seq = ? AND reader_id = ?'),
      countReads: db.prepare('SELECT COUNT(*) AS total FROM message_reads WHERE message_seq = ?'),
      // Limpeza (TI): as leituras saem junto com o comunicado
      deleteReadsOf: db.prepare('DELETE FROM message_reads WHERE message_seq = ?'),
      deleteOne: db.prepare('DELETE FROM messages WHERE seq = ?'),
      deleteReadsOlderThan: db.prepare(
        'DELETE FROM message_reads WHERE message_seq IN (SELECT seq FROM messages WHERE created_at < ?)',
      ),
      deleteOlderThan: db.prepare('DELETE FROM messages WHERE created_at < ?'),
      deleteAllReads: db.prepare('DELETE FROM message_reads'),
      deleteAllMessages: db.prepare('DELETE FROM messages'),
    };
  }

  async create(data: NewMessage, now: Date): Promise<Message> {
    const row = this.sql.insert.get(
      data.title,
      data.content,
      data.type,
      data.target,
      data.targetId,
      data.sender,
      now.toISOString(),
    ) as Record<string, unknown>;
    return toMessage(row);
  }

  async findById(id: string): Promise<Message | null> {
    const seq = parseMessageId(id);
    if (seq === null) return null;
    const row = this.sql.findBySeq.get(seq);
    return row ? toMessage(row) : null;
  }

  async findAllWithStats(limit: number): Promise<MessageWithStats[]> {
    return this.sql.findAllWithStats.all(limit).map((row) => ({
      ...toMessage(row),
      readCount: Number(row.read_count),
      recipientCount: Number(row.recipient_count),
    }));
  }

  async findForRecipient(recipient: Recipient, query: RecipientQuery): Promise<RecipientMessage[]> {
    const rows = this.sql.findForRecipient.all({
      ...recipientParams(recipient),
      unreadOnly: query.unreadOnly ? 1 : 0,
      limit: query.limit ?? -1, // -1 = sem limite no SQLite
    });
    return rows.map((row) => {
      const readAt = nullableText(row, 'read_at');
      return { ...toMessage(row), read: readAt !== null, readAt };
    });
  }

  async countUnread(recipient: Recipient): Promise<number> {
    const row = this.sql.countUnread.get(recipientParams(recipient)) as Record<string, unknown>;
    return Number(row.total);
  }

  async markRead(
    messageId: string,
    readerId: string,
    computerId: string,
    reader: { name: string; registration: string } | null,
    now: Date,
  ): Promise<string> {
    const seq = parseMessageId(messageId);
    if (seq === null) throw new Error(`ID de mensagem inválido: ${messageId}`);
    this.sql.insertRead.run(seq, readerId, computerId, reader?.name ?? null, reader?.registration ?? null, now.toISOString());
    return text(this.sql.getReadAt.get(seq, readerId) as Record<string, unknown>, 'read_at');
  }

  async listReads(messageId: string): Promise<MessageRead[]> {
    const seq = parseMessageId(messageId);
    if (seq === null) return [];
    return this.sql.listReads.all(seq).map((row) => ({
      readerId: text(row, 'reader_id'),
      readAt: text(row, 'read_at'),
      computerId: nullableText(row, 'computer_id'),
      user:
        row.user_name === null || row.user_name === undefined
          ? null
          : {
              name: text(row, 'user_name'),
              registration: nullableText(row, 'user_registration'),
              sector: nullableText(row, 'user_sector'),
              removed: Number(row.user_removed) === 1,
            },
      readerHostname: nullableText(row, 'reader_hostname'),
      readOnHostname: nullableText(row, 'read_on_hostname'),
    }));
  }

  async getReadAt(messageId: string, readerId: string): Promise<string | null> {
    const seq = parseMessageId(messageId);
    if (seq === null) return null;
    const row = this.sql.getReadAt.get(seq, readerId);
    return row ? nullableText(row, 'read_at') : null;
  }

  async countReads(messageId: string): Promise<number> {
    const seq = parseMessageId(messageId);
    if (seq === null) return 0;
    return Number((this.sql.countReads.get(seq) as Record<string, unknown>).total);
  }

  async countRecipients(message: Message): Promise<number> {
    const seq = parseMessageId(message.id);
    if (seq === null) return 0;
    return Number((this.sql.countRecipients.get(seq) as Record<string, unknown>).total);
  }

  // ---------------------------------------------------------------- limpeza (conta do TI)

  async delete(messageId: string): Promise<boolean> {
    const seq = parseMessageId(messageId);
    if (seq === null) return false;
    this.sql.deleteReadsOf.run(seq);
    return Number(this.sql.deleteOne.run(seq).changes) > 0;
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const iso = date.toISOString();
    this.sql.deleteReadsOlderThan.run(iso);
    return Number(this.sql.deleteOlderThan.run(iso).changes);
  }

  async deleteAll(): Promise<number> {
    this.sql.deleteAllReads.run();
    return Number(this.sql.deleteAllMessages.run().changes);
  }
}
