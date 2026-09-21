/**
 * Testes do mural, das mídias (imagem e vídeo), dos atalhos e da foto de perfil.
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
const SENHA_FUNCIONARIO = 'Senha-Do-Joao-1';
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'fatal';
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = SENHA;
process.env.ADMIN_NAME = 'Departamento Pessoal';
const BASE = join(tmpdir(), `sistema-dp-test-conteudo-${process.pid}`);
process.env.MIDIAS_PATH = join(BASE, 'midias');
process.env.UPLOADS_PATH = join(BASE, 'uploads');
process.env.UPDATES_PATH = join(BASE, 'atualizacoes');

// Os mesmos testes rodam no PostgreSQL quando TEST_DATABASE_URL é informada
const POSTGRES_URL = process.env.TEST_DATABASE_URL?.trim() || null;
const TEST_SCHEMA = 'teste_conteudo';
if (!POSTGRES_URL) delete process.env.DATABASE_URL;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let tokenDp: string;
let tokenPc: string;

/** PNG de 1x1 pixel, suficiente para exercitar o caminho da imagem */
const IMAGEM = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** "Vídeo" de mentira: só bytes, para conferir o envio em partes (Range) */
const VIDEO = Buffer.alloc(4096, 7);

const comToken = (token: string) => ({ authorization: `Bearer ${token}` });

function enviarMidia(conteudo: Buffer, mimeType: string, token: string, nome = 'arquivo') {
  return app.inject({
    method: 'POST',
    url: '/api/midias',
    headers: { ...comToken(token), 'content-type': mimeType, 'x-nome': encodeURIComponent(nome) },
    payload: conteudo,
  });
}

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
  }

  const { buildApp } = await import('../src/app');
  const { openDatabase } = await import('../src/database/open');
  const banco = await openDatabase();
  fecharBanco = banco.close;
  app = buildApp({ repositories: banco.repositories });
  await app.ready();

  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: SENHA } });
  tokenDp = login.json().token;

  // Um PC registrado e um funcionário logado nele: é assim que o app desktop usa a API
  const registro = await app.inject({
    method: 'POST',
    url: '/api/computers/register',
    payload: {
      computerId: 'PC-AABBCCDD1122',
      hostname: 'PC-TESTE',
      appVersion: '1.6.0',
      platform: 'win32',
      computerSecret: 'c'.repeat(40),
    },
  });
  tokenPc = registro.json().token;

  // O setor precisa existir antes do funcionário
  await app.inject({
    method: 'POST',
    url: '/api/sectors',
    headers: comToken(tokenDp),
    payload: { name: 'Produção' },
  });
  const funcionario = await app.inject({
    method: 'POST',
    url: '/api/employees',
    headers: comToken(tokenDp),
    payload: { name: 'João da Silva', registration: '7001', sector: 'Produção', password: SENHA_FUNCIONARIO },
  });
  assert.equal(funcionario.statusCode, 201);
  const sessao = await app.inject({
    method: 'POST',
    url: '/api/session/login',
    headers: comToken(tokenPc),
    payload: { registration: '7001', password: SENHA_FUNCIONARIO },
  });
  assert.equal(sessao.statusCode, 200);
});

after(async () => {
  await app.close();
  await fecharBanco();
  await rm(BASE, { recursive: true, force: true });
});

