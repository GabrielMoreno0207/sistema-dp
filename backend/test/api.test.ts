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
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = PASSWORD;
// Fixo aqui: o .env da máquina não pode mudar o resultado dos testes (ex.: ADMIN_NAME diferente)
process.env.ADMIN_NAME = 'Departamento Pessoal';
// Anexos em pasta temporária: o teste não mexe em backend/data/uploads
const UPLOADS_PATH = join(tmpdir(), `sistema-dp-test-uploads-${process.pid}`);
process.env.UPLOADS_PATH = UPLOADS_PATH;
delete process.env.TLS_CERT_FILE;
delete process.env.TLS_KEY_FILE;

// Mesmo conjunto de testes rodando no PostgreSQL quando TEST_DATABASE_URL é informada
const POSTGRES_URL = process.env.TEST_DATABASE_URL?.trim() || null;
const TEST_SCHEMA = 'teste_automatizado';

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let adminToken: string;
let repos: import('../src/database/repositories').Repositories;

const secret = (c: string) => c.repeat(40);

before(async () => {
  if (POSTGRES_URL) {
    // Schema só de teste, recriado do zero: nunca encosta nos dados reais
    const { Client } = await import('pg');
    const limpeza = new Client({ connectionString: POSTGRES_URL });
    await limpeza.connect();
    await limpeza.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await limpeza.end();
    process.env.DATABASE_URL = POSTGRES_URL;
    process.env.DATABASE_SCHEMA = TEST_SCHEMA;
  } else {
    delete process.env.DATABASE_URL;
    process.env.DATABASE_PATH = ':memory:';
  }

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

  test('celular (CEL-) se registra como os PCs; outros prefixos são recusados', async () => {
    assert.equal((await register('CEL-AAAA00000001')).statusCode, 200);
    assert.equal((await register('TAB-AAAA00000001')).statusCode, 400);
    assert.equal((await register('cel-aaaa00000001')).statusCode, 400);
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

  test('DP cadastra funcionários; matrícula repetida → 409', async () => {
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

  test('comunicados para setor e turno chegam só para quem é destinatário; "funcionário" agora é pelo chat', async () => {
    const individual = await sendMessage({ title: 'Para Maria', content: 'Individual.', type: 'AVISO', target: 'EMPLOYEE', targetId: mariaId });
    assert.equal(individual.statusCode, 400);
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

  test('matrícula atacada de vários PCs é bloqueada', async () => {
    const tokens: string[] = [];
    for (let i = 1; i <= 4; i++) tokens.push((await register(`PC-DDDD0000000${i}`)).json().token);
    // 10 erros espalhados em 3 PCs (menos de 5 por PC) para uma matrícula
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

  test('DP altera a matrícula; matrícula de outro → 409', async () => {
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

describe('chat individual: cada pessoa do DP tem as próprias conversas', () => {
  let pc: string;
  let other: string;
  let carlaId: string;
  let livia: { id: string; token: string };
  let carol: { id: string; token: string };

  function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
    return app.inject({ method, url, headers: as(token), payload });
  }

  /** Cria uma pessoa do DP direto no banco (como o script create-admin) e faz login na Central */
  async function createDpUser(username: string, name: string, chatContact = true) {
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
        chatContact,
        passwordHash: await hashSecret(password),
      },
      new Date(),
    );
    return { id: user.id, token: (await login(username, password)).json().token as string };
  }

  const contactsOf = async (token: string) => (await call('GET', '/api/chat/contacts', token)).json();

  test('sem funcionário logado → 401', async () => {
    pc = (await register('PC-EEEE00000001')).json().token;
    other = (await register('PC-EEEE00000002')).json().token;
    assert.equal((await call('GET', '/api/chat/contacts', pc)).statusCode, 401);
  });

  test('funcionário vê as pessoas do DP como contatos (admin e TI ficam fora)', async () => {
    livia = await createDpUser('livia', 'Livia (DP)');
    carol = await createDpUser('carol', 'Carol (DP)');
    await createDpUser('ti', 'TI', false);
    carlaId = (await call('GET', '/api/employees', adminToken)).json().employees.find(
      (e: { registration: string }) => e.registration === '2003',
    ).id;
    await call('POST', '/api/session/login', pc, { registration: '2003', password: 'Senha-Carla-2003' });

    const names = (await contactsOf(pc)).contacts.map((c: { name: string }) => c.name);
    assert.ok(names.includes('Livia (DP)') && names.includes('Carol (DP)'));
    assert.ok(!names.includes('TI') && !names.includes('Departamento Pessoal'));
  });

  test('conversas são individuais nos dois lados', async () => {
    const sent = await call('POST', `/api/chats/${carlaId}/messages`, livia.token, { content: 'Oi, Carla! Aqui é a Livia.' });
    assert.equal(sent.statusCode, 201);
    assert.equal(sent.json().message.dpUserId, livia.id);

    let contacts = await contactsOf(pc);
    const byId = (id: string) => contacts.contacts.find((c: { id: string }) => c.id === id);
    assert.equal(byId(livia.id).unreadCount, 1);
    assert.equal(byId(carol.id).unreadCount, 0);
    assert.equal(contacts.unreadCount, 1);
    assert.equal((await call('GET', `/api/chat/messages?dpUserId=${livia.id}`, pc)).json().messages.length, 1);
    assert.equal((await call('GET', `/api/chat/messages?dpUserId=${carol.id}`, pc)).json().messages.length, 0);

    // A funcionária inicia uma conversa com a Carol: só a Carol vê
    assert.equal((await call('POST', '/api/chat/messages', pc, { dpUserId: carol.id, content: 'Oi, Carol! Dúvida sobre férias.' })).statusCode, 201);
    const carolConversation = (await call('GET', '/api/chats', carol.token)).json().conversations.find(
      (c: { employee: { id: string } }) => c.employee.id === carlaId,
    );
    assert.equal(carolConversation.unreadCount, 1);
    const liviaThread = (await call('GET', `/api/chats/${carlaId}/messages`, livia.token)).json().messages;
    assert.equal(liviaThread.length, 1); // a mensagem para a Carol não aparece para a Livia
    const adminConversations = (await call('GET', '/api/chats', adminToken)).json().conversations;
    assert.equal(adminConversations.length, 0); // o admin não vê as conversas das colegas

    // Leitura também é por conversa
    assert.equal((await call('POST', '/api/chat/read', pc, { dpUserId: livia.id })).statusCode, 204);
    contacts = await contactsOf(pc);
    assert.equal(byId(livia.id).unreadCount, 0);
    assert.equal((await call('POST', `/api/chats/${carlaId}/read`, carol.token)).statusCode, 204);
    const carolAfter = (await call('GET', '/api/chats', carol.token)).json().conversations[0];
    assert.equal(carolAfter.unreadCount, 0);
  });

  test('quem está fora da lista (admin) e escreve passa a aparecer para aquele funcionário', async () => {
    await call('POST', `/api/chats/${carlaId}/messages`, adminToken, { content: 'Aviso do sistema.' });
    const names = (await contactsOf(pc)).contacts.map((c: { name: string }) => c.name);
    assert.ok(names.includes('Departamento Pessoal'));
    // Outro funcionário não vê essa conversa
    await call('POST', '/api/employees', adminToken, { name: 'Diego Ramos', registration: '2004', sector: 'Produção', password: 'Senha-Diego-2004' });
    await call('POST', '/api/session/login', other, { registration: '2004', password: 'Senha-Diego-2004' });
    const diegoNames = (await contactsOf(other)).contacts.map((c: { name: string }) => c.name);
    assert.ok(!diegoNames.includes('Departamento Pessoal'));
  });

  test('validação e acesso', async () => {
    assert.equal((await call('POST', '/api/chat/messages', pc, { dpUserId: livia.id, content: '   ' })).statusCode, 400);
    assert.equal((await call('POST', '/api/chat/messages', pc, { content: 'sem destinatário' })).statusCode, 400);
    // dpUserId de um funcionário (não é pessoa do DP) → 404
    assert.equal((await call('POST', '/api/chat/messages', pc, { dpUserId: carlaId, content: 'x' })).statusCode, 404);
    assert.equal((await call('GET', '/api/chats', pc)).statusCode, 403);
    assert.equal((await call('GET', '/api/chat/contacts', adminToken)).statusCode, 403);
    const mariaId = (await call('GET', '/api/employees', adminToken)).json().employees.find(
      (e: { registration: string }) => e.registration === '2001',
    ).id;
    // Maria está inativa: o DP não consegue escrever para ela
    assert.equal((await call('POST', `/api/chats/${mariaId}/messages`, livia.token, { content: 'Oi' })).statusCode, 404);
  });
});

describe('resposta automática configurada na Central, por setor', () => {
  let pc: string;
  let fabricio: { id: string; token: string };
  let andressa: { id: string; token: string };
  let diegoId: string;

  function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string, payload?: object) {
    return app.inject({ method, url, headers: as(token), payload });
  }

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

  const thread = async (dp: { id: string }) =>
    (await call('GET', `/api/chat/messages?dpUserId=${dp.id}`, pc)).json().messages as Array<{
      senderType: string;
      content: string;
      automatic: boolean;
    }>;

  test('validação e acesso', async () => {
    fabricio = await createDpUser('fabricio', 'Fabricio (DP)');
    andressa = await createDpUser('andressa', 'Andressa (DP)');
    pc = (await register('PC-FFFF00000001')).json().token;
    await call('POST', '/api/session/login', pc, { registration: '2004', password: 'Senha-Diego-2004' });
    diegoId = (await call('GET', '/api/employees', adminToken)).json().employees.find(
      (e: { registration: string }) => e.registration === '2004',
    ).id;

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
    assert.equal((await call('POST', '/api/chat/messages', pc, { dpUserId: fabricio.id, content: 'Fabricio, dúvida no ponto' })).statusCode, 201);
    let messages = await thread(fabricio);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].senderType, 'DP');
    assert.equal(messages[1].automatic, true);
    assert.equal(messages[1].content, 'Oi, Diego (Produção)! Aqui é o Fabricio, respondo logo.');

    await call('POST', '/api/chat/messages', pc, { dpUserId: fabricio.id, content: 'Mais uma coisa' });
    messages = await thread(fabricio);
    assert.equal(messages.length, 3); // sem nova resposta automática
    const conversation = (await call('GET', '/api/chats', fabricio.token)).json().conversations.find(
      (c: { employee: { id: string } }) => c.employee.id === diegoId,
    );
    assert.equal(conversation.unreadCount, 2);
  });

  test('resposta do setor pausada → usa a de todos os setores; sem nenhuma → não responde', async () => {
    await call('POST', '/api/auto-replies', andressa.token, { sector: null, content: 'Padrão da Andressa, {funcionario}', active: true });
    const paused = await call('POST', '/api/auto-replies', andressa.token, { sector: 'Produção', content: 'Produção', active: false });
    assert.equal(paused.json().rule.active, false);
    await call('POST', '/api/chat/messages', pc, { dpUserId: andressa.id, content: 'Oi Andressa' });
    const messages = await thread(andressa);
    assert.equal(messages.at(-1)?.content, 'Padrão da Andressa, Diego Ramos');

    // O admin não configurou nada: não responde
    const adminId = (await call('GET', '/api/auth/me', adminToken)).json().user.id;
    await call('POST', '/api/chat/messages', pc, { dpUserId: adminId, content: 'Oi admin' });
    assert.equal((await thread({ id: adminId })).length, 1);
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

  test('TI não altera a própria conta nem outra conta de TI por essas rotas', async () => {
    const meuId = (await call('GET', '/api/auth/me', adminToken)).json().user.id;
    assert.equal((await call('PATCH', `/api/admin/users/${meuId}`, adminToken, { status: 'INACTIVE' })).statusCode, 400);
    assert.equal((await call('POST', `/api/admin/users/${meuId}/password`, adminToken, { password: 'Qualquer-Senha-1' })).statusCode, 400);
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
