/**
 * Testes da API com app.inject() (sem abrir porta).
 *
 * Por padrão usa SQLite em memória:            npm test
 * Para rodar os mesmos testes no PostgreSQL:   npm run test:postgres
 * (nesse caso o schema de teste é apagado e recriado a cada execução)
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

// Configuração de teste (definida antes de carregar a aplicação; o .env não sobrescreve)
const PASSWORD = 'senha-de-teste-123';
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'fatal';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = PASSWORD;
// Fixo aqui: o .env da máquina não pode mudar o resultado dos testes (ex.: ADMIN_NAME diferente)
process.env.ADMIN_NAME = 'Departamento Pessoal';
// Anexos em pasta temporária: o teste não mexe em backend/data/uploads
const UPLOADS_PATH = join(tmpdir(), `sistema-dp-test-uploads-${process.pid}`);
process.env.UPLOADS_PATH = UPLOADS_PATH;
delete process.env.TLS_CERT_FILE;
delete process.env.TLS_KEY_FILE;

const POSTGRES_URL = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
if (!POSTGRES_URL) {
  throw new Error('Defina TEST_DATABASE_URL: os testes rodam no PostgreSQL, que é o banco do sistema.');
}
const TEST_SCHEMA = 'teste_automatizado';
process.env.DATABASE_URL = POSTGRES_URL;
process.env.DATABASE_SCHEMA = TEST_SCHEMA;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let adminToken: string;
let repos: import('../src/database/repositories').Repositories;

const secret = (c: string) => c.repeat(40);

before(async () => {
  // Cada arquivo de teste usa um schema próprio, recriado do zero
  const { Client } = await import('pg');
  const limpeza = new Client({ connectionString: POSTGRES_URL });
  await limpeza.connect();
  await limpeza.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await limpeza.end();

  const { buildApp } = await import('../src/app');
  const { openDatabase } = await import('../src/database/open');
  const banco = await openDatabase();
  repos = banco.repositories;
  fecharBanco = banco.close;
  app = buildApp({ repositories: repos });
  await app.ready();
});

after(async () => {
  await app.close();
  await fecharBanco();
  await rm(UPLOADS_PATH, { recursive: true, force: true });
});

function login(username: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
}

function register(computerId: string, computerSecret = secret('a')) {
  return app.inject({
    method: 'POST',
    url: '/api/computers/register',
    payload: { computerId, hostname: `HOST-${computerId}`, appVersion: '1.0.0', platform: 'win32', computerSecret },
  });
}

function as(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function sendMessage(payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/messages', headers: as(adminToken), payload });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('saúde e proteção', () => {
  test('GET /api/health é público', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok', service: 'sistema-dp-backend' });
  });

  test('rotas protegidas exigem token', async () => {
    for (const [method, url] of [
      ['GET', '/api/computers'],
      ['GET', '/api/messages'],
      ['POST', '/api/messages'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      assert.equal(res.statusCode, 401, `${method} ${url}`);
    }
  });
});

describe('login do DP', () => {
  test('senha errada → 401; certa → token', async () => {
    assert.equal((await login('admin', 'senha-errada-000')).statusCode, 401);
    const res = await login('admin', PASSWORD);
    assert.equal(res.statusCode, 200);
    adminToken = res.json().token;
    assert.ok(adminToken.length >= 40);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: as(adminToken) });
    assert.equal(me.json().user.name, 'Departamento Pessoal');
  });

  test('bloqueia após 5 tentativas erradas', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await login('fulano', 'errada-123')).statusCode, 401);
    assert.equal((await login('fulano', 'errada-123')).statusCode, 429);
  });
});

describe('registro de computadores', () => {
  test('mesmo PC com outro segredo → 403; com o mesmo segredo → OK', async () => {
    assert.equal((await register('PC-AAAA00000001')).statusCode, 200);
    assert.equal((await register('PC-AAAA00000001', secret('b'))).statusCode, 403);
    assert.equal((await register('PC-AAAA00000001')).statusCode, 200);
  });

  test('DP libera a credencial e o PC registra com segredo novo', async () => {
    const reset = await app.inject({
      method: 'POST',
      url: '/api/computers/PC-AAAA00000001/reset-credential',
      headers: as(adminToken),
    });
    assert.equal(reset.statusCode, 204);
    assert.equal((await register('PC-AAAA00000001', secret('b'))).statusCode, 200);
  });

  test('segredo do PC guardado no formato antigo (scrypt) é aceito e convertido para o rápido', async () => {
    const { hashSecret } = await import('../src/modules/auth/crypto');
    await repos.computers.setSecretHash('PC-AAAA00000001', await hashSecret(secret('b')));
    assert.equal((await register('PC-AAAA00000001', secret('c'))).statusCode, 403); // segredo errado continua recusado
    assert.equal((await register('PC-AAAA00000001', secret('b'))).statusCode, 200);
    assert.match((await repos.computers.getSecretHash('PC-AAAA00000001')) ?? '', /^sha256\$/);
    assert.equal((await register('PC-AAAA00000001', secret('b'))).statusCode, 200);
    assert.equal((await register('PC-AAAA00000001', secret('c'))).statusCode, 403);
  });

  test('IP do aparelho atrás do nginx: lê o encaminhado só quando vem do proxy confiável', async () => {
    const { ipDoAparelho } = await import('../src/realtime/socket-server');
    const pelo = (address: string, headers: Record<string, string> = {}) => ({ address, headers });
    const nginx = '192.168.20.10';

    // Sem TRUST_PROXY: o que chega (era o que acontecia: todo mundo com o IP do nginx)
    assert.equal(ipDoAparelho(pelo(nginx, { 'x-forwarded-for': '192.168.20.55' }), false), nginx);
    // Com o nginx configurado: o IP real do aparelho
    assert.equal(ipDoAparelho(pelo(`::ffff:${nginx}`, { 'x-forwarded-for': '192.168.20.55' }), nginx), '192.168.20.55');
    assert.equal(ipDoAparelho(pelo(nginx, { 'x-real-ip': '192.168.20.56' }), nginx), '192.168.20.56');
    // Aparelho que escreve um X-Forwarded-For falso: vale o que o nginx viu (o último)
    assert.equal(ipDoAparelho(pelo(nginx, { 'x-forwarded-for': '10.9.9.9, 192.168.20.57' }), nginx), '192.168.20.57');
    // Conexão direta (sem passar pelo nginx) não pode escolher o próprio IP pelo cabeçalho
    assert.equal(ipDoAparelho(pelo('192.168.20.58', { 'x-forwarded-for': '1.2.3.4' }), nginx), '192.168.20.58');
    // Sem cabeçalho nenhum, fica o do proxy
    assert.equal(ipDoAparelho(pelo(nginx), nginx), nginx);
  });

  test('celular (CEL-) se registra como os PCs; outros prefixos são recusados', async () => {
    assert.equal((await register('CEL-AAAA00000001')).statusCode, 200);
    assert.equal((await register('TAB-AAAA00000001')).statusCode, 400);
    assert.equal((await register('cel-aaaa00000001')).statusCode, 400);
  });

  test('ao conectar pelo WebSocket, o aparelho fica online com o IP de onde veio', async () => {
    const { io } = await import('socket.io-client');
    const token = (await register('CEL-AAAA00000002')).json().token;
    const endereco = await app.listen({ port: 0, host: '127.0.0.1' });
    const socket = io(endereco, {
      transports: ['websocket'],
      reconnection: false,
      auth: { computerId: 'CEL-AAAA00000002', hostname: 'HOST-CEL', appVersion: '2.0.0', platform: 'android', token },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('session:ready', () => resolve());
        socket.on('connect_error', reject);
      });
      const lista = (await app.inject({ method: 'GET', url: '/api/computers', headers: as(adminToken) })).json().computers;
      const celular = lista.find((c: { computerId: string }) => c.computerId === 'CEL-AAAA00000002');
      assert.equal(celular.status, 'ONLINE');
      assert.equal(celular.ip, '127.0.0.1');
    } finally {
      socket.disconnect();
    }
  });
});

describe('mensagens', () => {
  let tokenA: string;
  let tokenB: string;

  test('"Todos" vale para PCs registrados antes do envio', async () => {
    tokenA = (await register('PC-BBBB00000001')).json().token;
    const sent = await sendMessage({ title: 'Reunião Geral', content: 'Hoje às 16:00.', type: 'COMUNICADO', target: 'ALL' });
    assert.equal(sent.statusCode, 201);
    await sleep(5);
    tokenB = (await register('PC-BBBB00000002')).json().token; // instalado depois do envio

    const listA = (await app.inject({ method: 'GET', url: '/api/messages', headers: as(tokenA) })).json();
    const listB = (await app.inject({ method: 'GET', url: '/api/messages', headers: as(tokenB) })).json();
    assert.ok(listA.messages.some((m: { title: string }) => m.title === 'Reunião Geral'));
    assert.equal(listB.messages.length, 0);
    assert.equal(listB.unreadCount, 0);
  });

  test('mensagem para um computador só é vista por ele', async () => {
    const sent = await sendMessage({
      title: 'Exame Periódico',
      content: 'Agendado.',
      type: 'AVISO',
      target: 'COMPUTER',
      targetId: 'PC-BBBB00000002',
    });
    const id = sent.json().message.id;
    assert.equal((await app.inject({ method: 'GET', url: `/api/messages/${id}`, headers: as(tokenB) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/messages/${id}`, headers: as(tokenA) })).statusCode, 404);
  });

  test('marcar como lida é idempotente e aparece nas estatísticas do DP', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/messages', headers: as(tokenA) })).json();
    const id = list.messages[0].id;
    const first = await app.inject({ method: 'PATCH', url: `/api/messages/${id}/read`, headers: as(tokenA) });
    const second = await app.inject({ method: 'PATCH', url: `/api/messages/${id}/read`, headers: as(tokenA) });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().readAt, second.json().readAt);

    const stats = (await app.inject({ method: 'GET', url: `/api/messages/${id}`, headers: as(adminToken) })).json();
    assert.equal(stats.message.readCount, 1);
    assert.ok(stats.message.recipientCount >= 1);
  });

  test('validação de entrada', async () => {
    assert.equal((await sendMessage({ title: 'X', content: 'Y', type: 'PROMOCAO' })).statusCode, 400);
    assert.equal((await sendMessage({ title: '   ', content: 'Y', type: 'AVISO' })).statusCode, 400);
    assert.equal((await sendMessage({ title: 'X', content: 'Y', type: 'AVISO', target: 'COMPUTER' })).statusCode, 400);
    const unknownPc = await sendMessage({ title: 'X', content: 'Y', type: 'AVISO', target: 'COMPUTER', targetId: 'PC-FFFF99999999' });
    assert.equal(unknownPc.statusCode, 404);
  });

  test('computador não gerencia funcionários', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/employees', headers: as(tokenA) });
    assert.equal(res.statusCode, 403);
  });

  test('DP não marca leitura; computador não envia mensagem', async () => {
    assert.equal(
      (await app.inject({ method: 'PATCH', url: '/api/messages/MSG-000001/read', headers: as(adminToken) })).statusCode,
      403,
    );
    const pcSend = await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: as(tokenA),
      payload: { title: 'X', content: 'Y', type: 'AVISO' },
    });
    assert.equal(pcSend.statusCode, 403);
  });
});

describe('funcionários e login no app', () => {
  let pcToken: string;
  let otherPcToken: string;
  let mariaId: string;

  function employeeRequest(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
    return app.inject({ method, url, headers: as(token), payload });
  }

  test('DP cria setores; nome repetido (mesmo com outra grafia) → 409', async () => {
    for (const name of ['Produção', 'Expedição', 'Manutenção']) {
      assert.equal((await employeeRequest('POST', '/api/sectors', adminToken, { name })).statusCode, 201);
    }
    assert.equal((await employeeRequest('POST', '/api/sectors', adminToken, { name: 'producao' })).statusCode, 409);
    const unknown = await employeeRequest('POST', '/api/employees', adminToken, {
      name: 'Sem Setor Válido',
      registration: '2999',
      sector: 'Inexistente',
      password: 'Senha-Qualquer-1',
    });
    assert.equal(unknown.statusCode, 400);
  });

  test('DP cadastra funcionários; usuário repetido → 409', async () => {
    const maria = await employeeRequest('POST', '/api/employees', adminToken, {
      name: 'Maria Souza',
      registration: '2001',
      sector: 'Produção',
      shift: 'Manhã',
      password: 'Senha-Maria-2001',
    });
    assert.equal(maria.statusCode, 201);
    mariaId = maria.json().employee.id;
    assert.equal(maria.json().employee.mustChangePassword, false); // troca de senha é opcional
    assert.equal(maria.json().employee.sector, 'Produção');
    await employeeRequest('POST', '/api/employees', adminToken, {
      name: 'João Lima',
      registration: '2002',
      sector: 'Expedição',
      shift: 'Tarde',
      password: 'Senha-Joao-2002',
    });
    const dup = await employeeRequest('POST', '/api/employees', adminToken, { name: 'X', registration: '2001', password: 'qualquer-123' });
    assert.equal(dup.statusCode, 409);
    const list = (await employeeRequest('GET', '/api/employees', adminToken)).json();
    assert.equal(list.employees.length, 2);
  });

  test('login no app: senha errada → 401; certa → vincula ao PC', async () => {
    pcToken = (await register('PC-CCCC00000001')).json().token;
    otherPcToken = (await register('PC-CCCC00000002')).json().token;
    const wrong = await employeeRequest('POST', '/api/session/login', pcToken, { registration: '2001', password: 'errada-000' });
    assert.equal(wrong.statusCode, 401);
    const ok = await employeeRequest('POST', '/api/session/login', pcToken, { registration: '2001', password: 'Senha-Maria-2001' });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().employee.name, 'Maria Souza');
    assert.equal(ok.json().employee.mustChangePassword, false);
    const session = (await employeeRequest('GET', '/api/session', pcToken)).json();
    assert.equal(session.employee.registration, '2001');
    const computers = (await employeeRequest('GET', '/api/computers', adminToken)).json().computers;
    assert.equal(computers.find((c: { computerId: string }) => c.computerId === 'PC-CCCC00000001').currentUserId, mariaId);
  });

  test('comunicado para uma pessoa só chega para ela', async () => {
    const individual = await sendMessage({ title: 'Para Maria', content: 'Individual.', type: 'AVISO', target: 'EMPLOYEE', targetId: mariaId });
    assert.equal(individual.statusCode, 201);

    const semNinguem = await sendMessage({ title: 'X', content: 'Y', type: 'AVISO', target: 'EMPLOYEE', targetId: 'USR-nao-existe' });
    assert.equal(semNinguem.statusCode, 404);

    const daMaria = (await employeeRequest('GET', '/api/messages', pcToken)).json().messages.map((m: { title: string }) => m.title);
    assert.ok(daMaria.includes('Para Maria'));
    const semLogin = (await employeeRequest('GET', '/api/messages', otherPcToken)).json().messages.map((m: { title: string }) => m.title);
    assert.ok(!semLogin.includes('Para Maria'));
  });

  test('comunicados para setor e turno chegam só para quem é destinatário', async () => {
    await sendMessage({ title: 'Para Produção', content: 'Setor.', type: 'COMUNICADO', target: 'SECTOR', targetId: 'Produção' });
    await sendMessage({ title: 'Para Tarde', content: 'Turno.', type: 'INFORMATIVO', target: 'SHIFT', targetId: 'Tarde' });
    const unknownSector = await sendMessage({ title: 'X', content: 'Y', type: 'AVISO', target: 'SECTOR', targetId: 'Inexistente' });
    assert.equal(unknownSector.statusCode, 404);

    const titles = async (token: string) =>
      (await employeeRequest('GET', '/api/messages', token)).json().messages.map((m: { title: string }) => m.title);
    const maria = await titles(pcToken);
    assert.ok(maria.includes('Para Produção'));
    assert.ok(!maria.includes('Para Tarde'));
    const noLogin = await titles(otherPcToken);
    assert.ok(!noLogin.includes('Para Produção'));
  });

  test('leitura com funcionário logado é da pessoa, não do PC', async () => {
    const list = (await employeeRequest('GET', '/api/messages', pcToken)).json();
    const target = list.messages.find((m: { title: string }) => m.title === 'Para Produção');
    await app.inject({ method: 'PATCH', url: `/api/messages/${target.id}/read`, headers: as(pcToken) });

    // Maria entra em outro PC: a mensagem já aparece como lida
    await employeeRequest('POST', '/api/session/login', otherPcToken, { registration: '2001', password: 'Senha-Maria-2001' });
    const elsewhere = (await employeeRequest('GET', '/api/messages', otherPcToken)).json();
    assert.equal(elsewhere.messages.find((m: { id: string }) => m.id === target.id).read, true);
  });

  test('DP vê quem leu (funcionário e PC em que leu) e quem ainda não leu', async () => {
    const all = (await employeeRequest('GET', '/api/messages', adminToken)).json().messages;
    const forSector = all.find((m: { title: string }) => m.title === 'Para Produção');
    const reads = (await employeeRequest('GET', `/api/messages/${forSector.id}/reads`, adminToken)).json();
    assert.equal(reads.reads.length, 1);
    assert.equal(reads.reads[0].type, 'EMPLOYEE');
    assert.equal(reads.reads[0].name, 'Maria Souza');
    assert.equal(reads.reads[0].computer, 'HOST-PC-CCCC00000001');
    assert.deepEqual(reads.pending, []);

    // Outro comunicado para o setor que ninguém leu: Maria aparece como pendente
    const unread = (await sendMessage({ title: 'Produção 2', content: 'Setor.', type: 'AVISO', target: 'SECTOR', targetId: 'Produção' })).json();
    const sectorReads = (await employeeRequest('GET', `/api/messages/${unread.message.id}/reads`, adminToken)).json();
    assert.equal(sectorReads.reads.length, 0);
    assert.ok(sectorReads.pending.some((p: { name: string }) => p.name === 'Maria Souza'));
    const forMaria = forSector;

    // Mensagem para Todos lida por um PC sem funcionário logado
    const general = all.find((m: { title: string }) => m.title === 'Reunião Geral');
    const generalReads = (await employeeRequest('GET', `/api/messages/${general.id}/reads`, adminToken)).json();
    assert.ok(generalReads.reads.some((r: { type: string; name: string }) => r.type === 'COMPUTER' && r.name === 'HOST-PC-BBBB00000001'));
    assert.equal(generalReads.pending, null);

    // Só o DP pode ver
    assert.equal((await employeeRequest('GET', `/api/messages/${forMaria.id}/reads`, pcToken)).statusCode, 403);
  });

  test('comunicado que pede ciência: só a pessoa confirma e o DP acompanha', async () => {
    const enviado = (
      await sendMessage({
        title: 'Norma nova',
        content: 'Leia com atenção.',
        type: 'COMUNICADO',
        target: 'EMPLOYEE',
        targetId: mariaId,
        exigeCiencia: true,
      })
    ).json();
    const id = enviado.message.id;
    assert.equal(enviado.message.exigeCiencia, true);

    const antes = (await employeeRequest('GET', '/api/messages', pcToken)).json().messages.find((m: { id: string }) => m.id === id);
    assert.equal(antes.exigeCiencia, true);
    assert.equal(antes.cienteEm, null);

    const ciencia = await app.inject({ method: 'POST', url: `/api/messages/${id}/ciencia`, headers: as(pcToken) });
    assert.equal(ciencia.statusCode, 200);
    assert.ok(ciencia.json().cienteEm);

    // Confirmar vale como leitura e não muda se clicar de novo
    const depois = (await employeeRequest('GET', '/api/messages', pcToken)).json().messages.find((m: { id: string }) => m.id === id);
    assert.equal(depois.read, true);
    assert.equal(depois.cienteEm, ciencia.json().cienteEm);
    const outraVez = await app.inject({ method: 'POST', url: `/api/messages/${id}/ciencia`, headers: as(pcToken) });
    assert.equal(outraVez.json().cienteEm, ciencia.json().cienteEm);

    const reads = (await employeeRequest('GET', `/api/messages/${id}/reads`, adminToken)).json();
    assert.equal(reads.reads[0].name, 'Maria Souza');
    assert.equal(reads.reads[0].cienteEm, ciencia.json().cienteEm);

    // PC sem ninguém logado não responde por ninguém
    const pcSozinho = (await register('PC-CCCC00000003')).json().token;
    const semGente = await app.inject({ method: 'POST', url: `/api/messages/${id}/ciencia`, headers: as(pcSozinho) });
    assert.equal(semGente.statusCode, 401);

    // Comunicado que não pede ciência recusa a confirmação
    const simples = (await sendMessage({ title: 'Sem ciência', content: 'Só aviso.', type: 'AVISO', target: 'EMPLOYEE', targetId: mariaId })).json();
    const recusa = await app.inject({ method: 'POST', url: `/api/messages/${simples.message.id}/ciencia`, headers: as(pcToken) });
    assert.equal(recusa.statusCode, 400);
  });

  test('DP avisa quem ainda não leu o comunicado', async () => {
    const pendente = (
      await sendMessage({ title: 'Escala de sábado', content: 'Confira.', type: 'COMUNICADO', target: 'SECTOR', targetId: 'Produção' })
    ).json();
    const id = pendente.message.id;

    const aviso = await app.inject({ method: 'POST', url: `/api/messages/${id}/avisar-pendentes`, headers: as(adminToken) });
    assert.equal(aviso.statusCode, 200);
    assert.equal(aviso.json().avisados, 1);

    // Depois que a pessoa lê, não há mais quem lembrar
    await app.inject({ method: 'PATCH', url: `/api/messages/${id}/read`, headers: as(pcToken) });
    const semNinguem = await app.inject({ method: 'POST', url: `/api/messages/${id}/avisar-pendentes`, headers: as(adminToken) });
    assert.equal(semNinguem.json().avisados, 0);

    // Só o DP pode cutucar
    assert.equal((await app.inject({ method: 'POST', url: `/api/messages/${id}/avisar-pendentes`, headers: as(pcToken) })).statusCode, 403);
  });

  test('no comunicado com ciência, o lembrete também vai para quem leu e não confirmou', async () => {
    const enviado = (
      await sendMessage({
        title: 'Uso do EPI',
        content: 'Confirme a leitura.',
        type: 'COMUNICADO',
        target: 'EMPLOYEE',
        targetId: mariaId,
        exigeCiencia: true,
      })
    ).json();
    const id = enviado.message.id;

    // Maria abre (conta como leitura), mas não confirma
    await app.inject({ method: 'PATCH', url: `/api/messages/${id}/read`, headers: as(pcToken) });
    const reads = (await employeeRequest('GET', `/api/messages/${id}/reads`, adminToken)).json();
    assert.deepEqual(reads.pending, []);
    assert.equal(reads.reads[0].cienteEm, null);

    const aviso = await app.inject({ method: 'POST', url: `/api/messages/${id}/avisar-pendentes`, headers: as(adminToken) });
    assert.equal(aviso.json().avisados, 1);

    // Depois de confirmar, não há mais quem lembrar
    await app.inject({ method: 'POST', url: `/api/messages/${id}/ciencia`, headers: as(pcToken) });
    const depois = await app.inject({ method: 'POST', url: `/api/messages/${id}/avisar-pendentes`, headers: as(adminToken) });
    assert.equal(depois.json().avisados, 0);
  });

  test('troca de senha pelo funcionário e logout', async () => {
    const wrong = await employeeRequest('POST', '/api/session/password', pcToken, { currentPassword: 'errada-000', newPassword: 'Nova-Senha-123' });
    assert.equal(wrong.statusCode, 401);
    const ok = await employeeRequest('POST', '/api/session/password', pcToken, {
      currentPassword: 'Senha-Maria-2001',
      newPassword: 'Nova-Senha-123',
    });
    assert.equal(ok.statusCode, 204);
    // Troca feita: a flag some e as sessões em outros PCs são encerradas
    assert.equal((await employeeRequest('GET', '/api/session', pcToken)).json().employee.mustChangePassword, false);
    assert.equal((await employeeRequest('GET', '/api/session', otherPcToken)).json().employee, null);
    assert.equal((await employeeRequest('POST', '/api/session/logout', pcToken)).statusCode, 204);
    assert.equal((await employeeRequest('GET', '/api/session', pcToken)).json().employee, null);
    const relogin = await employeeRequest('POST', '/api/session/login', pcToken, { registration: '2001', password: 'Nova-Senha-123' });
    assert.equal(relogin.statusCode, 200);
  });

  test('setor com outra grafia reaproveita o cadastrado', async () => {
    const res = await employeeRequest('POST', '/api/employees', adminToken, {
      name: 'Carla Dias',
      registration: '2003',
      sector: '  PRODUÇÃO ',
      password: 'Senha-Carla-2003',
    });
    assert.equal(res.json().employee.sector, 'Produção');
  });

  test('DP redefine a senha: encerra sessões; troca depois é opcional', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/employees/${mariaId}/password`,
      headers: as(adminToken),
      payload: { password: 'Redefinida-123' },
    });
    assert.equal(res.statusCode, 204);
    assert.equal((await employeeRequest('GET', '/api/session', pcToken)).json().employee, null);
    const login = await employeeRequest('POST', '/api/session/login', pcToken, { registration: '2001', password: 'Redefinida-123' });
    assert.equal(login.json().employee.mustChangePassword, false);
  });

  test('usuário atacado de vários PCs é bloqueado', async () => {
    const tokens: string[] = [];
    for (let i = 1; i <= 4; i++) tokens.push((await register(`PC-DDDD0000000${i}`)).json().token);
    // 10 erros espalhados em 3 PCs (menos de 5 por PC) para um usuário
    for (let i = 0; i < 10; i++) {
      await employeeRequest('POST', '/api/session/login', tokens[i % 3], { registration: '9999', password: `errada-${i}-000` });
    }
    const blocked = await employeeRequest('POST', '/api/session/login', tokens[3], { registration: '9999', password: 'qualquer-000' });
    assert.equal(blocked.statusCode, 429);
  });

  test('funcionário desativado sai dos PCs e não entra mais', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/employees/${mariaId}`,
      headers: as(adminToken),
      payload: { status: 'INACTIVE' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal((await employeeRequest('GET', '/api/session', pcToken)).json().employee, null);
    const login = await employeeRequest('POST', '/api/session/login', pcToken, { registration: '2001', password: 'Redefinida-123' });
    assert.equal(login.statusCode, 401);
  });

  test('DP altera o usuário; usuário de outro → 409', async () => {
    const joao = (await employeeRequest('GET', '/api/employees', adminToken)).json().employees.find(
      (e: { registration: string }) => e.registration === '2002',
    );
    const dup = await app.inject({ method: 'PATCH', url: `/api/employees/${joao.id}`, headers: as(adminToken), payload: { registration: '2003' } });
    assert.equal(dup.statusCode, 409);
    const ok = await app.inject({ method: 'PATCH', url: `/api/employees/${joao.id}`, headers: as(adminToken), payload: { registration: '2102' } });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().employee.registration, '2102');
    const login = await employeeRequest('POST', '/api/session/login', otherPcToken, { registration: '2102', password: 'Senha-Joao-2002' });
    assert.equal(login.statusCode, 200);
    const oldLogin = await employeeRequest('POST', '/api/session/login', pcToken, { registration: '2002', password: 'Senha-Joao-2002' });
    assert.equal(oldLogin.statusCode, 401);
  });

  test('renomear setor atualiza funcionários e mensagens do setor', async () => {
    const sectors = (await employeeRequest('GET', '/api/sectors', adminToken)).json().sectors;
    const expedicao = sectors.find((s: { name: string }) => s.name === 'Expedição');
    assert.equal(expedicao.employeeCount, 1);
    await sendMessage({ title: 'Para a Expedição', content: 'Setor.', type: 'AVISO', target: 'SECTOR', targetId: 'Expedição' });

    const res = await app.inject({ method: 'PATCH', url: `/api/sectors/${expedicao.id}`, headers: as(adminToken), payload: { name: 'Logística' } });
    assert.equal(res.statusCode, 200);
    const joao = (await employeeRequest('GET', '/api/employees', adminToken)).json().employees.find(
      (e: { registration: string }) => e.registration === '2102',
    );
    assert.equal(joao.sector, 'Logística');
    // João (logado no otherPc) continua vendo a mensagem enviada antes da troca de nome
    const titles = (await employeeRequest('GET', '/api/messages', otherPcToken)).json().messages.map((m: { title: string }) => m.title);
    assert.ok(titles.includes('Para a Expedição'));
  });

  test('excluir setor: com funcionários → 409; vazio → 204', async () => {
    const sectors = (await employeeRequest('GET', '/api/sectors', adminToken)).json().sectors;
    const logistica = sectors.find((s: { name: string }) => s.name === 'Logística');
    const manutencao = sectors.find((s: { name: string }) => s.name === 'Manutenção');
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/sectors/${logistica.id}`, headers: as(adminToken) })).statusCode, 409);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/sectors/${manutencao.id}`, headers: as(adminToken) })).statusCode, 204);
  });

  test('excluir funcionário: sai dos PCs, não entra mais e continua em "quem leu"', async () => {
    const joao = (await employeeRequest('GET', '/api/employees', adminToken)).json().employees.find(
      (e: { registration: string }) => e.registration === '2102',
    );
    // João (logado no otherPc) lê um comunicado antes de ser excluído
    const read = (await employeeRequest('GET', '/api/messages', otherPcToken)).json().messages.find(
      (m: { title: string }) => m.title === 'Para a Expedição',
    );
    await app.inject({ method: 'PATCH', url: `/api/messages/${read.id}/read`, headers: as(otherPcToken) });

    const res = await app.inject({ method: 'DELETE', url: `/api/employees/${joao.id}`, headers: as(adminToken) });
    assert.equal(res.statusCode, 204);
    const reads = (await employeeRequest('GET', `/api/messages/${read.id}/reads`, adminToken)).json().reads;
    assert.ok(reads.some((r: { type: string; name: string }) => r.type === 'REMOVED' && r.name === 'João Lima (excluído)'));
    assert.equal((await employeeRequest('GET', '/api/session', otherPcToken)).json().employee, null);
    const login = await employeeRequest('POST', '/api/session/login', otherPcToken, { registration: '2102', password: 'Senha-Joao-2002' });
    assert.equal(login.statusCode, 401);
    const list = (await employeeRequest('GET', '/api/employees', adminToken)).json().employees;
    assert.ok(!list.some((e: { id: string }) => e.id === joao.id));
  });
});

describe('resposta automática por setor', () => {
  let pc: string;
  let fabricio: { id: string; token: string };
  let andressa: { id: string; token: string };

  function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string, payload?: object) {
    return app.inject({ method, url, headers: as(token), payload });
  }

  /** Pessoa do DP com login próprio (criada direto no banco, como o script create-admin) */
  async function createDpUser(username: string, name: string) {
    const { hashSecret } = await import('../src/modules/auth/crypto');
    const password = `Senha-${username}-123`;
    const user = await repos.users.create(
      {
        username,
        name,
        registration: null,
        sector: 'Departamento Pessoal',
        shift: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        chatContact: true,
        superAdmin: false,
        passwordHash: await hashSecret(password),
      },
      new Date(),
    );
    return { id: user.id, token: (await login(username, password)).json().token as string };
  }

  /** Conversa direta do funcionário do PC com a pessoa do DP */
  async function conversaCom(dpId: string): Promise<string> {
    return (await call('POST', '/api/conversas/direta', pc, { comUsuarioId: dpId })).json().id;
  }

  async function escrever(dpId: string, conteudo: string) {
    return call('POST', `/api/conversas/${await conversaCom(dpId)}/mensagens`, pc, { conteudo });
  }

  const thread = async (dpId: string) =>
    (await call('GET', `/api/conversas/${await conversaCom(dpId)}/mensagens`, pc)).json().mensagens as Array<{
      autorId: string;
      conteudo: string;
      automatica: boolean;
    }>;

  test('validação e acesso', async () => {
    fabricio = await createDpUser('fabricio', 'Fabricio (DP)');
    andressa = await createDpUser('andressa', 'Andressa (DP)');
    await call('POST', '/api/employees', adminToken, {
      name: 'Diego Ramos',
      registration: '2004',
      sector: 'Produção',
      password: 'Senha-Diego-2004',
    });
    pc = (await register('PC-FFFF00000001')).json().token;
    await call('POST', '/api/session/login', pc, { registration: '2004', password: 'Senha-Diego-2004' });

    assert.equal((await call('GET', '/api/auto-replies', pc)).statusCode, 403);
    assert.equal((await call('POST', '/api/auto-replies', fabricio.token, { sector: null, content: '   ', active: true })).statusCode, 400);
    const unknown = await call('POST', '/api/auto-replies', fabricio.token, { sector: 'Setor Fantasma', content: 'Oi', active: true });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().error, 'SECTOR_NOT_FOUND');
  });

  test('cada pessoa do DP tem as próprias respostas, uma por setor', async () => {
    const byDefault = await call('POST', '/api/auto-replies', fabricio.token, {
      sector: null,
      content: 'Resposta padrão do Fabricio',
      active: true,
    });
    assert.equal(byDefault.statusCode, 201);
    const production = await call('POST', '/api/auto-replies', fabricio.token, {
      sector: 'produção', // grafia é corrigida para a cadastrada
      content: 'Oi, {primeiro_nome} ({setor})! Aqui é o {nome_dp}, respondo logo.',
      active: true,
    });
    assert.equal(production.statusCode, 201);
    assert.equal(production.json().rule.sector, 'Produção');

    const duplicate = await call('POST', '/api/auto-replies', fabricio.token, { sector: 'Produção', content: 'x', active: true });
    assert.equal(duplicate.statusCode, 409);

    const list = (await call('GET', '/api/auto-replies', fabricio.token)).json().rules;
    assert.deepEqual(list.map((r: { sector: string | null }) => r.sector), [null, 'Produção']);
    assert.equal((await call('GET', '/api/auto-replies', andressa.token)).json().rules.length, 0);
    // Outra pessoa do DP não altera nem exclui a resposta do Fabricio
    const id = production.json().rule.id;
    assert.equal((await call('PUT', `/api/auto-replies/${id}`, andressa.token, { sector: null, content: 'x', active: true })).statusCode, 404);
    assert.equal((await call('DELETE', `/api/auto-replies/${id}`, andressa.token)).statusCode, 404);
  });

  test('funcionário recebe a resposta do setor dele; não repete dentro do intervalo; conversa segue não lida', async () => {
    assert.equal((await escrever(fabricio.id, 'Fabricio, dúvida no ponto')).statusCode, 201);
    let messages = await thread(fabricio.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].autorId, fabricio.id);
    assert.equal(messages[1].automatica, true);
    assert.equal(messages[1].conteudo, 'Oi, Diego (Produção)! Aqui é o Fabricio, respondo logo.');

    await escrever(fabricio.id, 'Mais uma coisa');
    messages = await thread(fabricio.id);
    assert.equal(messages.length, 3); // sem nova resposta automática
    const conversaId = await conversaCom(fabricio.id);
    const doFabricio = (await call('GET', '/api/conversas', fabricio.token)).json().conversas.find(
      (c: { id: string }) => c.id === conversaId,
    );
    assert.equal(doFabricio.naoLidas, 2);
  });

  test('resposta do setor pausada → usa a de todos os setores; sem nenhuma → não responde', async () => {
    await call('POST', '/api/auto-replies', andressa.token, { sector: null, content: 'Padrão da Andressa, {funcionario}', active: true });
    const paused = await call('POST', '/api/auto-replies', andressa.token, { sector: 'Produção', content: 'Produção', active: false });
    assert.equal(paused.json().rule.active, false);
    await escrever(andressa.id, 'Oi Andressa');
    const messages = await thread(andressa.id);
    assert.equal(messages.at(-1)?.conteudo, 'Padrão da Andressa, Diego Ramos');

    // O TI não configurou nada: não responde
    const adminId = (await call('GET', '/api/auth/me', adminToken)).json().user.id;
    await escrever(adminId, 'Oi TI');
    assert.equal((await thread(adminId)).length, 1);
  });

  test('editar e excluir', async () => {
    const [rule] = (await call('GET', '/api/auto-replies', andressa.token)).json().rules;
    const edited = await call('PUT', `/api/auto-replies/${rule.id}`, andressa.token, { sector: null, content: 'Texto novo', active: false });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().rule.content, 'Texto novo');
    assert.equal(edited.json().rule.active, false);
    assert.equal((await call('DELETE', `/api/auto-replies/${rule.id}`, andressa.token)).statusCode, 204);
    assert.equal((await call('GET', '/api/auto-replies', andressa.token)).json().rules.length, 1);
  });
});

