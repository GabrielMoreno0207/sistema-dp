import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

export { nullableText, text, type Row } from './rows';

export type SqliteDatabase = DatabaseSync;

/**
 * Abre (ou cria) o banco SQLite e aplica as migrações pendentes.
 * Usa o módulo nativo node:sqlite (Node 22.13+), sem dependências externas.
 */
export function openSqliteDatabase(path: string): SqliteDatabase {
  const inMemory = path === ':memory:';
  const fullPath = inMemory ? path : resolve(path);
  if (!inMemory) mkdirSync(dirname(fullPath), { recursive: true });

  const db = new DatabaseSync(fullPath);
  if (!inMemory) {
    db.exec('PRAGMA journal_mode = WAL;');
    // Com WAL, NORMAL continua seguro contra corrupção e evita um fsync a cada gravação
    // (com muitos PCs marcando leitura ao mesmo tempo, FULL enfileira gravações no disco)
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA cache_size = -16000;'); // ~16 MB de cache de páginas
  migrate(db);
  return db;
}

function migrate(db: SqliteDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => Number(row.version)),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Falha na migração ${migration.version} (${migration.name}): ${(err as Error).message}`);
    }
  }
}

