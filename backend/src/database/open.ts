import { env } from '../config/env';
import { createPostgresRepositories, type Repositories } from './repositories';
import { openPostgresDatabase } from './postgres';

export interface OpenedDatabase {
  repositories: Repositories;
  /** Descrição para o log: qual banco está em uso */
  description: string;
  close(): Promise<void>;
}

/**
 * Abre o banco e devolve os repositórios prontos, para o servidor e para os
 * scripts de manutenção. O sistema usa PostgreSQL: sem DATABASE_URL não sobe.
 */
export async function openDatabase(): Promise<OpenedDatabase> {
  const db = await openPostgresDatabase(env.databaseUrl, { schema: env.databaseSchema });
  return {
    repositories: createPostgresRepositories(db),
    description: `PostgreSQL: ${hideCredentials(env.databaseUrl)} (schema ${env.databaseSchema})`,
    close: () => db.close(),
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
