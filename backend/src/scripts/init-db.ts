/**
 * Cria (ou atualiza) o banco: aplica as migrações e cria o usuário inicial do DP.
 * Uso (na pasta backend/):  npm run db:init
 * Seguro de rodar várias vezes: não apaga nada.
 */
import Fastify from 'fastify';
import { env } from '../config/env';
import { createSqliteRepositories } from '../database/repositories';
import { openSqliteDatabase } from '../database/sqlite';
import { AuthService } from '../modules/auth/auth.service';
import { ComputerService } from '../modules/computers/computer.service';

async function main(): Promise<void> {
  const db = openSqliteDatabase(env.databasePath);
  const repositories = createSqliteRepositories(db);
  const log = Fastify({ logger: { level: 'info' } }).log;
  const auth = new AuthService(
    repositories.users,
    repositories.tokens,
    new ComputerService(repositories.computers, log),
    { sessionTtlHours: env.sessionTtlHours },
    log,
  );

  try {
    await auth.ensureInitialAdmin(env.admin);
    const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
    console.log(`Banco pronto: ${env.databasePath}`);
    console.log(`  usuários do DP: ${count('users')} | computadores: ${count('computers')} | mensagens: ${count('messages')}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Falha ao preparar o banco:', err instanceof Error ? err.message : err);
  process.exit(1);
});
