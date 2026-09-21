import { env } from '../config/env';
import { createPostgresRepositories, createSqliteRepositories, type Repositories } from './repositories';
import { openPostgresDatabase } from './postgres';
import { openSqliteDatabase } from './sqlite';

export interface OpenedDatabase {
  repositories: Repositories;
  /** Descrição para o log: qual banco está em uso */
  description: string;
  close(): Promise<void>;
}

/**
 * Abre o banco configurado e devolve os repositórios prontos.
 *
 * Com DATABASE_URL definida usa PostgreSQL; sem ela, o SQLite de sempre
 * (DATABASE_PATH). Serve para o servidor e para os scripts de manutenção.
 */
export async function openDatabase(): Promise<OpenedDatabase> {
  if (env.databaseUrl) {
    const db = await openPostgresDatabase(env.databaseUrl, { schema: env.databaseSchema });
    return {
      repositories: createPostgresRepositories(db),
      description: `PostgreSQL: ${hideCredentials(env.databaseUrl)} (schema ${env.databaseSchema})`,
      close: () => db.close(),
    };
  }

  const db = openSqliteDatabase(env.databasePath);
  return {
    repositories: createSqliteRepositories(db),
    description: `SQLite: ${env.databasePath}`,
    close: async () => db.close(),
  };
}

/** Esconde usuário e senha da URL antes de escrever no log. */
export function hideCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return 'postgres';
  }
}
