/**
 * Testes dos chamados para o TI: abertura, fila, conversa, status e acesso.
 * Uso: npm test
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const SENHA_TI = 'senha-de-teste-123';
const SENHA_FUNCIONARIO = 'Senha-Do-Joao-1';
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'fatal';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_USERNAME = 'ti';
process.env.ADMIN_PASSWORD = SENHA_TI;
process.env.ADMIN_NAME = 'TI';
const BASE = join(tmpdir(), `sistema-dp-test-chamados-${process.pid}`);
process.env.MIDIAS_PATH = join(BASE, 'midias');
process.env.UPLOADS_PATH = join(BASE, 'uploads');
process.env.UPDATES_PATH = join(BASE, 'atualizacoes');

const POSTGRES_URL = process.env.TEST_DATABASE_URL?.trim() || null;
const TEST_SCHEMA = 'teste_chamados';
if (!POSTGRES_URL) delete process.env.DATABASE_URL;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let tokenTi: string;
let tokenDp: string;
let tokenPc: string;

const comToken = (token: string) => ({ authorization: `Bearer ${token}` });

before(async () => {
  if (POSTGRES_URL) {
    const { Client } = await import('pg');
    const limpeza = new Client({ connectionString: POSTGRES_URL });
    await limpeza.connect();
    await limpeza.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await limpeza.end();
    process.env.DATABASE_URL = POSTGRES_URL;
    process.env.DATABASE_SCHEMA = TEST_SCHEMA;
  }

  const { buildApp } = await import('../src/app');
  const { openDatabase } = await import('../src/database/open');
  const banco = await openDatabase();
  fecharBanco = banco.close;
  app = buildApp({ repositories: banco.repositories });
  await app.ready();

  tokenTi = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ti', password: SENHA_TI } })).json().token;

  // Uma pessoa do DP sem poderes de TI (para conferir que ela não vê a fila)
  await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: comToken(tokenTi),
    payload: { username: 'livia', name: 'Lívia (DP)', password: 'Senha-Da-Livia-1' },
  });
  tokenDp = (
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'livia', password: 'Senha-Da-Livia-1' } })
  ).json().token;

  // Um PC com funcionário logado, como no aplicativo
  tokenPc = (
    await app.inject({
      method: 'POST',
      url: '/api/computers/register',
      payload: {
        computerId: 'PC-DDEEFF001122',
        hostname: 'PC-CHAMADOS',
        appVersion: '1.8.0',
        platform: 'win32',
        computerSecret: 'd'.repeat(40),
      },
    })
  ).json().token;

  await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'Produção' } });
  await app.inject({
    method: 'POST',
    url: '/api/employees',
    headers: comToken(tokenTi),
    payload: { name: 'João da Silva', registration: '8001', sector: 'Produção', password: SENHA_FUNCIONARIO },
  });
  const sessao = await app.inject({
    method: 'POST',
    url: '/api/session/login',
    headers: comToken(tokenPc),
    payload: { registration: '8001', password: SENHA_FUNCIONARIO },
  });
  assert.equal(sessao.statusCode, 200);
});

after(async () => {
  await app.close();
  await fecharBanco();
  await rm(BASE, { recursive: true, force: true });
});

let chamadoId = '';

describe('abertura do chamado', () => {
  test('o funcionário abre um chamado pelo aplicativo', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(tokenPc),
      payload: {
        titulo: 'Impressora não imprime',
        descricao: 'A impressora do setor pisca uma luz laranja e não imprime nada.',
        categoria: 'IMPRESSORA',
        prioridade: 'ALTA',
      },
    });
    assert.equal(resposta.statusCode, 201);
    const chamado = resposta.json();
    chamadoId = chamado.id;
    assert.equal(chamado.numero, 1);
    assert.equal(chamado.status, 'ABERTO');
    assert.equal(chamado.solicitanteNome, 'João da Silva');
    assert.equal(chamado.computadorId, 'PC-DDEEFF001122');
  });

  test('o número é sequencial', async () => {
    const segundo = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(tokenPc),
      payload: { titulo: 'Sistema travando', descricao: 'Trava ao abrir o comunicado.', categoria: 'SISTEMA' },
    });
    assert.equal(segundo.json().numero, 2);
    assert.equal(segundo.json().prioridade, 'NORMAL'); // padrão quando não informada
  });

  test('recusa categoria fora da lista', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(tokenPc),
      payload: { titulo: 'Teste', descricao: 'Teste', categoria: 'CAFETEIRA' },
    });
    assert.equal(resposta.statusCode, 400);
  });

  test('recusa imagem que não existe', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(tokenPc),
      payload: {
        titulo: 'Com print',
        descricao: 'Segue o print.',
        categoria: 'SISTEMA',
        midiaIds: ['MID-000000000000000000000000'],
      },
    });
    assert.equal(resposta.statusCode, 400);
  });

  test('sem estar logado no PC não abre chamado', async () => {
    const outroPc = (
      await app.inject({
        method: 'POST',
        url: '/api/computers/register',
        payload: {
          computerId: 'PC-999888777666',
          hostname: 'PC-SEM-LOGIN',
          appVersion: '1.8.0',
          platform: 'win32',
          computerSecret: 'e'.repeat(40),
        },
      })
    ).json().token;

    const resposta = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(outroPc),
      payload: { titulo: 'Teste', descricao: 'Teste', categoria: 'OUTRO' },
    });
    assert.equal(resposta.statusCode, 401);
  });
});

describe('fila do TI', () => {
  test('o TI vê os chamados em aberto', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/chamados/fila', headers: comToken(tokenTi) });
    assert.equal(resposta.statusCode, 200);
    const numeros = resposta.json().chamados.map((c: { numero: number }) => c.numero);
    assert.deepEqual(numeros.sort(), [1, 2]);
  });

  test('pessoa do DP sem poderes de TI não vê a fila', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/chamados/fila', headers: comToken(tokenDp) });
    assert.equal(resposta.statusCode, 403);
  });

  test('o funcionário vê só os chamados dele', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/chamados', headers: comToken(tokenPc) });
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().chamados.length, 2);
  });

  test('pessoa do DP não abre o chamado de um funcionário', async () => {
    const resposta = await app.inject({ method: 'GET', url: `/api/chamados/${chamadoId}`, headers: comToken(tokenDp) });
    assert.equal(resposta.statusCode, 404);
  });

  test('o resumo do app traz abertos e não lidas', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/chamados/resumo', headers: comToken(tokenPc) });
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().emAberto, 2);
  });
});

describe('conversa e andamento', () => {
  test('o TI responde e o chamado passa a Em andamento com responsável', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/api/chamados/${chamadoId}/mensagens`,
      headers: comToken(tokenTi),
      payload: { conteudo: 'Vou trocar o cartucho ainda hoje.' },
    });
    assert.equal(resposta.statusCode, 201);
    assert.equal(resposta.json().mensagem.autorTipo, 'TI');

    const detalhe = await app.inject({ method: 'GET', url: `/api/chamados/${chamadoId}`, headers: comToken(tokenPc) });
    assert.equal(detalhe.json().status, 'EM_ANDAMENTO');
    assert.equal(detalhe.json().responsavelNome, 'TI');
    assert.equal(detalhe.json().naoLidas, 1); // a resposta do TI ainda não foi lida
  });

  test('o funcionário responde de volta', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/api/chamados/${chamadoId}/mensagens`,
      headers: comToken(tokenPc),
      payload: { conteudo: 'Obrigado! A luz continua laranja.' },
    });
    assert.equal(resposta.statusCode, 201);
    assert.equal(resposta.json().mensagem.autorTipo, 'SOLICITANTE');

    const naFila = await app.inject({ method: 'GET', url: '/api/chamados/fila', headers: comToken(tokenTi) });
    const chamado = naFila.json().chamados.find((c: { id: string }) => c.id === chamadoId);
    assert.equal(chamado.mensagensNaoLidas, 1); // para o TI, a do funcionário
    assert.equal(chamado.totalMensagens, 2);
  });

  test('marcar como lidas zera o contador', async () => {
    await app.inject({ method: 'POST', url: `/api/chamados/${chamadoId}/lidas`, headers: comToken(tokenPc) });
    const detalhe = await app.inject({ method: 'GET', url: `/api/chamados/${chamadoId}`, headers: comToken(tokenPc) });
    assert.equal(detalhe.json().naoLidas, 0);
  });

  test('o funcionário não muda o andamento', async () => {
    const resposta = await app.inject({
      method: 'PUT',
      url: `/api/chamados/${chamadoId}/status`,
      headers: comToken(tokenPc),
      payload: { status: 'RESOLVIDO' },
    });
    assert.equal(resposta.statusCode, 403);
  });

  test('o TI resolve e quem abriu pode fechar', async () => {
    const resolvido = await app.inject({
      method: 'PUT',
      url: `/api/chamados/${chamadoId}/status`,
      headers: comToken(tokenTi),
      payload: { status: 'RESOLVIDO' },
    });
    assert.equal(resolvido.statusCode, 200);
    assert.equal(resolvido.json().status, 'RESOLVIDO');
    assert.ok(resolvido.json().resolvidoEm);

    const fechado = await app.inject({
      method: 'PUT',
      url: `/api/chamados/${chamadoId}/status`,
      headers: comToken(tokenPc),
      payload: { status: 'FECHADO' },
    });
    assert.equal(fechado.statusCode, 200);
    assert.equal(fechado.json().status, 'FECHADO');
  });

  test('chamado fechado não recebe mais mensagem', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/api/chamados/${chamadoId}/mensagens`,
      headers: comToken(tokenPc),
      payload: { conteudo: 'Mais uma coisa...' },
    });
    assert.equal(resposta.statusCode, 409);
  });

  test('fechado sai da fila, mas aparece no histórico', async () => {
    const fila = await app.inject({ method: 'GET', url: '/api/chamados/fila', headers: comToken(tokenTi) });
    assert.ok(!fila.json().chamados.some((c: { id: string }) => c.id === chamadoId));

    const historico = await app.inject({ method: 'GET', url: '/api/chamados/fila?encerrados=true', headers: comToken(tokenTi) });
    assert.ok(historico.json().chamados.some((c: { id: string }) => c.id === chamadoId));
  });

  test('só o TI apaga chamado', async () => {
    const tentativa = await app.inject({ method: 'DELETE', url: `/api/chamados/${chamadoId}`, headers: comToken(tokenPc) });
    assert.equal(tentativa.statusCode, 403);

    const apagado = await app.inject({ method: 'DELETE', url: `/api/chamados/${chamadoId}`, headers: comToken(tokenTi) });
    assert.equal(apagado.statusCode, 204);
  });
});
