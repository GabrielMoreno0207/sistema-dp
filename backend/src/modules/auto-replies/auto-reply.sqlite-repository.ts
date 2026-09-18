import { randomUUID } from 'node:crypto';
import { nullableText, text, type SqliteDatabase } from '../../database/sqlite';
import type { AutoReplyRepository } from './auto-reply.repository';
import type { AutoReply, AutoReplyInput } from './auto-reply.types';

function toAutoReply(row: Record<string, unknown>): AutoReply {
  return {
    id: text(row, 'id'),
    dpUserId: text(row, 'dp_user_id'),
    sector: nullableText(row, 'sector'),
    content: text(row, 'content'),
    active: Number(row.active) === 1,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

export class SqliteAutoReplyRepository implements AutoReplyRepository {
  private readonly sql;

  constructor(db: SqliteDatabase) {
    this.sql = {
      listByDpUser: db.prepare(
        `SELECT * FROM auto_replies WHERE dp_user_id = ? ORDER BY (sector IS NOT NULL), sector COLLATE NOCASE`,
      ),
      findById: db.prepare(`SELECT * FROM auto_replies WHERE id = ?`),
      insert: db.prepare(
        `INSERT INTO auto_replies (id, dp_user_id, sector, content, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ),
      update: db.prepare(
        `UPDATE auto_replies SET sector = ?, content = ?, active = ?, updated_at = ? WHERE id = ? RETURNING *`,
      ),
      delete: db.prepare(`DELETE FROM auto_replies WHERE id = ?`),
    };
  }

  async listByDpUser(dpUserId: string): Promise<AutoReply[]> {
    return this.sql.listByDpUser.all(dpUserId).map(toAutoReply);
  }

  async findById(id: string): Promise<AutoReply | null> {
    const row = this.sql.findById.get(id) as Record<string, unknown> | undefined;
    return row ? toAutoReply(row) : null;
  }

  async create(dpUserId: string, input: AutoReplyInput, now: Date): Promise<AutoReply> {
    const at = now.toISOString();
    const row = this.sql.insert.get(randomUUID(), dpUserId, input.sector, input.content, input.active ? 1 : 0, at, at);
    return toAutoReply(row as Record<string, unknown>);
  }

  async update(id: string, input: AutoReplyInput, now: Date): Promise<AutoReply> {
    const row = this.sql.update.get(input.sector, input.content, input.active ? 1 : 0, now.toISOString(), id);
    return toAutoReply(row as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    this.sql.delete.run(id);
  }
}
