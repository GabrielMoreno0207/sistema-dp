import { nullableText, text, type PostgresDatabase } from '../../database/postgres';
import type { StoredToken, TokenRepository, TokenSubject } from './token.repository';

export class PostgresTokenRepository implements TokenRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async save(token: StoredToken): Promise<void> {
    await this.db.run(
      'INSERT INTO auth_tokens (token_hash, subject_type, subject_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [token.tokenHash, token.subjectType, token.subjectId, token.createdAt, token.expiresAt],
    );
  }

  async find(tokenHash: string): Promise<StoredToken | null> {
    const row = await this.db.one('SELECT * FROM auth_tokens WHERE token_hash = $1', [tokenHash]);
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
    await this.db.run('DELETE FROM auth_tokens WHERE token_hash = $1', [tokenHash]);
  }

  async deleteBySubject(subjectType: TokenSubject, subjectId: string): Promise<void> {
    await this.db.run('DELETE FROM auth_tokens WHERE subject_type = $1 AND subject_id = $2', [subjectType, subjectId]);
  }

  async deleteExpired(now: Date): Promise<number> {
    return this.db.run('DELETE FROM auth_tokens WHERE expires_at IS NOT NULL AND expires_at <= $1', [now.toISOString()]);
  }
}
