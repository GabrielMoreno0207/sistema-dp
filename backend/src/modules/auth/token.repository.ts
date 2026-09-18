export type TokenSubject = 'USER' | 'COMPUTER';

export interface StoredToken {
  tokenHash: string;
  subjectType: TokenSubject;
  subjectId: string;
  createdAt: string;
  /** null = não expira (tokens de computador, trocados a cada registro) */
  expiresAt: string | null;
}

export interface TokenRepository {
  save(token: StoredToken): Promise<void>;
  find(tokenHash: string): Promise<StoredToken | null>;
  delete(tokenHash: string): Promise<void>;
  deleteBySubject(subjectType: TokenSubject, subjectId: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}
