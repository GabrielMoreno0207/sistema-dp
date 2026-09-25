/**
 * Testes da agenda: anotação pessoal, evento da empresa e quem pode o quê.
 * Uso: npm test
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const SENHA_TI = 'senha-de-teste-123';
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'fatal';
process.env.ADMIN_USERNAME = 'ti';
process.env.ADMIN_PASSWORD = SENHA_TI;
process.env.ADMIN_NAME = 'TI';
const BASE = join(tmpdir(), `sistema-dp-test-agenda-${process.pid}`);
process.env.MIDIAS_PATH = join(BASE, 'midias');
process.env.UPLOADS_PATH = join(BASE, 'uploads');
process.env.UPDATES_PATH = join(BASE, 'atualizacoes');

const POSTGRES_URL = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
if (!POSTGRES_URL) {
  throw new Error('Defina TEST_DATABASE_URL: os testes rodam no PostgreSQL, que é o banco do sistema.');
}
const TEST_SCHEMA = 'teste_agenda';
process.env.DATABASE_URL = POSTGRES_URL;
process.env.DATABASE_SCHEMA = TEST_SCHEMA;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let tokenTi: string;
let pcAna: string;
let pcBruno: string;

const comToken = (token: string) => ({ authorization: `Bearer ${token}` });

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
  fecharBanco = banco.close;
  app = buildApp({ repositories: banco.repositories });
  await app.ready();

  tokenTi = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ti', password: SENHA_TI } }))
    .json()
    .token;

  await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'Produção' } });
  for (const [nome, matricula] of [
    ['Ana Lima', '5001'],
    ['Bruno Melo', '5002'],
  ]) {
    await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: comToken(tokenTi),
      payload: { name: nome, registration: matricula, sector: 'Produção', password: `Senha-${matricula}-agenda` },
    });
  }

  const registrar = async (computerId: string, segredo: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/computers/register',
        payload: { computerId, hostname: computerId, appVersion: '1.15.0', platform: 'win32', computerSecret: segredo },
      })
    ).json().token;

  pcAna = await registrar('PC-AAEE11110001', 'a'.repeat(40));
  pcBruno = await registrar('PC-AAEE11110002', 'b'.repeat(40));
  await app.inject({
    method: 'POST',
    url: '/api/session/login',
    headers: comToken(pcAna),
    payload: { registration: '5001', password: 'Senha-5001-agenda' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/session/login',
    headers: comToken(pcBruno),
    payload: { registration: '5002', password: 'Senha-5002-agenda' },
  });
});

after(async () => {
  await app.close();
  await fecharBanco();
  await rm(BASE, { recursive: true, force: true });
});

const periodo = '/api/eventos?de=2026-10-01&ate=2026-10-31';

describe('agenda', () => {
  let eventoDaAna = '';

  test('a anotação pessoal é só de quem escreveu', async () => {
    const criado = await app.inject({
      method: 'POST',
      url: '/api/eventos',
      headers: comToken(pcAna),
      payload: { titulo: 'Consulta médica', dia: '2026-10-08', hora: '14:30' },
    });
    assert.equal(criado.statusCode, 201);
    assert.equal(criado.json().escopo, 'PESSOAL');
    eventoDaAna = criado.json().id;

    const daAna = await app.inject({ method: 'GET', url: periodo, headers: comToken(pcAna) });
    assert.equal(daAna.json().eventos.length, 1);

    const doBruno = await app.inject({ method: 'GET', url: periodo, headers: comToken(pcBruno) });
    assert.equal(doBruno.json().eventos.length, 0);
  });

  test('evento para todos é publicação do DP, e aparece para qualquer pessoa', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: '/api/eventos',
      headers: comToken(pcAna),
      payload: { titulo: 'Feriado', dia: '2026-10-12', escopo: 'GERAL' },
    });
    assert.equal(tentativa.statusCode, 403);

    const publicado = await app.inject({
      method: 'POST',
      url: '/api/eventos',
      headers: comToken(tokenTi),
      payload: { titulo: 'Feriado de 12/10', dia: '2026-10-12', escopo: 'GERAL', cor: '#d97706' },
    });
    assert.equal(publicado.statusCode, 201);

    const doBruno = await app.inject({ method: 'GET', url: periodo, headers: comToken(pcBruno) });
    const titulos = doBruno.json().eventos.map((e: { titulo: string }) => e.titulo);
    assert.deepEqual(titulos, ['Feriado de 12/10']);
  });

  test('cada um mexe só no que criou', async () => {
    const doOutro = await app.inject({
      method: 'PUT',
      url: `/api/eventos/${eventoDaAna}`,
      headers: comToken(pcBruno),
      payload: { titulo: 'Mudando o que não é meu', dia: '2026-10-08' },
    });
    assert.equal(doOutro.statusCode, 403);

    const alterado = await app.inject({
      method: 'PUT',
      url: `/api/eventos/${eventoDaAna}`,
      headers: comToken(pcAna),
      payload: { titulo: 'Consulta médica (remarcada)', dia: '2026-10-09', hora: '09:00' },
    });
    assert.equal(alterado.statusCode, 200);
    assert.equal(alterado.json().dia, '2026-10-09');
    assert.equal(alterado.json().hora, '09:00');
  });

  test('data que não existe no calendário é recusada', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/eventos',
      headers: comToken(pcAna),
      payload: { titulo: 'Dia inventado', dia: '2026-02-31' },
    });
    assert.equal(resposta.statusCode, 400);
  });

  test('sem funcionário logado no PC a agenda não abre', async () => {
    await app.inject({ method: 'POST', url: '/api/session/logout', headers: comToken(pcBruno) });
    const resposta = await app.inject({ method: 'GET', url: periodo, headers: comToken(pcBruno) });
    assert.equal(resposta.statusCode, 401);
  });

  test('quem criou apaga a própria anotação', async () => {
    const apagado = await app.inject({
      method: 'DELETE',
      url: `/api/eventos/${eventoDaAna}`,
      headers: comToken(pcAna),
    });
    assert.equal(apagado.statusCode, 204);

    const daAna = await app.inject({ method: 'GET', url: periodo, headers: comToken(pcAna) });
    const titulos = daAna.json().eventos.map((e: { titulo: string }) => e.titulo);
    assert.deepEqual(titulos, ['Feriado de 12/10']);
  });
});

describe('agenda: DP pelo setor', () => {
  test('funcionário do setor do DP publica para a empresa pelo próprio login', async () => {
    await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'Departamento Pessoal' } });
    await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: comToken(tokenTi),
      payload: { name: 'Carla DP', registration: 'carladp', sector: 'Departamento Pessoal', password: 'Senha-Carla-agenda' },
    });
    const pcCarla = (
      await app.inject({
        method: 'POST',
        url: '/api/computers/register',
        payload: { computerId: 'CEL-AAEE11110003', hostname: 'celular', appVersion: '1.4.0', platform: 'android', computerSecret: 'c'.repeat(40) },
      })
    ).json().token;
    await app.inject({
      method: 'POST',
      url: '/api/session/login',
      headers: comToken(pcCarla),
      payload: { registration: 'carladp', password: 'Senha-Carla-agenda' },
    });

    const publicado = await app.inject({
      method: 'POST',
      url: '/api/eventos',
      headers: comToken(pcCarla),
      payload: { titulo: 'Entrega do ponto', dia: '2026-10-20', escopo: 'GERAL' },
    });
    assert.equal(publicado.statusCode, 201);

    // Funcionário de outro setor continua sem poder publicar para todos
    const recusado = await app.inject({
      method: 'POST',
      url: '/api/eventos',
      headers: comToken(pcAna),
      payload: { titulo: 'Churrasco', dia: '2026-10-21', escopo: 'GERAL' },
    });
    assert.equal(recusado.statusCode, 403);

    const daAna = await app.inject({ method: 'GET', url: periodo, headers: comToken(pcAna) });
    assert.ok(daAna.json().eventos.some((e: { titulo: string }) => e.titulo === 'Entrega do ponto'));
  });
});

describe('limpeza de dados pelo setor do TI', () => {
  test('funcionário do setor TI apaga comunicados e conversas, e elas somem da lista', async () => {
    await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'TI' } });
    await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: comToken(tokenTi),
      payload: { name: 'Bruno TI', registration: 'brunoti', sector: 'TI', password: 'Senha-Bruno-limpeza' },
    });
    const pc = (
      await app.inject({
        method: 'POST',
        url: '/api/computers/register',
        payload: { computerId: 'PC-AAEE11110009', hostname: 'pc-ti', appVersion: '1.34.0', platform: 'win32', computerSecret: 'd'.repeat(40) },
      })
    ).json().token;
    await app.inject({ method: 'POST', url: '/api/session/login', headers: comToken(pc), payload: { registration: 'brunoti', password: 'Senha-Bruno-limpeza' } });

    // Um comunicado de hoje e uma conversa com mensagem
    await app.inject({
      method: 'POST',
      url: '/api/messages',
      headers: comToken(tokenTi),
      payload: { title: 'Aviso de hoje', content: 'Texto.', type: 'COMUNICADO', target: 'ALL' },
    });
    const contatos = (await app.inject({ method: 'GET', url: '/api/contatos', headers: comToken(pc) })).json();
    const ana = contatos.contatos.find((p: { nome: string }) => p.nome.startsWith('Ana'));
    const conversa = (await app.inject({ method: 'POST', url: '/api/conversas/direta', headers: comToken(pc), payload: { comUsuarioId: ana.id } })).json();
    await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/mensagens`, headers: comToken(pc), payload: { conteudo: 'oi Ana' } });

    // Pelo prazo (90 dias), o que é de hoje fica
    const prazo = await app.inject({ method: 'POST', url: '/api/admin/messages/purge', headers: comToken(pc), payload: { olderThanDays: 90 } });
    assert.equal(prazo.statusCode, 200);
    assert.equal(prazo.json().removed, 0);

    // Tudo: comunicados e conversas somem da lista
    const comunicados = await app.inject({ method: 'POST', url: '/api/admin/messages/purge', headers: comToken(pc), payload: { olderThanDays: null } });
    assert.equal(comunicados.statusCode, 200);
    assert.ok(comunicados.json().removed >= 1);
    assert.equal((await app.inject({ method: 'GET', url: '/api/messages?limit=500', headers: comToken(pcAna) })).json().messages.length, 0);

    const conversas = await app.inject({ method: 'POST', url: '/api/admin/chats/purge', headers: comToken(pc), payload: { dpUserId: null, olderThanDays: null } });
    assert.equal(conversas.statusCode, 200);
    assert.ok(conversas.json().removed >= 1);
    const daAna = (await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcAna) })).json().conversas;
    assert.equal(daAna.length, 0);
  });
});
