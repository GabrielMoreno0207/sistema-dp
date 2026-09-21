import { text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { AttachmentRepository } from './attachment.repository';
import type { Attachment, AttachmentKind, NewAttachment, StoredAttachment } from './attachment.types';

function toStored(row: Row): StoredAttachment {
  return {
    id: text(row, 'id'),
    messageSeq: row.message_seq === null || row.message_seq === undefined ? null : Number(row.message_seq),
    name: text(row, 'name'),
    mimeType: text(row, 'mime_type'),
    size: Number(row.size),
    kind: text(row, 'kind') as AttachmentKind,
    storedName: text(row, 'stored_name'),
    uploadedBy: text(row, 'uploaded_by'),
    createdAt: text(row, 'created_at'),
  };
}

function toPublic(attachment: StoredAttachment): Attachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
  };
}

export class PostgresAttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async create(data: NewAttachment, now: Date): Promise<StoredAttachment> {
    const row = await this.db.one(
      `INSERT INTO attachments (id, message_seq, name, mime_type, size, kind, stored_name, uploaded_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        data.id,
        data.messageSeq,
        data.name,
        data.mimeType,
        data.size,
        data.kind,
        data.storedName,
        data.uploadedBy,
        now.toISOString(),
      ],
    );
    return toStored(row as Row);
  }

  async findById(id: string): Promise<StoredAttachment | null> {
    const row = await this.db.one('SELECT * FROM attachments WHERE id = $1', [id]);
    return row ? toStored(row) : null;
  }

  async findPending(ids: string[], uploadedBy: string): Promise<StoredAttachment[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.all(
      `SELECT * FROM attachments
       WHERE message_seq IS NULL AND uploaded_by = $1 AND id = ANY($2::text[])`,
      [uploadedBy, ids],
    );
    const found = rows.map(toStored);
    // Devolve na ordem em que o DP escolheu os arquivos
    return ids.map((id) => found.find((a) => a.id === id)).filter((a): a is StoredAttachment => a !== undefined);
  }

  async attachToMessage(ids: string[], messageSeq: number): Promise<void> {
    if (ids.length === 0) return;
    await this.db.run('UPDATE attachments SET message_seq = $1 WHERE id = ANY($2::text[]) AND message_seq IS NULL', [
      messageSeq,
      ids,
    ]);
  }

  async listForMessages(messageSeqs: number[]): Promise<Map<number, Attachment[]>> {
    const result = new Map<number, Attachment[]>();
    if (messageSeqs.length === 0) return result;
    // created_at + id no lugar do rowid do SQLite: mantém a ordem de envio
    const rows = await this.db.all(
      `SELECT * FROM attachments WHERE message_seq = ANY($1::bigint[]) ORDER BY message_seq, created_at, id`,
      [messageSeqs],
    );
    for (const row of rows) {
      const stored = toStored(row);
      if (stored.messageSeq === null) continue;
      const list = result.get(stored.messageSeq) ?? [];
      list.push(toPublic(stored));
      result.set(stored.messageSeq, list);
    }
    return result;
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM attachments WHERE id = $1', [id])) > 0;
  }

  async listAbandoned(before: Date): Promise<StoredAttachment[]> {
    const rows = await this.db.all('SELECT * FROM attachments WHERE message_seq IS NULL AND created_at < $1', [
      before.toISOString(),
    ]);
    return rows.map(toStored);
  }

  async listStoredNames(): Promise<string[]> {
    return (await this.db.all('SELECT stored_name FROM attachments')).map((row) => text(row, 'stored_name'));
  }
}