describe('mídias', () => {
  test('o DP envia uma imagem e ela volta íntegra', async () => {
    const envio = await enviarMidia(IMAGEM, 'image/png', tokenDp, 'aviso.png');
    assert.equal(envio.statusCode, 201);
    const midia = envio.json();
    assert.equal(midia.tipo, 'IMAGEM');
    assert.equal(midia.tamanho, IMAGEM.length);
    assert.match(midia.id, /^MID-[0-9a-f]{24}$/);

    const baixada = await app.inject({ method: 'GET', url: midia.url, headers: comToken(tokenDp) });
    assert.equal(baixada.statusCode, 200);
    assert.equal(baixada.headers['content-type'], 'image/png');
    assert.equal(
      createHash('sha256').update(baixada.rawPayload).digest('hex'),
      createHash('sha256').update(IMAGEM).digest('hex'),
    );
  });

  test('recusa tipo de arquivo fora da lista', async () => {
    const envio = await enviarMidia(Buffer.from('MZ...'), 'application/x-msdownload', tokenDp, 'virus.exe');
    assert.equal(envio.statusCode, 415);
  });

  test('recusa arquivo vazio', async () => {
    const envio = await enviarMidia(Buffer.alloc(0), 'image/png', tokenDp);
    assert.equal(envio.statusCode, 400);
  });

  test('exige autenticação para enviar e para baixar', async () => {
    const semLogin = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: { 'content-type': 'image/png' },
      payload: IMAGEM,
    });
    assert.equal(semLogin.statusCode, 401);
  });

  test('vídeo aceita Range, que é o que deixa arrastar a barra', async () => {
    const envio = await enviarMidia(VIDEO, 'video/mp4', tokenDp, 'mural.mp4');
    assert.equal(envio.statusCode, 201);
    const { url } = envio.json();

    const inteiro = await app.inject({ method: 'GET', url, headers: comToken(tokenDp) });
    assert.equal(inteiro.statusCode, 200);
    assert.equal(inteiro.headers['accept-ranges'], 'bytes');
    assert.equal(inteiro.rawPayload.length, VIDEO.length);

    const pedaco = await app.inject({ method: 'GET', url, headers: { ...comToken(tokenDp), range: 'bytes=100-199' } });
    assert.equal(pedaco.statusCode, 206);
    assert.equal(pedaco.headers['content-range'], `bytes 100-199/${VIDEO.length}`);
    assert.equal(pedaco.rawPayload.length, 100);

    const finalzinho = await app.inject({ method: 'GET', url, headers: { ...comToken(tokenDp), range: 'bytes=-50' } });
    assert.equal(finalzinho.statusCode, 206);
    assert.equal(finalzinho.rawPayload.length, 50);
  });
});

describe('mural', () => {
  let midiaId: string;

  test('o DP publica um recado com imagem', async () => {
    midiaId = (await enviarMidia(IMAGEM, 'image/png', tokenDp, 'mural.png')).json().id;
    const criado = await app.inject({
      method: 'POST',
      url: '/api/mural',
      headers: comToken(tokenDp),
      payload: { titulo: 'Folha de setembro', texto: 'Disponível no portal.', midiaId, ativo: true },
    });
    assert.equal(criado.statusCode, 201);
    assert.equal(criado.json().midia.id, midiaId);
  });

  test('o aplicativo enxerga o recado em exibição', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/mural', headers: comToken(tokenPc) });
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().post.titulo, 'Folha de setembro');
    assert.equal(resposta.json().post.midia.tipo, 'IMAGEM');
  });

  test('o recado mais novo substitui o anterior na tela', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/mural',
      headers: comToken(tokenDp),
      payload: { titulo: 'Férias coletivas', texto: 'De 22/12 a 02/01.', ativo: true },
    });
    const resposta = await app.inject({ method: 'GET', url: '/api/mural', headers: comToken(tokenPc) });
    assert.equal(resposta.json().post.titulo, 'Férias coletivas');
    assert.equal(resposta.json().post.midia, null);
  });

  test('funcionário não publica no mural', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: '/api/mural',
      headers: comToken(tokenPc),
      payload: { titulo: 'Teste', texto: 'Teste', ativo: true },
    });
    assert.equal(tentativa.statusCode, 403);
  });

  test('recado desativado sai da tela', async () => {
    const todos = await app.inject({ method: 'GET', url: '/api/mural/todos', headers: comToken(tokenDp) });
    const atual = todos.json().posts[0];
    const desativado = await app.inject({
      method: 'PUT',
      url: `/api/mural/${atual.id}`,
      headers: comToken(tokenDp),
      payload: { titulo: atual.titulo, texto: atual.texto, midiaId: null, ativo: false },
    });
    assert.equal(desativado.statusCode, 200);

    const emExibicao = await app.inject({ method: 'GET', url: '/api/mural', headers: comToken(tokenPc) });
    assert.equal(emExibicao.json().post.titulo, 'Folha de setembro');
  });
});

