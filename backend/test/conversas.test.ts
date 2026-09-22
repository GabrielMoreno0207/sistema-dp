/**
 * Testes do chat novo: conversa entre funcionários, grupos, arquivos e a
 * leitura do TI (que fica registrada).
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
process.env.DATABASE_PATH = ':memory:';
process.env.ADMIN_USERNAME = 'ti';
process.env.ADMIN_PASSWORD = SENHA_TI;
process.env.ADMIN_NAME = 'TI';
const BASE = join(tmpdir(), `sistema-dp-test-conversas-${process.pid}`);
process.env.MIDIAS_PATH = join(BASE, 'midias');
process.env.UPLOADS_PATH = join(BASE, 'uploads');
process.env.UPDATES_PATH = join(BASE, 'atualizacoes');

const POSTGRES_URL = process.env.TEST_DATABASE_URL?.trim() || null;
const TEST_SCHEMA = 'teste_conversas';
if (!POSTGRES_URL) delete process.env.DATABASE_URL;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let tokenTi: string;
/** PCs com funcionários diferentes logados */
let pcMaria: string;
let pcJoao: string;
let mariaId = '';
let joaoId = '';
let carlaId = '';

const comToken = (token: string) => ({ authorization: `Bearer ${token}` });

/** PNG de 1x1, só para exercitar o caminho do anexo */
const IMAGEM = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function registrarPc(computerId: string, segredo: string): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/api/computers/register',
    payload: { computerId, hostname: computerId, appVersion: '1.11.0', platform: 'win32', computerSecret: segredo },
  });
  return resposta.json().token;
}

async function criarFuncionario(nome: string, matricula: string, senha: string): Promise<string> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/api/employees',
    headers: comToken(tokenTi),
    payload: { name: nome, registration: matricula, sector: 'Produção', password: senha },
  });
  assert.equal(resposta.statusCode, 201);
  return resposta.json().employee.id;
}

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

  tokenTi = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ti', password: SENHA_TI } }))
    .json()
    .token;

  await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'Produção' } });
  mariaId = await criarFuncionario('Maria Souza', '3001', 'Senha-Maria-3001');
  joaoId = await criarFuncionario('João Lima', '3002', 'Senha-Joao-3002');
  carlaId = await criarFuncionario('Carla Dias', '3003', 'Senha-Carla-3003');

  pcMaria = await registrarPc('PC-AAAA11112222', 'a'.repeat(40));
  pcJoao = await registrarPc('PC-BBBB33334444', 'b'.repeat(40));
  await app.inject({
    method: 'POST',
    url: '/api/session/login',
    headers: comToken(pcMaria),
    payload: { registration: '3001', password: 'Senha-Maria-3001' },
  });
  await app.inject({
    method: 'POST',
    url: '/api/session/login',
    headers: comToken(pcJoao),
    payload: { registration: '3002', password: 'Senha-Joao-3002' },
  });
});

after(async () => {
  await app.close();
  await fecharBanco();
  await rm(BASE, { recursive: true, force: true });
});

let conversaMariaJoao = '';

