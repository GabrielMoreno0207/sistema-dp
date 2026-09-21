import { Pool, type PoolClient } from 'pg';
import { POSTGRES_MIGRATIONS } from './migrations.postgres';
import type { Row } from './rows';

export { nullableText, text, type Row } from './rows';

/** O que os repositórios usam do PostgreSQL (consulta simples ou dentro de transação). */
export interface PostgresExecutor {
  /** Todas as linhas da consulta. */
  all(sql: string, params?: readonly unknown[]): Promise<Row[]>;
  /** A primeira linha, ou null se a consulta não retornou nada. */
  one(sql: string, params?: readonly unknown[]): Promise<Row | null>;
  /** Executa e devolve quantas linhas foram afetadas (equivale ao "changes" do SQLite). */
  run(sql: string, params?: readonly unknown[]): Promise<number>;
}

export interface PostgresDatabase extends PostgresExecutor {
  /** Roda várias operações em uma transação: ou tudo grava, ou nada grava. */
  transaction<T>(fn: (tx: PostgresExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function executor(run: (sql: string, params: readonly unknown[]) => Promise<{ rows: Row[]; rowCount: number | null }>): PostgresExecutor {
  return {
    async all(sql, params = []) {
      return (await run(sql, params)).rows;
    },
    async one(sql, params = []) {
      return (await run(sql, params)).rows[0] ?? null;
    },
    async run(sql, params = []) {
      return (await run(sql, params)).rowCount ?? 0;
    },
  };
}

/**
 * Abre o pool de conexões com o PostgreSQL e aplica as migrações pendentes.
 *
 * A URL tem o formato postgresql://usuario:senha@servidor:5433/banco
 * (veja DATABASE_URL no .env.postgres).
 */
export async function openPostgresDatabase(url: string, options: { schema?: string } = {}): Promise<PostgresDatabase> {
  const schema = options.schema ?? 'dp';
  const pool = new Pool({
    connectionString: url,
    // search_path na própria conexão: vale desde o primeiro comando, sem consulta extra
    options: `-c search_path=${validSchemaName(schema)},public`,
    // Limites pensados em muitos PCs conectando juntos, sem afogar o banco
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'sistema-dp',
  });

  // Sem este ouvinte, um erro em conexão ociosa derruba o processo
  pool.on('error', (err) => {
    console.error('Erro em conexão ociosa do PostgreSQL:', err.message);
  });

  const db: PostgresDatabase = {
    ...executor((sql, params) => pool.query(sql, params as unknown[])),

    async transaction(fn) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(executor((sql, params) => client.query(sql, params as unknown[])));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };

  await createSchema(db, schema);
  await migrate(db);
  return db;
}

/** Só aceita nomes simples: o valor entra na conexão e no SQL sem aspas. */
function validSchemaName(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Nome de schema inválido: "${name}"`);
  return name;
}

function quoteIdentifier(name: string): string {
  return `"${validSchemaName(name)}"`;
}

async function createSchema(db: PostgresDatabase, schema: string): Promise<void> {
  await db.run(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
  // Extensões que o schema usa (CITEXT nas colunas que ignoram maiúsculas)
  await db.run('CREATE EXTENSION IF NOT EXISTS citext');
}

async function migrate(db: PostgresDatabase): Promise<void> {
  await db.run(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((row) => Number(row.version)));

  for (const migration of POSTGRES_MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    try {
      await db.transaction(async (tx) => {
        await tx.run(migration.sql);
        await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)', [
          migration.version,
          migration.name,
          new Date().toISOString(),
        ]);
      });
    } catch (err) {
      throw new Error(`Falha na migração ${migration.version} (${migration.name}): ${(err as Error).message}`);
    }
  }
}
