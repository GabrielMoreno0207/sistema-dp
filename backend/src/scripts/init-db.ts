/**
 * Cria (ou atualiza) o banco: aplica as migrações e cria o usuário inicial do DP.
 * Uso (na pasta backend/):  npm run db:init
 * Seguro de rodar várias vezes: não apaga nada.
 */
import Fastify from 'fastify';
import { env } from '../config/env';
import { openDatabase } from '../database/open';
import { AuthService } from '../modules/auth/auth.service';
import { ComputerService } from '../modules/computers/computer.service';

async function main(): Promise<void> {
  const db = await openDatabase();
  const repositories = db.repositories;
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
    const [admins, employees, computers] = await Promise.all([
      repositories.users.countByRole('ADMIN'),
      repositories.users.countByRole('EMPLOYEE'),
      repositories.computers.findAll(),
    ]);
    console.log(`Banco pronto -> ${db.description}`);
    console.log(`  usuários do DP: ${admins} | funcionários: ${employees} | computadores: ${computers.length}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error('Falha ao preparar o banco:', err instanceof Error ? err.message : err);
  process.exit(1);
});