describe('conta do TI: poderes extras na Central', () => {
  let dpToken: string; // pessoa comum do DP (sem poderes extras)
  let dpUserId: string;
  let novoLoginId: string;

  function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) {
    return app.inject({ method, url, headers: as(token), payload });
  }

  test('o login semeado é do TI; quem é do DP recebe 403', async () => {
    const me = (await call('GET', '/api/auth/me', adminToken)).json().user;
    assert.equal(me.superAdmin, true);

    const { hashSecret } = await import('../src/modules/auth/crypto');
    const dp = await repos.users.create(
      {
        username: 'roberta',
        name: 'Roberta (DP)',
        registration: null,
        sector: 'Departamento Pessoal',
        shift: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        chatContact: true,
        superAdmin: false,
        passwordHash: await hashSecret('Senha-Roberta-123'),
      },
      new Date(),
    );
    dpUserId = dp.id;
    dpToken = (await login('roberta', 'Senha-Roberta-123')).json().token;

    assert.equal((await call('GET', '/api/auth/me', dpToken)).json().user.superAdmin, false);
    assert.equal((await call('GET', '/api/admin/users', dpToken)).statusCode, 403);
    assert.equal((await call('GET', '/api/admin/chats', dpToken)).statusCode, 403);
    assert.equal((await call('POST', '/api/admin/messages/purge', dpToken, { olderThanDays: 0 })).statusCode, 403);
  });

  test('TI apaga um comunicado e limpa os antigos', async () => {
    const sent = await sendMessage({ title: 'Para apagar', content: 'Some daqui.', type: 'COMUNICADO', target: 'ALL' });
    const id = sent.json().message.id;
    assert.equal((await call('DELETE', `/api/admin/messages/${id}`, adminToken)).statusCode, 204);
    assert.equal((await call('GET', `/api/messages/${id}`, adminToken)).statusCode, 404);
    assert.equal((await call('DELETE', `/api/admin/messages/${id}`, adminToken)).statusCode, 404); // já não existe

    const antes = (await call('GET', '/api/messages?limit=500', adminToken)).json().messages.length;
    assert.ok(antes > 0);
    const purge = await call('POST', '/api/admin/messages/purge', adminToken, { olderThanDays: null });
    assert.equal(purge.statusCode, 200);
    assert.equal(purge.json().removed, antes);
    assert.equal((await call('GET', '/api/messages?limit=500', adminToken)).json().messages.length, 0);
  });

  test('a limpeza avisa os aparelhos conectados, para a tela não mostrar o apagado', async () => {
    const { io } = await import('socket.io-client');
    const token = (await register('PC-AAAA0000CAFE')).json().token;
    // O servidor já está escutando (teste do WebSocket lá em cima)
    const { port } = app.server.address() as { port: number };
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      auth: { computerId: 'PC-AAAA0000CAFE', hostname: 'HOST-LIMPEZA', appVersion: '1.34.0', platform: 'win32', token },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('session:ready', () => resolve());
        socket.on('connect_error', reject);
      });
      await sendMessage({ title: 'Some já', content: 'x', type: 'COMUNICADO', target: 'ALL' });
      const aviso = new Promise<unknown>((resolve) => socket.on('dados:limpos', resolve));
      assert.equal((await call('POST', '/api/admin/messages/purge', adminToken, { olderThanDays: null })).statusCode, 200);
      assert.deepEqual(await aviso, { o: 'comunicados' });
    } finally {
      socket.disconnect();
    }
  });

  test('TI vê só os números das conversas e pode apagá-las', async () => {
    const summary = (await call('GET', '/api/admin/chats', adminToken)).json().summary;
    const comConversa = summary.find((s: { messages: number }) => s.messages > 0);
    assert.ok(comConversa, 'esperava conversas criadas nos testes anteriores');
    assert.equal(JSON.stringify(summary).includes('content'), false); // nunca devolve o conteúdo

    const removed = (await call('POST', '/api/admin/chats/purge', adminToken, { dpUserId: comConversa.dpUserId })).json().removed;
    assert.ok(removed > 0);
    const depois = (await call('GET', '/api/admin/chats', adminToken)).json().summary.find(
      (s: { dpUserId: string }) => s.dpUserId === comConversa.dpUserId,
    );
    assert.equal(depois.messages, 0);
    assert.equal(depois.conversations, 0);
  });

  test('TI cria, desativa e redefine a senha de um login do DP', async () => {
    const criado = await call('POST', '/api/admin/users', adminToken, {
      username: 'marcia',
      name: 'Marcia (DP)',
      password: 'Senha-Marcia-123',
      chatContact: true,
    });
    assert.equal(criado.statusCode, 201);
    novoLoginId = criado.json().user.id;
    assert.equal(criado.json().user.superAdmin, false);
    assert.equal((await login('marcia', 'Senha-Marcia-123')).statusCode, 200);
    assert.equal((await call('POST', '/api/admin/users', adminToken, { username: 'marcia', name: 'X', password: 'Senha-Marcia-123' })).statusCode, 409);

    assert.equal((await call('POST', `/api/admin/users/${novoLoginId}/password`, adminToken, { password: 'Outra-Senha-456' })).statusCode, 204);
    assert.equal((await login('marcia', 'Senha-Marcia-123')).statusCode, 401);
    assert.equal((await login('marcia', 'Outra-Senha-456')).statusCode, 200);

    assert.equal((await call('PATCH', `/api/admin/users/${novoLoginId}`, adminToken, { status: 'INACTIVE' })).statusCode, 204);
    assert.equal((await login('marcia', 'Outra-Senha-456')).statusCode, 401); // desativado não entra
    assert.equal((await call('PATCH', `/api/admin/users/${novoLoginId}`, adminToken, { status: 'ACTIVE' })).statusCode, 204);
    assert.equal((await login('marcia', 'Outra-Senha-456')).statusCode, 200);
  });

  test('TI exclui um login do DP e o nome fica livre para um funcionário', async () => {
    const criado = await call('POST', '/api/admin/users', adminToken, {
      username: 'renata',
      name: 'Renata (DP)',
      password: 'Senha-Renata-123',
    });
    const id = criado.json().user.id;
    const sessao = (await login('renata', 'Senha-Renata-123')).json().token;

    assert.equal((await call('DELETE', `/api/admin/users/${id}`, dpToken)).statusCode, 403);
    assert.equal((await call('DELETE', `/api/admin/users/${id}`, adminToken)).statusCode, 204);
    assert.equal((await call('GET', '/api/auth/me', sessao)).statusCode, 401); // sessão aberta cai
    assert.equal((await login('renata', 'Senha-Renata-123')).statusCode, 401);
    assert.equal((await call('DELETE', `/api/admin/users/${id}`, adminToken)).statusCode, 404);

    const funcionario = await call('POST', '/api/employees', adminToken, {
      name: 'Renata',
      registration: 'renata',
      sector: 'Produção',
      password: 'Senha-Renata-456',
    });
    assert.equal(funcionario.statusCode, 201);
    await call('DELETE', `/api/employees/${funcionario.json().employee.id}`, adminToken);
  });

  test('TI não altera a própria conta nem outra conta de TI por essas rotas', async () => {
    const meuId = (await call('GET', '/api/auth/me', adminToken)).json().user.id;
    assert.equal((await call('PATCH', `/api/admin/users/${meuId}`, adminToken, { status: 'INACTIVE' })).statusCode, 400);
    assert.equal((await call('POST', `/api/admin/users/${meuId}/password`, adminToken, { password: 'Qualquer-Senha-1' })).statusCode, 400);
    assert.equal((await call('DELETE', `/api/admin/users/${meuId}`, adminToken)).statusCode, 400);
    // A pessoa comum do DP continua podendo ser gerenciada
    assert.equal((await call('PATCH', `/api/admin/users/${dpUserId}`, adminToken, { status: 'INACTIVE' })).statusCode, 204);
    assert.equal((await call('PATCH', `/api/admin/users/${dpUserId}`, adminToken, { status: 'ACTIVE' })).statusCode, 204);
  });
});

