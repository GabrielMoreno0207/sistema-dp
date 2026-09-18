import { nullableText, text, type SqliteDatabase } from '../../database/sqlite';
import type { StoredToken, TokenRepository, TokenSubject } from './token.repository';

export class SqliteTokenRepository implements TokenRepository {
  private readonly sql;

  constructor(db: SqliteDatabase) {
    this.sql = {
      insert: db.prepare(
        'INSERT INTO auth_tokens (token_hash, subject_type, subject_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ),
      find: db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ?'),
      delete: db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?'),
      deleteBySubject: db.prepare('DELETE FROM auth_tokens WHERE subject_type = ? AND subject_id = ?'),
      deleteExpired: db.prepare('DELETE FROM auth_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?'),
    };
  }

  async save(token: StoredToken): Promise<void> {
    this.sql.insert.run(token.tokenHash, token.subjectType, token.subjectId, token.createdAt, token.expiresAt);
  }

  async find(tokenHash: string): Promise<StoredToken | null> {
    const row = this.sql.find.get(tokenHash);
    if (!row) return null;
    return {
      tokenHash: text(row, 'token_hash'),
      subjectType: text(row, 'subject_type') as TokenSubject,
      subjectId: text(row, 'subject_id'),
      createdAt: text(row, 'created_at'),
      expiresAt: nullableText(row, 'expires_at'),
    };
  }

  async delete(tokenHash: string): Promise<void> {
    this.sql.delete.run(tokenHash);
  }

  async deleteBySubject(subjectType: TokenSubject, subjectId: string): Promise<void> {
    this.sql.deleteBySubject.run(subjectType, subjectId);
  }

  async deleteExpired(now: Date): Promise<number> {
    return Number(this.sql.deleteExpired.run(now.toISOString()).changes);
  }
}
