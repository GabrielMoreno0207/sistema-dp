/**
 * Testes dos agendamentos: comunicado e recado do mural que saem sozinhos na hora marcada.
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
const BASE = join(tmpdir(), `sistema-dp-test-agendamentos-${process.pid}`);
process.env.MIDIAS_PATH = join(BASE, 'midias');
process.env.UPLOADS_PATH = join(BASE, 'uploads');
process.env.UPDATES_PATH = join(BASE, 'atualizacoes');

const POSTGRES_URL = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
if (!POSTGRES_URL) {
  throw new Error('Defina TEST_DATABASE_URL: os testes rodam no PostgreSQL, que é o banco do sistema.');
}
const TEST_SCHEMA = 'teste_agendamentos';
process.env.DATABASE_URL = POSTGRES_URL;
process.env.DATABASE_SCHEMA = TEST_SCHEMA;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let repos: import('../src/database/repositories').Repositories;
let tokenTi: string;
let pcAna: string;

const comToken = (token: string) => ({ authorization: `Bearer ${token}` });
const daquiA = (minutos: number) => new Date(Date.now() + minutos * 60_000).toISOString();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

before(async () => {
  const { Client } = await import('pg');
  const limpeza = new Client({ connectionString: POSTGRES_URL });
  await limpeza.connect();
  await limpeza.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await limpeza.end();

  const { buildApp } = await import('../src/app');
  const { openDatabase } = await import('../src/database/open');
  const banco = await openDatabase();
  fecharBanco = banco.close;
  repos = banco.repositories;
  app = buildApp({ repositories: banco.repositories });
  await app.ready();

  tokenTi = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ti', password: SENHA_TI } })).json().token;

  await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'Produção' } });
  await app.inject({
    method: 'POST',
    url: '/api/employees',
    headers: comToken(tokenTi),
    payload: { name: 'Ana Lima', registration: '6001', sector: 'Produção', password: 'Senha-6001-agenda' },
  });
  pcAna = (
    await app.inject({
      method: 'POST',
      url: '/api/computers/register',
      payload: { computerId: 'PC-AABB00000001', hostname: 'pc-ana', appVersion: '1.34.1', platform: 'win32', computerSecret: 'a'.repeat(40) },
    })
  ).json().token;
  await app.inject({ method: 'POST', url: '/api/session/login', headers: comToken(pcAna), payload: { registration: '6001', password: 'Senha-6001-agenda' } });
});

after(async () => {
  await app.close();
  await fecharBanco();
  await rm(BASE, { recursive: true, force: true });
});

async function comunicadosDaAna(): Promise<{ title: string }[]> {
  return (await app.inject({ method: 'GET', url: '/api/messages?limit=500', headers: comToken(pcAna) })).json().messages;
}

describe('agendamento de comunicado', () => {
  test('fica guardado e só chega na hora marcada, com o anexo', async () => {
    const anexo = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { ...comToken(tokenTi), 'content-type': 'application/octet-stream', 'x-file-name': 'escala.png', 'x-file-type': 'image/png' },
      payload: PNG,
    });
    assert.equal(anexo.statusCode, 201);
    const anexoId = anexo.json().attachment.id;

    const agendado = await app.inject({
      method: 'POST',
      url: '/api/agendamentos/comunicado',
      headers: comToken(tokenTi),
      payload: {
        title: 'Inversão do feriado',
        content: 'Trabalharemos no sábado.',
        type: 'AVISO',
        target: 'ALL',
        attachmentIds: [anexoId],
        executarEm: daquiA(30),
      },
    });
    assert.equal(agendado.statusCode, 201);
    const id = agendado.json().agendamento.id;

    // A faxina de anexos (12 h sem uso) não apaga o anexo enquanto o comunicado espera
    const amanha = new Date(Date.now() + 24 * 60 * 60_000);
    assert.ok(!(await repos.attachments.listAbandoned(amanha)).some((a) => a.id === anexoId));

    // Antes da hora: nada chegou
    assert.equal(await app.agendamentos.executarVencidos(), 0);
    assert.ok(!(await comunicadosDaAna()).some((m) => m.title === 'Inversão do feriado'));

    const lista = (await app.inject({ method: 'GET', url: '/api/agendamentos', headers: comToken(tokenTi) })).json().agendamentos;
    assert.equal(lista[0].id, id);
    assert.equal(lista[0].status, 'PENDENTE');

    // Chegou a hora (o relógio "anda" 31 minutos)
    assert.equal(await app.agendamentos.executarVencidos(new Date(Date.now() + 31 * 60_000)), 1);
    const recebidos = await comunicadosDaAna();
    const recebido = recebidos.find((m) => m.title === 'Inversão do feriado') as { title: string; attachments: { id: string }[] } | undefined;
    assert.ok(recebido, 'o comunicado agendado devia ter chegado');
    assert.equal(recebido.attachments[0].id, anexoId);

    const depois = (await app.inject({ method: 'GET', url: '/api/agendamentos', headers: comToken(tokenTi) })).json().agendamentos;
    const resolvido = depois.find((a: { id: string }) => a.id === id);
    assert.equal(resolvido.status, 'ENVIADO');
    assert.ok(resolvido.resultadoId);
    // Não sai duas vezes
    assert.equal(await app.agendamentos.executarVencidos(new Date(Date.now() + 60 * 60_000)), 0);
  });

  test('data no passado, destino inexistente e funcionário comum são recusados', async () => {
    const base = { title: 'T', content: 'C', type: 'COMUNICADO', target: 'ALL' };
    const passado = await app.inject({
      method: 'POST',
      url: '/api/agendamentos/comunicado',
      headers: comToken(tokenTi),
      payload: { ...base, executarEm: daquiA(-5) },
    });
    assert.equal(passado.statusCode, 400);

    const semSetor = await app.inject({
      method: 'POST',
      url: '/api/agendamentos/comunicado',
      headers: comToken(tokenTi),
      payload: { ...base, target: 'SECTOR', targetId: 'Setor que não existe', executarEm: daquiA(10) },
    });
    assert.equal(semSetor.statusCode, 404);

    const funcionario = await app.inject({
      method: 'POST',
      url: '/api/agendamentos/comunicado',
      headers: comToken(pcAna),
      payload: { ...base, executarEm: daquiA(10) },
    });
    assert.equal(funcionario.statusCode, 403);
  });

  test('cancelado não sai', async () => {
    const agendado = await app.inject({
      method: 'POST',
      url: '/api/agendamentos/comunicado',
      headers: comToken(tokenTi),
      payload: { title: 'Cancelado', content: 'Não era para chegar', type: 'COMUNICADO', target: 'ALL', executarEm: daquiA(5) },
    });
    const id = agendado.json().agendamento.id;
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/agendamentos/${id}`, headers: comToken(tokenTi) })).statusCode, 204);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/agendamentos/${id}`, headers: comToken(tokenTi) })).statusCode, 409);
    await app.agendamentos.executarVencidos(new Date(Date.now() + 10 * 60_000));
    assert.ok(!(await comunicadosDaAna()).some((m) => m.title === 'Cancelado'));
  });
});

describe('agendamento do mural', () => {
  test('o recado entra no mural só na hora marcada', async () => {
    const agendado = await app.inject({
      method: 'POST',
      url: '/api/agendamentos/mural',
      headers: comToken(tokenTi),
      payload: { titulo: 'Festa de fim de ano', texto: 'Dia 18/12 no salão.', executarEm: daquiA(60) },
    });
    assert.equal(agendado.statusCode, 201);

    const antes = (await app.inject({ method: 'GET', url: '/api/mural', headers: comToken(pcAna) })).json().post;
    assert.notEqual(antes?.titulo, 'Festa de fim de ano');

    assert.equal(await app.agendamentos.executarVencidos(new Date(Date.now() + 61 * 60_000)), 1);
    const depois = (await app.inject({ method: 'GET', url: '/api/mural', headers: comToken(pcAna) })).json().post;
    assert.equal(depois.titulo, 'Festa de fim de ano');

    const mural = (await app.inject({ method: 'GET', url: '/api/agendamentos?tipo=MURAL', headers: comToken(tokenTi) })).json().agendamentos;
    assert.ok(mural.every((a: { tipo: string }) => a.tipo === 'MURAL'));
    assert.equal(mural[0].status, 'ENVIADO');
  });
});
