/**
 * Troca a senha de um usuário do DP (e encerra as sessões abertas dele).
 * Uso (na pasta backend/):  npm run set-password -- admin
 * A nova senha é digitada sem aparecer na tela e não fica no histórico de comandos.
 */
import Fastify from 'fastify';
import { env } from '../config/env';
import { openDatabase } from '../database/open';
import { AuthService } from '../modules/auth/auth.service';
import { ComputerService } from '../modules/computers/computer.service';
import { askHidden } from './prompt';

async function main(): Promise<void> {
  const username = process.argv[2];
  if (!username) {
    console.error('Informe o usuário. Exemplo: npm run set-password -- admin');
    process.exit(1);
  }

  const password = await askHidden(`Nova senha para "${username}" (mínimo 8 caracteres): `);
  const confirmation = await askHidden('Confirme a nova senha: ');
  if (password !== confirmation) {
    console.error('As senhas não conferem. Nada foi alterado.');
    process.exit(1);
  }

  const db = await openDatabase();
  const log = Fastify({ logger: false }).log; // logger silencioso: o script só imprime o resultado
  const repositories = db.repositories;
  const auth = new AuthService(
    repositories.users,
    repositories.tokens,
    new ComputerService(repositories.computers, log),
    { sessionTtlHours: env.sessionTtlHours },
    log,
  );

  try {
    const changed = await auth.setPassword(username, password);
    console.log(changed ? `Senha de "${username}" alterada. Sessões abertas foram encerradas.` : `Usuário "${username}" não encontrado.`);
    process.exitCode = changed ? 0 : 1;
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
