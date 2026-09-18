/**
 * Libera um computador para se registrar de novo (ex.: Windows reinstalado ou PC formatado).
 * Uso (na pasta backend/):  npm run liberar-pc -- PC-1A2B3C4D5E6F
 * O ID aparece no app, em "Meu perfil", e na tabela de Computadores da Central.
 */
import Fastify from 'fastify';
import { env } from '../config/env';
import { createSqliteRepositories } from '../database/repositories';
import { openSqliteDatabase } from '../database/sqlite';
import { AuthService } from '../modules/auth/auth.service';
import { ComputerService } from '../modules/computers/computer.service';

async function main(): Promise<void> {
  const computerId = process.argv[2]?.trim().toUpperCase();
  if (!computerId) {
    console.error('Informe o ID do computador. Exemplo: npm run liberar-pc -- PC-1A2B3C4D5E6F');
    process.exit(1);
  }

  const db = openSqliteDatabase(env.databasePath);
  const log = Fastify({ logger: false }).log; // logger silencioso: o script só imprime o resultado
  const repositories = createSqliteRepositories(db);
  const auth = new AuthService(
    repositories.users,
    repositories.tokens,
    new ComputerService(repositories.computers, log),
    { sessionTtlHours: env.sessionTtlHours },
    log,
  );

  try {
    await auth.resetComputerCredential(computerId);
    console.log(`Computador "${computerId}" liberado. Abra o app nele: ele se registra de novo sozinho.`);
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    console.error(status === 404 ? `Computador "${computerId}" não encontrado.` : (err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
