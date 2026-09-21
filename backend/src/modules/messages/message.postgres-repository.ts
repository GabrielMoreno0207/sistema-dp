import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
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

function toMessage(row: Row): Message {
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
 * Os parâmetros $1..$6 vêm de recipientParams(), nesta ordem.
 * Novos destinos: atualizar os dois lugares.
 */
const RECIPIENT_FILTER = `(
  (m.target = 'ALL' AND m.created_at >= $1)
  OR (m.target = 'COMPUTER' AND m.target_id = $2)
  OR (m.target = 'EMPLOYEE' AND m.target_id = $3)
  OR (m.target = 'SECTOR' AND m.target_id = $4)
  OR (m.target = 'SHIFT' AND m.target_id = $5)
)`;

/** $1 = since, $2 = computerId, $3 = employeeId, $4 = sector, $5 = shift, $6 = readerId */
function recipientParams(recipient: Recipient): unknown[] {
  return [
    allMessagesSince(recipient),
    recipient.computerId,
    recipient.employee?.id ?? null,
    recipient.employee?.sector ?? null,
    recipient.employee?.shift ?? null,
    readerIdOf(recipient),
  ];
}

/** Destinatários de cada mensagem (para o "X de N" da Central) */
const RECIPIENT_COUNT = `CASE m.target
  WHEN 'ALL' THEN (SELECT COUNT(*) FROM computers c WHERE c.registered_at <= m.created_at)
  WHEN 'SECTOR' THEN (SELECT COUNT(*) FROM users u WHERE u.role = 'EMPLOYEE' AND u.status = 'ACTIVE' AND u.sector = m.target_id)
  WHEN 'SHIFT' THEN (SELECT COUNT(*) FROM users u WHERE u.role = 'EMPLOYEE' AND u.status = 'ACTIVE' AND u.shift = m.target_id)
  ELSE 1
END`;

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async create(data: NewMessage, now: Date): Promise<Message> {
    const row = await this.db.one(
      `INSERT INTO messages (title, content, type, target, target_id, sender, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.title, data.content, data.type, data.target, data.targetId, data.sender, now.toISOString()],
    );
    return toMessage(row as Row);
  }

  async findById(id: string): Promise<Message | null> {
    const seq = parseMessageId(id);
    if (seq === null) return null;
    const row = await this.db.one('SELECT * FROM messages WHERE seq = $1', [seq]);
    return row ? toMessage(row) : null;
  }

  async findAllWithStats(limit: number): Promise<MessageWithStats[]> {
    const rows = await this.db.all(
      `SELECT m.*,
         (SELECT COUNT(*) FROM message_reads r WHERE r.message_seq = m.seq) AS read_count,
         ${RECIPIENT_COUNT} AS recipient_count
       FROM messages m ORDER BY m.seq DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      ...toMessage(row),
      readCount: Number(row.read_count),
      recipientCount: Number(row.recipient_count),
    }));
  }

  async findForRecipient(recipient: Recipient, query: RecipientQuery): Promise<RecipientMessage[]> {
    const rows = await this.db.all(
      `SELECT m.*, r.read_at FROM messages m
       LEFT JOIN message_reads r ON r.message_seq = m.seq AND r.reader_id = $6
       WHERE ${RECIPIENT_FILTER} AND ($7::int = 0 OR r.read_at IS NULL)
       ORDER BY m.seq DESC LIMIT $8::bigint`,
      [
        ...recipientParams(recipient),
        query.unreadOnly ? 1 : 0,
        query.limit ?? null, // LIMIT NULL = sem limite no PostgreSQL
      ],
    );
    return rows.map((row) => {
      const readAt = nullableText(row, 'read_at');
      return { ...toMessage(row), read: readAt !== null, readAt };
    });
  }

  async countUnread(recipient: Recipient): Promise<number> {
    const row = await this.db.one(
      `SELECT COUNT(*) AS total FROM messages m
       LEFT JOIN message_reads r ON r.message_seq = m.seq AND r.reader_id = $6
       WHERE ${RECIPIENT_FILTER} AND r.read_at IS NULL`,
      recipientParams(recipient),
    );
    return Number(row?.total ?? 0);
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
    await this.db.run(
      `INSERT INTO message_reads (message_seq, reader_id, computer_id, reader_name, reader_registration, read_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [seq, readerId, computerId, reader?.name ?? null, reader?.registration ?? null, now.toISOString()],
    );
    const row = await this.db.one('SELECT read_at FROM message_reads WHERE message_seq = $1 AND reader_id = $2', [
      seq,
      readerId,
    ]);
    return text(row as Row, 'read_at');
  }

  async listReads(messageId: string): Promise<MessageRead[]> {
    const seq = parseMessageId(messageId);
    if (seq === null) return [];
    const rows = await this.db.all(
      `SELECT r.reader_id, r.read_at, r.computer_id,
         COALESCE(u.name, r.reader_name) AS user_name,
         COALESCE(u.registration, r.reader_registration) AS user_registration,
         u.sector AS user_sector,
         (u.id IS NULL AND r.reader_name IS NOT NULL)::int AS user_removed,
         rc.hostname AS reader_hostname, pc.hostname AS read_on_hostname
       FROM message_reads r
       LEFT JOIN users u ON u.id = r.reader_id
       LEFT JOIN computers rc ON rc.computer_id = r.reader_id
       LEFT JOIN computers pc ON pc.computer_id = r.computer_id
       WHERE r.message_seq = $1
       ORDER BY r.read_at`,
      [seq],
    );
    return rows.map((row) => ({
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
    const row = await this.db.one('SELECT read_at FROM message_reads WHERE message_seq = $1 AND reader_id = $2', [
      seq,
      readerId,
    ]);
    return row ? nullableText(row, 'read_at') : null;
  }

  async countReads(messageId: string): Promise<number> {
    const seq = parseMessageId(messageId);
    if (seq === null) return 0;
    const row = await this.db.one('SELECT COUNT(*) AS total FROM message_reads WHERE message_seq = $1', [seq]);
    return Number(row?.total ?? 0);
  }

  async countRecipients(message: Message): Promise<number> {
    const seq = parseMessageId(message.id);
    if (seq === null) return 0;
    const row = await this.db.one(`SELECT ${RECIPIENT_COUNT} AS total FROM messages m WHERE m.seq = $1`, [seq]);
    return Number(row?.total ?? 0);
  }

  // ---------------------------------------------------------------- limpeza (conta do TI)

  async delete(messageId: string): Promise<boolean> {
    const seq = parseMessageId(messageId);
    if (seq === null) return false;
    // As leituras sairiam junto pelo ON DELETE CASCADE; apagamos antes por clareza
    return this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM message_reads WHERE message_seq = $1', [seq]);
      return (await tx.run('DELETE FROM messages WHERE seq = $1', [seq])) > 0;
    });
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const iso = date.toISOString();
    return this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM message_reads WHERE message_seq IN (SELECT seq FROM messages WHERE created_at < $1)', [iso]);
      return tx.run('DELETE FROM messages WHERE created_at < $1', [iso]);
    });
  }

  async deleteAll(): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM message_reads');
      return tx.run('DELETE FROM messages');
    });
  }
}