describe('anexos nos comunicados', () => {
  // Cabeçalho PNG + um pouco de conteúdo: basta para a conferência de assinatura
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(32, 1)]);
  let pcToken: string;
  let outroToken: string;

  function upload(content: Buffer, name: string, type: string, token = adminToken) {
    return app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { ...as(token), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), 'x-file-type': type },
      payload: content,
    });
  }

  test('só o DP envia arquivo, e só dos tipos permitidos', async () => {
    pcToken = (await register('PC-DDDD00000001')).json().token;
    assert.equal((await upload(png, 'foto.png', 'image/png', pcToken)).statusCode, 403);
    assert.equal((await upload(Buffer.from('MZ...'), 'virus.exe', 'application/x-msdownload')).statusCode, 415);
    // extensão permitida, conteúdo de outro formato
    assert.equal((await upload(Buffer.from('MZ...'), 'falso.png', 'image/png')).statusCode, 400);
    assert.equal((await upload(Buffer.alloc(0), 'vazio.pdf', 'application/pdf')).statusCode, 400);
  });

  test('imagem grande é aceita como anexo; documento grande não', async () => {
    const imagemGrande = Buffer.concat([png, Buffer.alloc(12 * 1024 * 1024, 5)]);
    const imagem = await upload(imagemGrande, 'planta.png', 'image/png');
    assert.equal(imagem.statusCode, 201);
    assert.equal(imagem.json().attachment.size, imagemGrande.length);

    const docGrande = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(11 * 1024 * 1024, 1)]);
    assert.equal((await upload(docGrande, 'manual.pdf', 'application/pdf')).statusCode, 413);

    // A imagem não entra na soma dos anexos do comunicado (só os documentos)
    const enviado = await sendMessage({
      title: 'Planta do galpão',
      content: 'Segue a imagem.',
      type: 'COMUNICADO',
      target: 'COMPUTER',
      targetId: 'PC-DDDD00000001',
      attachmentIds: [imagem.json().attachment.id],
    });
    assert.equal(enviado.statusCode, 201);
  });

  test('comunicado com imagem e arquivo chega para o destinatário', async () => {
    const image = (await upload(png, 'Escala de férias.png', 'image/png')).json().attachment;
    const doc = (await upload(pdf, 'Escala.pdf', 'application/pdf')).json().attachment;
    assert.equal(image.kind, 'IMAGE');
    assert.equal(doc.kind, 'FILE');
    assert.equal(image.name, 'Escala de férias.png');

    const sent = await sendMessage({
      title: 'Escala de férias',
      content: 'Segue em anexo.',
      type: 'COMUNICADO',
      target: 'COMPUTER',
      targetId: 'PC-DDDD00000001',
      attachmentIds: [image.id, doc.id],
    });
    assert.equal(sent.statusCode, 201);
    assert.deepEqual(
      sent.json().message.attachments.map((a: { name: string }) => a.name),
      ['Escala de férias.png', 'Escala.pdf'],
    );

    const inbox = (await app.inject({ method: 'GET', url: '/api/messages', headers: as(pcToken) })).json();
    const received = inbox.messages.find((m: { title: string }) => m.title === 'Escala de férias');
    assert.equal(received.attachments.length, 2);

    const file = await app.inject({ method: 'GET', url: `/api/attachments/${image.id}`, headers: as(pcToken) });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.ok(png.equals(file.rawPayload));
  });

  test('computador que não é destinatário não baixa o anexo', async () => {
    outroToken = (await register('PC-DDDD00000002')).json().token;
    const image = (await upload(png, 'Interno.png', 'image/png')).json().attachment;
    const sent = await sendMessage({
      title: 'Só para o PC 1',
      content: 'Confidencial.',
      type: 'AVISO',
      target: 'COMPUTER',
      targetId: 'PC-DDDD00000001',
      attachmentIds: [image.id],
    });
    assert.equal(sent.statusCode, 201);
    assert.equal((await app.inject({ method: 'GET', url: `/api/attachments/${image.id}`, headers: as(outroToken) })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/api/attachments/${image.id}` })).statusCode, 401);
  });

  test('link temporário abre o anexo sem token; link inválido não', async () => {
    const image = (await upload(png, 'Cardápio.png', 'image/png')).json().attachment;
    await sendMessage({ title: 'Cardápio', content: 'Da semana.', type: 'INFORMATIVO', target: 'ALL', attachmentIds: [image.id] });

    const link = await app.inject({ method: 'POST', url: `/api/attachments/${image.id}/link`, headers: as(adminToken) });
    assert.equal(link.statusCode, 200);
    const withTicket = await app.inject({ method: 'GET', url: link.json().url });
    assert.equal(withTicket.statusCode, 200);
    assert.ok(png.equals(withTicket.rawPayload));

    const fake = `/api/attachments/${image.id}?t=${'0'.repeat(48)}`;
    assert.equal((await app.inject({ method: 'GET', url: fake })).statusCode, 401);
  });

  test('o mesmo anexo não entra em dois comunicados, e ids inválidos são recusados', async () => {
    const image = (await upload(png, 'Uma vez.png', 'image/png')).json().attachment;
    const first = await sendMessage({ title: 'Primeiro', content: 'Com anexo.', type: 'AVISO', target: 'ALL', attachmentIds: [image.id] });
    assert.equal(first.statusCode, 201);
    const second = await sendMessage({ title: 'Segundo', content: 'Mesmo anexo.', type: 'AVISO', target: 'ALL', attachmentIds: [image.id] });
    assert.equal(second.statusCode, 400);
    const invalid = await sendMessage({ title: 'X', content: 'Y', type: 'AVISO', target: 'ALL', attachmentIds: ['nao-e-um-id'] });
    assert.equal(invalid.statusCode, 400);
  });

  test('DP cancela um arquivo que ainda não foi enviado', async () => {
    const image = (await upload(png, 'Desisti.png', 'image/png')).json().attachment;
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/attachments/${image.id}`, headers: as(adminToken) })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: `/api/attachments/${image.id}`, headers: as(adminToken) })).statusCode, 404);
  });
});