describe('atalhos do colaborador', () => {
  const atalho = { rotulo: 'Meus comunicados', icone: '◈', cor: '#17b3a3', destino: 'COMUNICADOS' };

  test('o funcionário cria o próprio atalho', async () => {
    const criado = await app.inject({ method: 'POST', url: '/api/atalhos', headers: comToken(tokenPc), payload: atalho });
    assert.equal(criado.statusCode, 201);
    assert.equal(criado.json().rotulo, 'Meus comunicados');
    assert.equal(criado.json().ordem, 0);
  });

  test('a lista traz só os atalhos de quem está logado', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/atalhos', headers: comToken(tokenPc) });
    assert.equal(lista.statusCode, 200);
    assert.equal(lista.json().atalhos.length, 1);
  });

  test('recusa destino que não existe', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: '/api/atalhos',
      headers: comToken(tokenPc),
      payload: { ...atalho, destino: 'FOLHA_DE_PAGAMENTO' },
    });
    assert.equal(tentativa.statusCode, 400);
  });

  test('recusa cor fora do formato', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: '/api/atalhos',
      headers: comToken(tokenPc),
      payload: { ...atalho, cor: 'verde' },
    });
    assert.equal(tentativa.statusCode, 400);
  });

  test('a ordem escolhida é gravada', async () => {
    const segundo = await app.inject({
      method: 'POST',
      url: '/api/atalhos',
      headers: comToken(tokenPc),
      payload: { ...atalho, rotulo: 'Falar com o DP', destino: 'CHAT', cor: '#3f8fd0' },
    });
    const idSegundo = segundo.json().id;
    const lista = await app.inject({ method: 'GET', url: '/api/atalhos', headers: comToken(tokenPc) });
    const ids = lista.json().atalhos.map((a: { id: string }) => a.id);

    const invertida = await app.inject({
      method: 'PUT',
      url: '/api/atalhos/ordem',
      headers: comToken(tokenPc),
      payload: { ids: [...ids].reverse() },
    });
    assert.equal(invertida.statusCode, 200);
    assert.equal(invertida.json().atalhos[0].id, idSegundo);
  });

  test('editar e apagar funcionam', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/atalhos', headers: comToken(tokenPc) });
    const alvo = lista.json().atalhos[0];

    const editado = await app.inject({
      method: 'PUT',
      url: `/api/atalhos/${alvo.id}`,
      headers: comToken(tokenPc),
      payload: { ...atalho, rotulo: 'Nome novo' },
    });
    assert.equal(editado.statusCode, 200);
    assert.equal(editado.json().rotulo, 'Nome novo');

    const apagado = await app.inject({ method: 'DELETE', url: `/api/atalhos/${alvo.id}`, headers: comToken(tokenPc) });
    assert.equal(apagado.statusCode, 204);

    const depois = await app.inject({ method: 'GET', url: '/api/atalhos', headers: comToken(tokenPc) });
    assert.equal(depois.json().atalhos.length, 1);
  });

  test('o DP não mexe nos atalhos pelo app (rota é do computador)', async () => {
    const tentativa = await app.inject({ method: 'GET', url: '/api/atalhos', headers: comToken(tokenDp) });
    assert.equal(tentativa.statusCode, 403);
  });
});

describe('foto de perfil', () => {
  test('o funcionário define a própria foto', async () => {
    const midiaId = (await enviarMidia(IMAGEM, 'image/jpeg', tokenPc, 'eu.jpg')).json().id;
    const definida = await app.inject({
      method: 'PUT',
      url: '/api/perfil/foto',
      headers: comToken(tokenPc),
      payload: { midiaId },
    });
    assert.equal(definida.statusCode, 200);
    assert.equal(definida.json().foto.id, midiaId);
  });

  test('vídeo não serve como foto de perfil', async () => {
    const midiaId = (await enviarMidia(VIDEO, 'video/mp4', tokenPc, 'eu.mp4')).json().id;
    const tentativa = await app.inject({
      method: 'PUT',
      url: '/api/perfil/foto',
      headers: comToken(tokenPc),
      payload: { midiaId },
    });
    assert.equal(tentativa.statusCode, 400);
  });

  test('trocar a foto apaga a anterior do servidor', async () => {
    const primeira = (await enviarMidia(IMAGEM, 'image/png', tokenPc, 'antiga.png')).json();
    await app.inject({ method: 'PUT', url: '/api/perfil/foto', headers: comToken(tokenPc), payload: { midiaId: primeira.id } });

    const segunda = (await enviarMidia(IMAGEM, 'image/png', tokenPc, 'nova.png')).json();
    await app.inject({ method: 'PUT', url: '/api/perfil/foto', headers: comToken(tokenPc), payload: { midiaId: segunda.id } });

    const antiga = await app.inject({ method: 'GET', url: primeira.url, headers: comToken(tokenPc) });
    assert.equal(antiga.statusCode, 404);
    const nova = await app.inject({ method: 'GET', url: segunda.url, headers: comToken(tokenPc) });
    assert.equal(nova.statusCode, 200);
  });

  test('o app lê a foto atual ao entrar', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/perfil/foto', headers: comToken(tokenPc) });
    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().foto.tipo, 'IMAGEM');
  });

  test('remover a foto volta ao avatar padrão', async () => {
    const removida = await app.inject({ method: 'DELETE', url: '/api/perfil/foto', headers: comToken(tokenPc) });
    assert.equal(removida.statusCode, 204);

    const depois = await app.inject({ method: 'GET', url: '/api/perfil/foto', headers: comToken(tokenPc) });
    assert.equal(depois.json().foto, null);
  });
});