describe('conversa entre funcionários', () => {
  test('a lista de contatos traz os colegas e o pessoal do DP', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/contatos', headers: comToken(pcMaria) });
    assert.equal(resposta.statusCode, 200);
    const contatos = resposta.json().contatos as { id: string; nome: string; ehDp: boolean }[];
    assert.ok(contatos.some((c) => c.id === joaoId));
    assert.ok(contatos.some((c) => c.id === carlaId));
    assert.ok(!contatos.some((c) => c.id === mariaId), 'a própria pessoa não aparece');
  });

  test('Maria abre conversa com João e envia mensagem', async () => {
    const criada = await app.inject({
      method: 'POST',
      url: '/api/conversas/direta',
      headers: comToken(pcMaria),
      payload: { comUsuarioId: joaoId },
    });
    assert.equal(criada.statusCode, 201);
    conversaMariaJoao = criada.json().id;
    assert.equal(criada.json().tipo, 'DIRETA');
    assert.equal(criada.json().titulo, 'João Lima');

    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'João, consegue cobrir meu turno sexta?' },
    });
    assert.equal(enviada.statusCode, 201);
    assert.equal(enviada.json().mensagem.autorNome, 'Maria Souza');
  });

  test('abrir a mesma conversa de novo não cria outra', async () => {
    const denovo = await app.inject({
      method: 'POST',
      url: '/api/conversas/direta',
      headers: comToken(pcJoao),
      payload: { comUsuarioId: mariaId },
    });
    assert.equal(denovo.json().id, conversaMariaJoao);
  });

  test('João vê a conversa com uma mensagem não lida', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcJoao) });
    const conversa = lista.json().conversas.find((c: { id: string }) => c.id === conversaMariaJoao);
    assert.equal(conversa.naoLidas, 1);
    assert.equal(conversa.titulo, 'Maria Souza');
    assert.equal(conversa.ultimaMensagem.conteudo, 'João, consegue cobrir meu turno sexta?');
  });

  test('depois de abrir, a contagem zera', async () => {
    await app.inject({ method: 'POST', url: `/api/conversas/${conversaMariaJoao}/lidas`, headers: comToken(pcJoao) });
    const lista = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcJoao) });
    const conversa = lista.json().conversas.find((c: { id: string }) => c.id === conversaMariaJoao);
    assert.equal(conversa.naoLidas, 0);
  });

  test('quem não participa não enxerga a conversa', async () => {
    const pcCarla = await registrarPc('PC-CCCC55556666', 'c'.repeat(40));
    await app.inject({
      method: 'POST',
      url: '/api/session/login',
      headers: comToken(pcCarla),
      payload: { registration: '3003', password: 'Senha-Carla-3003' },
    });
    const tentativa = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcCarla),
    });
    assert.equal(tentativa.statusCode, 404);
  });

  test('mensagem em branco sem anexo é recusada', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: '   ' },
    });
    assert.equal(tentativa.statusCode, 400);
  });

  test('dá para enviar imagem junto', async () => {
    const midia = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: { ...comToken(pcMaria), 'content-type': 'image/png', 'x-nome': encodeURIComponent('escala.png') },
      payload: IMAGEM,
    });
    assert.equal(midia.statusCode, 201);

    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'segue a escala', midiaId: midia.json().id },
    });
    assert.equal(enviada.statusCode, 201);
    assert.equal(enviada.json().mensagem.tipo, 'MIDIA');
    assert.equal(enviada.json().mensagem.midiaId, midia.json().id);
  });
});

describe('grupos', () => {
  let grupoId = '';

  test('Maria cria um grupo com João e Carla', async () => {
    const criado = await app.inject({
      method: 'POST',
      url: '/api/conversas/grupo',
      headers: comToken(pcMaria),
      payload: { nome: 'Turno da manhã', membros: [joaoId, carlaId] },
    });
    assert.equal(criado.statusCode, 201);
    grupoId = criado.json().id;
    assert.equal(criado.json().tipo, 'GRUPO');
    assert.equal(criado.json().titulo, 'Turno da manhã');
    assert.equal(criado.json().participantes.length, 3);
    assert.equal(criado.json().meuPapel, 'ADMIN');
  });

  test('grupo sem ninguém é recusado', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: '/api/conversas/grupo',
      headers: comToken(pcMaria),
      payload: { nome: 'Só eu', membros: [mariaId] },
    });
    assert.equal(tentativa.statusCode, 400);
  });

  test('mensagem no grupo chega para os participantes', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/conversas/${grupoId}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'Reunião às 7h no refeitório.' },
    });
    const doJoao = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcJoao) });
    const grupo = doJoao.json().conversas.find((c: { id: string }) => c.id === grupoId);
    assert.equal(grupo.naoLidas, 1);
    assert.equal(grupo.meuPapel, 'MEMBRO');
  });

  test('só quem administra mexe no grupo', async () => {
    const tentativa = await app.inject({
      method: 'PUT',
      url: `/api/conversas/${grupoId}/nome`,
      headers: comToken(pcJoao),
      payload: { nome: 'Outro nome' },
    });
    assert.equal(tentativa.statusCode, 403);

    const permitida = await app.inject({
      method: 'PUT',
      url: `/api/conversas/${grupoId}/nome`,
      headers: comToken(pcMaria),
      payload: { nome: 'Turno da manhã — produção' },
    });
    assert.equal(permitida.statusCode, 204);
  });

  test('administrador remove alguém e a saída fica registrada', async () => {
    const removido = await app.inject({
      method: 'DELETE',
      url: `/api/conversas/${grupoId}/membros/${carlaId}`,
      headers: comToken(pcMaria),
    });
    assert.equal(removido.statusCode, 204);

    const detalhe = await app.inject({ method: 'GET', url: `/api/conversas/${grupoId}`, headers: comToken(pcMaria) });
    assert.equal(detalhe.json().participantes.length, 2);

    const mensagens = (
      await app.inject({ method: 'GET', url: `/api/conversas/${grupoId}/mensagens`, headers: comToken(pcMaria) })
    ).json().mensagens as { tipo: string; conteudo: string }[];
    assert.ok(mensagens.some((m) => m.tipo === 'SISTEMA' && m.conteudo.includes('removeu')));
  });

  test('quem sai do grupo deixa de ver, e a administração passa adiante', async () => {
    const saiu = await app.inject({ method: 'POST', url: `/api/conversas/${grupoId}/sair`, headers: comToken(pcMaria) });
    assert.equal(saiu.statusCode, 204);

    const depois = await app.inject({ method: 'GET', url: `/api/conversas/${grupoId}`, headers: comToken(pcMaria) });
    assert.equal(depois.statusCode, 404);

    // João era o único restante: assume a administração
    const doJoao = await app.inject({ method: 'GET', url: `/api/conversas/${grupoId}`, headers: comToken(pcJoao) });
    assert.equal(doJoao.json().meuPapel, 'ADMIN');
  });
});

