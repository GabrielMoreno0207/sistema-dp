import { randomUUID } from 'node:crypto';
import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { AutoReplyRepository } from './auto-reply.repository';
import type { AutoReply, AutoReplyInput } from './auto-reply.types';

function toAutoReply(row: Row): AutoReply {
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

export class PostgresAutoReplyRepository implements AutoReplyRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async listByDpUser(dpUserId: string): Promise<AutoReply[]> {
    // A geral (sector NULL) primeiro, depois os setores em ordem alfabética
    const rows = await this.db.all(
      'SELECT * FROM auto_replies WHERE dp_user_id = $1 ORDER BY (sector IS NOT NULL), lower(sector)',
      [dpUserId],
    );
    return rows.map(toAutoReply);
  }

  async findById(id: string): Promise<AutoReply | null> {
    const row = await this.db.one('SELECT * FROM auto_replies WHERE id = $1', [id]);
    return row ? toAutoReply(row) : null;
  }

  async create(dpUserId: string, input: AutoReplyInput, now: Date): Promise<AutoReply> {
    const at = now.toISOString();
    const row = await this.db.one(
      `INSERT INTO auto_replies (id, dp_user_id, sector, content, active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [randomUUID(), dpUserId, input.sector, input.content, input.active ? 1 : 0, at, at],
    );
    return toAutoReply(row as Row);
  }

  async update(id: string, input: AutoReplyInput, now: Date): Promise<AutoReply> {
    const row = await this.db.one(
      'UPDATE auto_replies SET sector = $1, content = $2, active = $3, updated_at = $4 WHERE id = $5 RETURNING *',
      [input.sector, input.content, input.active ? 1 : 0, now.toISOString(), id],
    );
    return toAutoReply(row as Row);
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM auto_replies WHERE id = $1', [id]);
  }
}
