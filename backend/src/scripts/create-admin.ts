/**
 * Cria logins da Central do DP.
 *
 * Uso (na pasta backend/):
 *   npm run create-admin -- <usuario> "<Nome que aparece nas mensagens>"            (pede a senha)
 *   npm run create-admin -- <usuario> "<Nome>" --gerar                                (gera uma senha inicial)
 *   npm run create-admin -- ti "TI" --gerar --sem-chat                                  (fora da lista de contatos do chat)
 *
 * Com --gerar, a senha é gravada em data/credenciais-iniciais.txt (fora do controle de versão)
 * e não aparece na tela. A pessoa pode trocar a senha quando quiser pelo botão "Minha senha" da Central.
 */
import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env, PROJECT_ROOT } from '../config/env';
import { createSqliteRepositories } from '../database/repositories';
import { openSqliteDatabase } from '../database/sqlite';
import { AuthService } from '../modules/auth/auth.service';
import { ComputerService } from '../modules/computers/computer.service';
import { askHidden } from './prompt';

/** Senha inicial legível e forte, ex.: Dp-7Kq2-Wm9x-Rt4z */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `Dp-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const generate = args.includes('--gerar');
  // --sem-chat: não aparece na lista de contatos do chat no app (ex.: TI)
  const chatContact = !args.includes('--sem-chat');
  const [username, name] = args.filter((a) => !a.startsWith('--'));
  if (!username || !name) {
    console.error('Uso: npm run create-admin -- <usuario> "<Nome>" [--gerar] [--sem-chat]');
    process.exit(1);
  }

  let password: string;
  if (generate) {
    password = generatePassword();
  } else {
    password = await askHidden(`Senha inicial para "${username}" (mínimo 8 caracteres): `);
    if (password !== (await askHidden('Confirme a senha: '))) {
      console.error('As senhas não conferem. Nada foi criado.');
      process.exit(1);
    }
  }

  const db = openSqliteDatabase(env.databasePath);
  const log = Fastify({ logger: false }).log;
  const repositories = createSqliteRepositories(db);
  const auth = new AuthService(
    repositories.users,
    repositories.tokens,
    new ComputerService(repositories.computers, log),
    { sessionTtlHours: env.sessionTtlHours },
    log,
  );

  try {
    const user = await auth.createAdmin(username, name, password, { chatContact });
    if (!chatContact) console.log('(não aparece na lista de contatos do chat no aplicativo)');
    if (generate) {
      const dir = join(PROJECT_ROOT, 'data');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, 'credenciais-iniciais.txt');
      appendFileSync(
        file,
        `${new Date().toLocaleString('pt-BR')}  usuário: ${user.username.padEnd(12)} nome: ${user.name.padEnd(20)} senha inicial: ${password}\n`,
        'utf-8',
      );
      console.log(`Login "${user.username}" (${user.name}) criado. Senha inicial gravada em data\\credenciais-iniciais.txt`);
    } else {
      console.log(`Login "${user.username}" (${user.name}) criado.`);
    }
    console.log('Se quiser, a pessoa troca a senha pelo botão "Minha senha" no topo da Central.');
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