describe('apagar mensagem', () => {
  test('cada um apaga só as próprias mensagens', async () => {
    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'mensagem para apagar' },
    });
    const id = enviada.json().mensagem.id;

    const deOutro = await app.inject({ method: 'DELETE', url: `/api/conversas/mensagens/${id}`, headers: comToken(pcJoao) });
    assert.equal(deOutro.statusCode, 403);

    const propria = await app.inject({ method: 'DELETE', url: `/api/conversas/mensagens/${id}`, headers: comToken(pcMaria) });
    assert.equal(propria.statusCode, 204);

    const mensagens = (
      await app.inject({ method: 'GET', url: `/api/conversas/${conversaMariaJoao}/mensagens`, headers: comToken(pcMaria) })
    ).json().mensagens as { id: number; apagadaEm: string | null; conteudo: string }[];
    const apagada = mensagens.find((m) => m.id === id);
    assert.ok(apagada?.apagadaEm);
    assert.equal(apagada?.conteudo, '');
  });
});

describe('leitura pelo TI', () => {
  test('o TI enxerga as conversas de todo mundo', async () => {
    const lista = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(tokenTi) });
    assert.equal(lista.statusCode, 200);
    assert.ok(lista.json().conversas.some((c: { id: string }) => c.id === conversaMariaJoao));
  });

  test('abrir uma conversa alheia fica registrado', async () => {
    const leitura = await app.inject({
      method: 'GET',
      url: `/api/admin/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(tokenTi),
    });
    assert.equal(leitura.statusCode, 200);
    assert.ok(leitura.json().mensagens.length > 0);

    const acessos = await app.inject({ method: 'GET', url: '/api/admin/conversas/acessos', headers: comToken(tokenTi) });
    const registro = acessos.json().acessos.find((a: { conversaId: string }) => a.conversaId === conversaMariaJoao);
    assert.ok(registro, 'a leitura do TI precisa ficar registrada');
    assert.equal(registro.usuarioNome, 'TI');
  });

  test('funcionário não usa as rotas do TI', async () => {
    const tentativa = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(pcMaria) });
    assert.equal(tentativa.statusCode, 403);
  });

  test('o TI apaga a conversa inteira', async () => {
    const apagada = await app.inject({
      method: 'DELETE',
      url: `/api/admin/conversas/${conversaMariaJoao}`,
      headers: comToken(tokenTi),
    });
    assert.equal(apagada.statusCode, 204);

    const depois = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcMaria) });
    assert.ok(!depois.json().conversas.some((c: { id: string }) => c.id === conversaMariaJoao));
  });
});