describe('acesso de DP e de TI pelo setor', () => {
  let pcDp: string;
  let pcTi: string;
  let pcComum: string;
  let idDoTi = '';

  function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) {
    return app.inject({ method, url, headers: as(token), payload });
  }

  test('funcionário do setor do DP entra nas telas do DP com o próprio login', async () => {
    for (const name of ['Departamento Pessoal', 'TI']) {
      assert.equal((await req('POST', '/api/sectors', adminToken, { name })).statusCode, 201);
    }
    await req('POST', '/api/employees', adminToken, {
      name: 'Livia Santos',
      registration: '3101',
      sector: 'Departamento Pessoal',
      password: 'Senha-Livia-3101',
    });
    const doTi = await req('POST', '/api/employees', adminToken, {
      name: 'Gabriel Torres',
      registration: '3102',
      sector: 'TI',
      password: 'Senha-Gabriel-3102',
    });
    idDoTi = doTi.json().employee.id;

    pcDp = (await register('PC-EEEE00000001')).json().token;
    pcTi = (await register('PC-EEEE00000002')).json().token;
    pcComum = (await register('PC-EEEE00000003')).json().token;

    // Sem ninguém logado, o computador não é DP
    assert.equal((await req('GET', '/api/admin/messages', pcDp)).statusCode, 403);

    const entrou = await req('POST', '/api/session/login', pcDp, {
      registration: '3101',
      password: 'Senha-Livia-3101',
    });
    assert.equal(entrou.statusCode, 200);
    assert.equal(entrou.json().employee.acessoAdmin, 'DP');

    // Agora o mesmo token do PC vale como DP
    assert.equal((await req('GET', '/api/admin/messages', pcDp)).statusCode, 200);
    const enviado = await req('POST', '/api/messages', pcDp, {
      title: 'Aviso da Livia',
      content: 'Enviado sem login separado.',
      type: 'AVISO',
    });
    assert.equal(enviado.statusCode, 201);
    assert.equal(enviado.json().message.sender, 'Livia Santos');
  });

  test('o setor do DP não dá os poderes do TI', async () => {
    const doDp = (await req('GET', '/api/admin/messages', pcDp)).json().messages[0];
    // Apagar comunicado e mexer em logins são do TI
    assert.equal((await req('DELETE', `/api/admin/messages/${doDp.id}`, pcDp)).statusCode, 403);
    assert.equal((await req('GET', '/api/admin/users', pcDp)).statusCode, 403);
  });

  test('funcionário do setor de TI tem os poderes do TI', async () => {
    const entrou = await req('POST', '/api/session/login', pcTi, {
      registration: '3102',
      password: 'Senha-Gabriel-3102',
    });
    assert.equal(entrou.json().employee.acessoAdmin, 'TI');

    assert.equal((await req('GET', '/api/admin/users', pcTi)).statusCode, 200);
    const alvo = (await req('GET', '/api/admin/messages', pcTi)).json().messages[0];
    assert.equal((await req('DELETE', `/api/admin/messages/${alvo.id}`, pcTi)).statusCode, 204);
  });

  test('setor comum continua sem acesso, e sair do aplicativo tira o acesso', async () => {
    await req('POST', '/api/employees', adminToken, {
      name: 'Pedro da Produção',
      registration: '3103',
      sector: 'Produção',
      password: 'Senha-Pedro-3103',
    });
    const entrou = await req('POST', '/api/session/login', pcComum, { registration: '3103', password: 'Senha-Pedro-3103' });
    assert.equal(entrou.statusCode, 200);
    assert.equal(entrou.json().employee.acessoAdmin, 'NENHUM');
    assert.equal((await req('GET', '/api/admin/messages', pcComum)).statusCode, 403);
    assert.equal(
      (await req('POST', '/api/messages', pcComum, { title: 'X', content: 'Y', type: 'AVISO' })).statusCode,
      403,
    );

    // A pessoa do TI sai: o computador volta a ser só um computador
    assert.equal((await req('POST', '/api/session/logout', pcTi)).statusCode, 204);
    assert.equal((await req('GET', '/api/admin/users', pcTi)).statusCode, 403);
  });

  test('tirar a pessoa do setor tira o acesso', async () => {
    await req('POST', '/api/session/login', pcTi, { registration: '3102', password: 'Senha-Gabriel-3102' });
    assert.equal((await req('GET', '/api/admin/users', pcTi)).statusCode, 200);

    const mudanca = await req('PATCH', `/api/employees/${idDoTi}`, adminToken, { sector: 'Produção' });
    assert.equal(mudanca.statusCode, 200);
    assert.equal(mudanca.json().employee.acessoAdmin, 'NENHUM');
    assert.equal((await req('GET', '/api/admin/users', pcTi)).statusCode, 403);
  });
});

// Por último: troca a senha do admin usado nos testes acima
describe('senha do próprio usuário da Central', () => {
  test('/auth/me informa se precisa trocar a senha', async () => {
    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: as(adminToken) })).json();
    assert.equal(me.user.username, 'admin');
    assert.equal(me.user.mustChangePassword, false);
  });

  test('troca a própria senha: atual errada → 400; certa → vale a nova', async () => {
    const change = (currentPassword: string, newPassword: string) =>
      app.inject({ method: 'POST', url: '/api/auth/password', headers: as(adminToken), payload: { currentPassword, newPassword } });
    assert.equal((await change('senha-errada-000', 'Nova-Senha-Admin-1')).statusCode, 400);
    const ok = await change(PASSWORD, 'Nova-Senha-Admin-1');
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().user.mustChangePassword, false);
    assert.equal((await login('admin', PASSWORD)).statusCode, 401);
    assert.equal((await login('admin', 'Nova-Senha-Admin-1')).statusCode, 200);
  });
});
