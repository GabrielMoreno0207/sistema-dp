import { text, type SqliteDatabase } from '../../database/sqlite';
import type { AttachmentRepository } from './attachment.repository';
import type { Attachment, AttachmentKind, NewAttachment, StoredAttachment } from './attachment.types';

function toStored(row: Record<string, unknown>): StoredAttachment {
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

/** Lista de "?" para um IN (...) com quantidade variável */
function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

export class SqliteAttachmentRepository implements AttachmentRepository {
  private readonly sql;

  constructor(private readonly db: SqliteDatabase) {
    this.sql = {
      insert: db.prepare(
        `INSERT INTO attachments (id, message_seq, name, mime_type, size, kind, stored_name, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ),
      findById: db.prepare('SELECT * FROM attachments WHERE id = ?'),
      attach: db.prepare('UPDATE attachments SET message_seq = ? WHERE id = ? AND message_seq IS NULL'),
      delete: db.prepare('DELETE FROM attachments WHERE id = ?'),
      listAbandoned: db.prepare('SELECT * FROM attachments WHERE message_seq IS NULL AND created_at < ?'),
      listStoredNames: db.prepare('SELECT stored_name FROM attachments'),
    };
  }

  async create(data: NewAttachment, now: Date): Promise<StoredAttachment> {
    const row = this.sql.insert.get(
      data.id,
      data.messageSeq,
      data.name,
      data.mimeType,
      data.size,
      data.kind,
      data.storedName,
      data.uploadedBy,
      now.toISOString(),
    ) as Record<string, unknown>;
    return toStored(row);
  }

  async findById(id: string): Promise<StoredAttachment | null> {
    const row = this.sql.findById.get(id);
    return row ? toStored(row) : null;
  }

  async findPending(ids: string[], uploadedBy: string): Promise<StoredAttachment[]> {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT * FROM attachments
         WHERE message_seq IS NULL AND uploaded_by = ? AND id IN (${placeholders(ids.length)})`,
      )
      .all(uploadedBy, ...ids);
    const found = rows.map(toStored);
    // Devolve na ordem em que o DP escolheu os arquivos
    return ids.map((id) => found.find((a) => a.id === id)).filter((a): a is StoredAttachment => a !== undefined);
  }

  async attachToMessage(ids: string[], messageSeq: number): Promise<void> {
    for (const id of ids) this.sql.attach.run(messageSeq, id);
  }

  async listForMessages(messageSeqs: number[]): Promise<Map<number, Attachment[]>> {
    const result = new Map<number, Attachment[]>();
    if (messageSeqs.length === 0) return result;
    const rows = this.db
      .prepare(
        `SELECT * FROM attachments WHERE message_seq IN (${placeholders(messageSeqs.length)}) ORDER BY message_seq, rowid`,
      )
      .all(...messageSeqs);
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
    return Number(this.sql.delete.run(id).changes) > 0;
  }

  async listAbandoned(before: Date): Promise<StoredAttachment[]> {
    return this.sql.listAbandoned.all(before.toISOString()).map(toStored);
  }

  async listStoredNames(): Promise<string[]> {
    return this.sql.listStoredNames.all().map((row) => text(row, 'stored_name'));
  }
}
