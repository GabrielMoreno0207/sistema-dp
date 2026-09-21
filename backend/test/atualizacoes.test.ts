/**
 * Testes das rotas de atualização (publicar, verificar, baixar, remover).
 * Uso: npm test
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const SENHA = 'senha-de-teste-123';
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'fatal';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = SENHA;
process.env.ADMIN_NAME = 'Departamento Pessoal';
const UPDATES_PATH = join(tmpdir(), `sistema-dp-test-updates-${process.pid}`);
const UPLOADS_PATH = join(tmpdir(), `sistema-dp-test-uploads-updates-${process.pid}`);
process.env.UPDATES_PATH = UPDATES_PATH;
process.env.UPLOADS_PATH = UPLOADS_PATH;
delete process.env.DATABASE_URL;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let tokenTi: string;

/** Instalador de mentira: conteúdo qualquer, só para exercitar o caminho do arquivo */
const INSTALADOR = Buffer.from('conteudo-do-instalador-de-teste'.repeat(50));
const SHA_ESPERADO = createHash('sha256').update(INSTALADOR).digest('hex');

function publicar(versao: string, opcoes: { token?: string; arquivo?: string; notas?: string; corpo?: Buffer } = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/atualizacoes/desktop',
    headers: {
      authorization: `Bearer ${opcoes.token ?? tokenTi}`,
      'content-type': 'application/vnd.dp-atualizacao',
      'x-versao': versao,
      'x-arquivo': opcoes.arquivo ?? `ComunicacaoDP-Setup-${versao}.exe`,
      'x-notas': encodeURIComponent(opcoes.notas ?? 'Correções gerais'),
      'x-obrigatoria': 'false',
    },
    payload: opcoes.corpo ?? INSTALADOR,
  });
}

before(async () => {
  const { buildApp } = await import('../src/app');
  const { openDatabase } = await import('../src/database/open');
  const banco = await openDatabase();
  fecharBanco = banco.close;
  app = buildApp({ repositories: banco.repositories });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: SENHA },
  });
  assert.equal(login.statusCode, 200);
  tokenTi = login.json().token;
});

after(async () => {
  await app.close();
  await fecharBanco();
  await rm(UPDATES_PATH, { recursive: true, force: true });
  await rm(UPLOADS_PATH, { recursive: true, force: true });
});

describe('publicação de versões', () => {
  test('publica a primeira versão do desktop', async () => {
    const resposta = await publicar('1.5.0');
    assert.equal(resposta.statusCode, 201);
    const release = resposta.json();
    assert.equal(release.versao, '1.5.0');
    assert.equal(release.tamanho, INSTALADOR.length);
    assert.equal(release.sha256, SHA_ESPERADO);
    assert.equal(release.publicadoPor, 'Departamento Pessoal');
  });

  test('recusa a mesma versão duas vezes', async () => {
    const resposta = await publicar('1.5.0');
    assert.equal(resposta.statusCode, 409);
  });

  test('recusa versão fora do formato 1.2.3', async () => {
    const resposta = await publicar('versao-nova');
    assert.equal(resposta.statusCode, 400);
  });

  test('recusa nome de arquivo que tenta sair da pasta', async () => {
    const resposta = await publicar('1.5.1', { arquivo: '../fora.exe' });
    assert.equal(resposta.statusCode, 400);
  });

  test('recusa arquivo vazio', async () => {
    const resposta = await publicar('1.5.2', { corpo: Buffer.alloc(0) });
    assert.equal(resposta.statusCode, 400);
  });

  test('sem autenticação não publica', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/atualizacoes/desktop',
      headers: { 'content-type': 'application/vnd.dp-atualizacao', 'x-versao': '9.9.9', 'x-arquivo': 'x.exe' },
      payload: INSTALADOR,
    });
    assert.equal(resposta.statusCode, 401);
  });
});

describe('consulta e download', () => {
  test('quem está na versão antiga recebe a nova', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/atualizacoes/desktop/verificar?versao=1.4.0',
      headers: { authorization: `Bearer ${tokenTi}` },
    });
    assert.equal(resposta.statusCode, 200);
    const corpo = resposta.json();
    assert.equal(corpo.temAtualizacao, true);
    assert.equal(corpo.release.versao, '1.5.0');
    assert.equal(corpo.release.url, '/api/atualizacoes/desktop/download/1.5.0');
  });

  test('quem já está na última não recebe atualização', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/atualizacoes/desktop/verificar?versao=1.5.0',
      headers: { authorization: `Bearer ${tokenTi}` },
    });
    assert.equal(resposta.json().temAtualizacao, false);
    assert.equal(resposta.json().release, null);
  });

  test('aplicativo sem versão publicada responde sem atualização', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/atualizacoes/mobile/verificar?versao=1.3.0',
      headers: { authorization: `Bearer ${tokenTi}` },
    });
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().temAtualizacao, false);
  });

  test('verificar exige autenticação', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/atualizacoes/desktop/verificar?versao=1.0.0' });
    assert.equal(resposta.statusCode, 401);
  });

  test('download entrega o arquivo íntegro', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/atualizacoes/desktop/download/1.5.0',
      headers: { authorization: `Bearer ${tokenTi}` },
    });
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.headers['x-sha256'], SHA_ESPERADO);
    assert.equal(createHash('sha256').update(resposta.rawPayload).digest('hex'), SHA_ESPERADO);
  });

  test('versão inexistente devolve 404', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/atualizacoes/desktop/download/9.9.9',
      headers: { authorization: `Bearer ${tokenTi}` },
    });
    assert.equal(resposta.statusCode, 404);
  });
});

describe('remoção', () => {
  test('tira a versão do ar e ela some da lista', async () => {
    await publicar('1.6.0');
    const remocao = await app.inject({
      method: 'DELETE',
      url: '/api/atualizacoes/desktop/1.6.0',
      headers: { authorization: `Bearer ${tokenTi}` },
    });
    assert.equal(remocao.statusCode, 204);

    const lista = await app.inject({
      method: 'GET',
      url: '/api/atualizacoes/desktop',
      headers: { authorization: `Bearer ${tokenTi}` },
    });
    const versoes = lista.json().releases.map((r: { versao: string }) => r.versao);
    assert.ok(!versoes.includes('1.6.0'));
    assert.ok(versoes.includes('1.5.0'));
  });
});
