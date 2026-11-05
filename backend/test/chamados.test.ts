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
process.env.ADMIN_USERNAME = 'ti';
process.env.ADMIN_PASSWORD = SENHA_TI;
process.env.ADMIN_NAME = 'TI';
const BASE = join(tmpdir(), `sistema-dp-test-chamados-${process.pid}`);
process.env.MIDIAS_PATH = join(BASE, 'midias');
process.env.UPLOADS_PATH = join(BASE, 'uploads');
process.env.UPDATES_PATH = join(BASE, 'atualizacoes');

const POSTGRES_URL = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
if (!POSTGRES_URL) {
  throw new Error('Defina TEST_DATABASE_URL: os testes rodam no PostgreSQL, que é o banco do sistema.');
}
const TEST_SCHEMA = 'teste_chamados';
process.env.DATABASE_URL = POSTGRES_URL;
process.env.DATABASE_SCHEMA = TEST_SCHEMA;

let app: FastifyInstance;
let fecharBanco: () => Promise<void>;
let tokenTi: string;
let tokenDp: string;
let tokenPc: string;

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

describe('aceitar o chamado (fila compartilhada do TI)', () => {
  let livreId = '';

  test('chamado novo nasce sem responsável, esperando alguém do TI', async () => {
    const novo = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(tokenPc),
      payload: { titulo: 'Sem internet na recepção', descricao: 'O cabo está conectado mas não navega.', categoria: 'REDE' },
    });
    assert.equal(novo.statusCode, 201);
    livreId = novo.json().id;
    assert.equal(novo.json().responsavelId, null);
    assert.equal(novo.json().status, 'ABERTO');
  });

  test('quem não é do TI não aceita', async () => {
    const funcionario = await app.inject({ method: 'POST', url: `/api/chamados/${livreId}/aceitar`, headers: comToken(tokenPc) });
    assert.equal(funcionario.statusCode, 403);

    const dp = await app.inject({ method: 'POST', url: `/api/chamados/${livreId}/aceitar`, headers: comToken(tokenDp) });
    assert.ok(dp.statusCode === 403 || dp.statusCode === 404);
  });

  test('o TI aceita: vira responsável e o chamado entra em andamento', async () => {
    const aceito = await app.inject({ method: 'POST', url: `/api/chamados/${livreId}/aceitar`, headers: comToken(tokenTi) });
    assert.equal(aceito.statusCode, 200);
    assert.equal(aceito.json().status, 'EM_ANDAMENTO');
    assert.equal(aceito.json().responsavelNome, 'TI');

    // Quem abriu passa a ver quem está cuidando
    const visto = await app.inject({ method: 'GET', url: `/api/chamados/${livreId}`, headers: comToken(tokenPc) });
    assert.equal(visto.json().responsavelNome, 'TI');
  });

  test('aceitar de novo o próprio chamado não quebra', async () => {
    const outra = await app.inject({ method: 'POST', url: `/api/chamados/${livreId}/aceitar`, headers: comToken(tokenTi) });
    assert.equal(outra.statusCode, 200);
    assert.equal(outra.json().responsavelNome, 'TI');
  });

  test('chamado fechado não é mais aceito', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/chamados/${livreId}/status`,
      headers: comToken(tokenTi),
      payload: { status: 'FECHADO' },
    });
    const tarde = await app.inject({ method: 'POST', url: `/api/chamados/${livreId}/aceitar`, headers: comToken(tokenTi) });
    assert.equal(tarde.statusCode, 409);
  });
});

/**
 * O TI que atende do próprio computador.
 *
 * Quem é do setor do TI tem o poder pelo setor, sem login à parte — é assim no
 * resto do sistema. Nos chamados, porém, as regras exigiam uma conta de admin:
 * a pessoa via a fila, mas não conseguia aceitar, responder nem mudar o
 * andamento ("Só o TI muda o andamento do chamado"). Este teste prende a
 * correção.
 */
describe('TI pelo setor, atendendo do próprio PC', () => {
  let tokenPcTi: string;
  let chamadoId: string;

  before(async () => {
    await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'TI' } });
    await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: comToken(tokenTi),
      payload: { name: 'Bruno TI', registration: 'brunoti', sector: 'TI', password: 'Senha-Bruno-chamado' },
    });
    tokenPcTi = (
      await app.inject({
        method: 'POST',
        url: '/api/computers/register',
        payload: {
          computerId: 'PC-AAEE11110077',
          hostname: 'pc-do-ti',
          appVersion: '1.53.0',
          platform: 'win32',
          computerSecret: 'f'.repeat(40),
        },
      })
    ).json().token;
    await app.inject({
      method: 'POST',
      url: '/api/session/login',
      headers: comToken(tokenPcTi),
      payload: { registration: 'brunoti', password: 'Senha-Bruno-chamado' },
    });
  });

  test('o chamado que o TI abre nasce marcado como teste, com o setor junto', async () => {
    const criado = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(tokenPcTi),
      payload: { titulo: 'Computador', descricao: 'testando o fluxo', categoria: 'COMPUTADOR' },
    });
    assert.equal(criado.statusCode, 201);
    chamadoId = criado.json().id;
    assert.equal(criado.json().teste, true);
    assert.equal(criado.json().solicitanteSetor, 'TI');
  });

  test('chamado de quem não é do TI não vem marcado como teste', async () => {
    const doJoao = await app.inject({
      method: 'POST',
      url: '/api/chamados',
      headers: comToken(tokenPc),
      payload: { titulo: 'Impressora', descricao: 'nao puxa papel', categoria: 'IMPRESSORA' },
    });
    assert.equal(doJoao.json().teste, false);
  });

  test('aceita, responde e muda o andamento sem conta de admin', async () => {
    const aceito = await app.inject({
      method: 'POST',
      url: `/api/chamados/${chamadoId}/aceitar`,
      headers: comToken(tokenPcTi),
    });
    assert.equal(aceito.statusCode, 200);
    assert.equal(aceito.json().responsavelNome, 'Bruno TI');

    const resposta = await app.inject({
      method: 'POST',
      url: `/api/chamados/${chamadoId}/mensagens`,
      headers: comToken(tokenPcTi),
      payload: { conteudo: 'estou olhando' },
    });
    assert.equal(resposta.statusCode, 201);
    // Fala como TI, não como solicitante, mesmo sendo quem abriu
    assert.equal(resposta.json().mensagem.autorTipo, 'TI');

    const status = await app.inject({
      method: 'PUT',
      url: `/api/chamados/${chamadoId}/status`,
      headers: comToken(tokenPcTi),
      payload: { status: 'RESOLVIDO' },
    });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().status, 'RESOLVIDO');
  });

  test('e apaga o chamado de teste', async () => {
    const apagado = await app.inject({
      method: 'DELETE',
      url: `/api/chamados/${chamadoId}`,
      headers: comToken(tokenPcTi),
    });
    assert.equal(apagado.statusCode, 204);
    const sumiu = await app.inject({ method: 'GET', url: `/api/chamados/${chamadoId}`, headers: comToken(tokenTi) });
    assert.equal(sumiu.statusCode, 404);
  });

  test('funcionário comum continua sem mexer no andamento', async () => {
    const doJoao = (
      await app.inject({
        method: 'POST',
        url: '/api/chamados',
        headers: comToken(tokenPc),
        payload: { titulo: 'Rede', descricao: 'sem internet', categoria: 'REDE' },
      })
    ).json();
    const tentativa = await app.inject({
      method: 'PUT',
      url: `/api/chamados/${doJoao.id}/status`,
      headers: comToken(tokenPc),
      payload: { status: 'RESOLVIDO' },
    });
    assert.equal(tentativa.statusCode, 403);
  });
});

/**
 * Notas internas: recado do TI para o TI dentro do chamado.
 *
 * O ponto delicado é o vazamento: a nota pode falar de senha, de erro do
 * próprio sistema ou de outra pessoa. Se ela aparecer para quem abriu o
 * chamado, o estrago é imediato — por isso o teste cobre isso primeiro.
 */
describe('notas internas do TI', () => {
  let doJoao: string;

  before(async () => {
    doJoao = (
      await app.inject({
        method: 'POST',
        url: '/api/chamados',
        headers: comToken(tokenPc),
        payload: { titulo: 'Computador lento', descricao: 'demora pra abrir tudo', categoria: 'COMPUTADOR' },
      })
    ).json().id;
  });

  test('o TI escreve e os outros do TI leem', async () => {
    const criada = await app.inject({
      method: 'POST',
      url: `/api/chamados/${doJoao}/notas`,
      headers: comToken(tokenTi),
      payload: { conteudo: 'disco cheio, limpei temporarios. se voltar, trocar o HD' },
    });
    assert.equal(criada.statusCode, 201);
    assert.equal(criada.json().nota.autorNome, 'TI');

    const visto = await app.inject({ method: 'GET', url: `/api/chamados/${doJoao}`, headers: comToken(tokenTi) });
    assert.equal(visto.json().notas.length, 1);
    assert.match(visto.json().notas[0].conteudo, /trocar o HD/);
  });

  test('quem abriu o chamado não recebe as notas', async () => {
    const comoSolicitante = await app.inject({
      method: 'GET',
      url: `/api/chamados/${doJoao}`,
      headers: comToken(tokenPc),
    });
    assert.equal(comoSolicitante.statusCode, 200);
    assert.deepEqual(comoSolicitante.json().notas, []);
    // E nem no corpo bruto da resposta: nada do texto da nota pode trafegar
    assert.doesNotMatch(comoSolicitante.body, /trocar o HD/);
  });

  test('quem abriu o chamado também não consegue escrever nota', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: `/api/chamados/${doJoao}/notas`,
      headers: comToken(tokenPc),
      payload: { conteudo: 'deixa eu escrever aqui' },
    });
    assert.equal(tentativa.statusCode, 403);
  });

  test('a nota acompanha o chamado quando outra pessoa do TI assume', async () => {
    await app.inject({ method: 'POST', url: `/api/chamados/${doJoao}/aceitar`, headers: comToken(tokenTi) });
    const depois = await app.inject({ method: 'GET', url: `/api/chamados/${doJoao}`, headers: comToken(tokenTi) });
    assert.equal(depois.json().responsavelNome, 'TI');
    assert.equal(depois.json().notas.length, 1);
  });

  test('apagar o chamado leva as notas junto', async () => {
    const descartavel = (
      await app.inject({
        method: 'POST',
        url: '/api/chamados',
        headers: comToken(tokenPc),
        payload: { titulo: 'Teste', descricao: 'some depois', categoria: 'OUTRO' },
      })
    ).json().id;
    await app.inject({
      method: 'POST',
      url: `/api/chamados/${descartavel}/notas`,
      headers: comToken(tokenTi),
      payload: { conteudo: 'nota que vai junto' },
    });
    const apagado = await app.inject({ method: 'DELETE', url: `/api/chamados/${descartavel}`, headers: comToken(tokenTi) });
    assert.equal(apagado.statusCode, 204);
  });
});

/**
 * Trocar de mão um chamado que já está com alguém.
 *
 * Sem isso, o atendimento de quem saiu de férias ou trocou de turno ficava
 * preso: ninguém mais conseguia pegar. A troca não pode ser por acidente — só
 * acontece quando a pessoa pede de propósito — e precisa ficar registrada.
 */
describe('assumir chamado de outra pessoa do TI', () => {
  let tokenPcTi2: string;
  let doJoao: string;

  before(async () => {
    await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: comToken(tokenTi),
      payload: { name: 'Carla TI', registration: 'carlati', sector: 'TI', password: 'Senha-Carla-chamado' },
    });
    tokenPcTi2 = (
      await app.inject({
        method: 'POST',
        url: '/api/computers/register',
        payload: {
          computerId: 'PC-AAEE11110088',
          hostname: 'pc-da-carla',
          appVersion: '1.55.0',
          platform: 'win32',
          computerSecret: 'e'.repeat(40),
        },
      })
    ).json().token;
    await app.inject({
      method: 'POST',
      url: '/api/session/login',
      headers: comToken(tokenPcTi2),
      payload: { registration: 'carlati', password: 'Senha-Carla-chamado' },
    });

    doJoao = (
      await app.inject({
        method: 'POST',
        url: '/api/chamados',
        headers: comToken(tokenPc),
        payload: { titulo: 'Impressora parada', descricao: 'nao liga', categoria: 'IMPRESSORA' },
      })
    ).json().id;
    await app.inject({ method: 'POST', url: `/api/chamados/${doJoao}/aceitar`, headers: comToken(tokenTi) });
  });

  test('clicar em aceitar num chamado com dono continua avisando, sem trocar nada', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: `/api/chamados/${doJoao}/aceitar`,
      headers: comToken(tokenPcTi2),
    });
    assert.equal(tentativa.statusCode, 409);
    assert.match(tentativa.json().message, /já está cuidando/);

    const inalterado = await app.inject({ method: 'GET', url: `/api/chamados/${doJoao}`, headers: comToken(tokenTi) });
    assert.equal(inalterado.json().responsavelNome, 'TI');
  });

  test('pedindo para assumir, o chamado troca de mão', async () => {
    const assumido = await app.inject({
      method: 'POST',
      url: `/api/chamados/${doJoao}/aceitar`,
      headers: comToken(tokenPcTi2),
      payload: { assumir: true },
    });
    assert.equal(assumido.statusCode, 200);
    assert.equal(assumido.json().responsavelNome, 'Carla TI');
  });

  test('a troca fica registrada numa nota interna', async () => {
    const visto = await app.inject({ method: 'GET', url: `/api/chamados/${doJoao}`, headers: comToken(tokenTi) });
    const nota = visto.json().notas.at(-1);
    assert.match(nota.conteudo, /Carla TI assumiu o chamado, que estava com TI/);
  });

  test('quem abriu vê o nome novo, e nenhuma nota', async () => {
    const comoSolicitante = await app.inject({ method: 'GET', url: `/api/chamados/${doJoao}`, headers: comToken(tokenPc) });
    assert.equal(comoSolicitante.json().responsavelNome, 'Carla TI');
    assert.deepEqual(comoSolicitante.json().notas, []);
  });

  test('funcionário comum não assume chamado nenhum', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: `/api/chamados/${doJoao}/aceitar`,
      headers: comToken(tokenPc),
      payload: { assumir: true },
    });
    assert.equal(tentativa.statusCode, 403);
  });
});
