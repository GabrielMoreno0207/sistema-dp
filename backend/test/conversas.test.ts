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
/** Senha que destranca a área Conversas (TI), além da conta */
const SENHA_DA_AREA = 'senha-da-area-9988';
process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'fatal';
process.env.ADMIN_USERNAME = 'ti';
process.env.ADMIN_PASSWORD = SENHA_TI;
process.env.ADMIN_NAME = 'TI';
process.env.SENHA_TI = SENHA_DA_AREA;
const BASE = join(tmpdir(), `sistema-dp-test-conversas-${process.pid}`);
process.env.MIDIAS_PATH = join(BASE, 'midias');
process.env.UPLOADS_PATH = join(BASE, 'uploads');
process.env.UPDATES_PATH = join(BASE, 'atualizacoes');

const POSTGRES_URL = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.trim();
if (!POSTGRES_URL) {
  throw new Error('Defina TEST_DATABASE_URL: os testes rodam no PostgreSQL, que é o banco do sistema.');
}
const TEST_SCHEMA = 'teste_conversas';
process.env.DATABASE_URL = POSTGRES_URL;
process.env.DATABASE_SCHEMA = TEST_SCHEMA;

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

/**
 * Destranca a área do TI para uma sessão: a conta abre a tela, mas as conversas
 * só abrem depois da senha do TI.
 */
async function liberarAreaTi(token: string): Promise<void> {
  const resposta = await app.inject({
    method: 'POST',
    url: '/api/admin/conversas/liberar',
    headers: comToken(token),
    payload: { senha: SENHA_DA_AREA },
  });
  assert.equal(resposta.statusCode, 200, 'a senha do TI devia liberar a área');
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

  // A área do TI pede a senha antes de abrir conversa: os testes dela destrancam
  // uma vez aqui; a tranca em si tem os testes do fim do arquivo
  await liberarAreaTi(tokenTi);

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
    // A tela precisa do nome e do tipo para decidir entre imagem, vídeo e arquivo
    assert.equal(enviada.json().mensagem.midia.tipo, 'IMAGEM');
    assert.equal(enviada.json().mensagem.midia.nome, 'escala.png');
  });

  test('documento também pode ser anexado, e a lista traz os dados do arquivo', async () => {
    const midia = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: { ...comToken(pcMaria), 'content-type': 'application/pdf', 'x-nome': encodeURIComponent('holerite.pdf') },
      payload: Buffer.from('%PDF-1.4 arquivo de teste'),
    });
    assert.equal(midia.statusCode, 201);
    assert.equal(midia.json().tipo, 'ARQUIVO');

    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { midiaId: midia.json().id },
    });
    assert.equal(enviada.statusCode, 201);

    const lista = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcJoao),
    });
    const ultima = lista.json().mensagens.at(-1);
    assert.equal(ultima.midia.tipo, 'ARQUIVO');
    assert.equal(ultima.midia.nome, 'holerite.pdf');
    assert.equal(ultima.midia.mimeType, 'application/pdf');
    assert.ok(ultima.midia.tamanho > 0);
  });

  test('mensagem de voz: vai como mídia de áudio, com a duração, e a lista mostra "Mensagem de voz"', async () => {
    const midia = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: {
        ...comToken(pcMaria),
        // O navegador informa o codec junto: "audio/webm;codecs=opus"
        'content-type': 'audio/webm;codecs=opus',
        'x-nome': encodeURIComponent('mensagem-de-voz.webm'),
        'x-duracao': '4250',
      },
      payload: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]),
    });
    assert.equal(midia.statusCode, 201);
    assert.equal(midia.json().tipo, 'AUDIO');
    assert.equal(midia.json().mimeType, 'audio/webm');
    assert.equal(midia.json().duracaoMs, 4250);

    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { midiaId: midia.json().id },
    });
    assert.equal(enviada.statusCode, 201);

    const lista = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcJoao) });
    const conversa = lista.json().conversas.find((c: { id: string }) => c.id === conversaMariaJoao);
    assert.equal(conversa.ultimaMensagem.conteudo, '🎤 Mensagem de voz');

    const mensagens = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcJoao),
    });
    assert.equal(mensagens.json().mensagens.at(-1).midia.duracaoMs, 4250);

    // Duração absurda é ignorada, e imagem nunca guarda duração
    const imagem = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: { ...comToken(pcMaria), 'content-type': 'image/png', 'x-nome': 'a.png', 'x-duracao': '999' },
      payload: IMAGEM,
    });
    assert.equal(imagem.json().duracaoMs, null);
  });

  test('tipo de arquivo fora da lista é recusado', async () => {
    const midia = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: {
        ...comToken(pcMaria),
        'content-type': 'application/x-msdownload',
        'x-nome': encodeURIComponent('virus.exe'),
      },
      payload: Buffer.from('MZ'),
    });
    assert.equal(midia.statusCode, 415);
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

describe('procurar na conversa', () => {
  test('acha pelo texto, sem diferenciar maiúsculas, e ignora o que foi apagado', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'A escala de sábado mudou' },
    });
    const paraApagar = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'escala errada, esquece' },
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/conversas/mensagens/${paraApagar.json().mensagem.id}`,
      headers: comToken(pcMaria),
    });

    const achou = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/buscar?termo=ESCALA`,
      headers: comToken(pcJoao),
    });
    assert.equal(achou.statusCode, 200);
    const textos = achou.json().mensagens.map((m: { conteudo: string }) => m.conteudo);
    assert.ok(textos.includes('A escala de sábado mudou'));
    assert.ok(!textos.includes('escala errada, esquece'));
  });

  test('termo de uma letra é recusado, e quem não participa não procura', async () => {
    const curto = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/buscar?termo=a`,
      headers: comToken(pcMaria),
    });
    assert.equal(curto.statusCode, 400);

    // Quem não participa recebe 404, e não 403: a existência da conversa
    // não é confirmada para quem está de fora
    const deFora = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/buscar?termo=escala`,
      headers: comToken(tokenTi),
    });
    assert.equal(deFora.statusCode, 404);
  });
});

describe('encaminhar', () => {
  test('a mensagem repassada chega na outra conversa com a marca', async () => {
    const midia = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: { ...comToken(pcMaria), 'content-type': 'image/png', 'x-nome': encodeURIComponent('aviso.png') },
      payload: IMAGEM,
    });

    const paraCarla = await app.inject({
      method: 'POST',
      url: '/api/conversas/direta',
      headers: comToken(pcMaria),
      payload: { comUsuarioId: carlaId },
    });
    const conversaComCarla = paraCarla.json().id;

    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaComCarla}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'segue o aviso', midiaId: midia.json().id, encaminhada: true },
    });
    assert.equal(enviada.statusCode, 201);
    assert.equal(enviada.json().mensagem.encaminhada, true);
    // O arquivo é o mesmo: encaminhar não copia o anexo
    assert.equal(enviada.json().mensagem.midiaId, midia.json().id);

    const lista = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaComCarla}/mensagens`,
      headers: comToken(pcMaria),
    });
    assert.equal(lista.json().mensagens.at(-1).encaminhada, true);
  });

  test('mensagem escrita na hora não vem marcada', async () => {
    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'mensagem normal' },
    });
    assert.equal(enviada.json().mensagem.encaminhada, false);
  });
});

describe('responder citando', () => {
  test('a resposta carrega um pedaço da mensagem citada', async () => {
    const citada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'A reunião é às 9h ou às 10h?' },
    });
    const alvo = citada.json().mensagem.id;

    const resposta = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcJoao),
      payload: { conteudo: 'às 10h', respondeA: alvo },
    });
    assert.equal(resposta.statusCode, 201);
    assert.equal(resposta.json().mensagem.respondida.id, alvo);
    assert.equal(resposta.json().mensagem.respondida.autorNome, 'Maria Souza');
    assert.match(resposta.json().mensagem.respondida.resumo, /reunião é às 9h/);

    const lista = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcJoao),
    });
    const ultima = lista.json().mensagens.at(-1);
    assert.equal(ultima.respondeA, alvo);
    assert.equal(ultima.respondida.autorNome, 'Maria Souza');
  });

  test('a citada apagada aparece como apagada, e a de outra conversa é recusada', async () => {
    const paraApagar = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'texto que vai sumir' },
    });
    const alvo = paraApagar.json().mensagem.id;
    const resposta = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcJoao),
      payload: { conteudo: 'entendi', respondeA: alvo },
    });
    assert.equal(resposta.statusCode, 201);

    await app.inject({
      method: 'DELETE',
      url: `/api/conversas/mensagens/${alvo}`,
      headers: comToken(pcMaria),
    });
    const lista = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcJoao),
    });
    const comCitacao = lista.json().mensagens.find((m: { id: number }) => m.id === resposta.json().mensagem.id);
    assert.equal(comCitacao.respondida.apagada, true);

    // Responder mensagem de outra conversa vazaria conteúdo entre conversas
    const paraCarla = await app.inject({
      method: 'POST',
      url: '/api/conversas/direta',
      headers: comToken(pcMaria),
      payload: { comUsuarioId: carlaId },
    });
    const foraDaConversa = await app.inject({
      method: 'POST',
      url: `/api/conversas/${paraCarla.json().id}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'oi', respondeA: alvo },
    });
    assert.equal(foraDaConversa.statusCode, 400);
  });
});

describe('marca de lida', () => {
  test('a conversa mostra até onde o outro já leu', async () => {
    const conversa = async (token: string) =>
      (await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(token) })).json().conversas.find(
        (c: { id: string }) => c.id === conversaMariaJoao,
      );

    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'me avisa quando ler' },
    });
    const criadaEm = enviada.json().mensagem.createdAt;

    const antes = await conversa(pcMaria);
    assert.ok(antes.lidaAte === null || antes.lidaAte < criadaEm, 'ainda não foi lida');

    await app.inject({ method: 'POST', url: `/api/conversas/${conversaMariaJoao}/lidas`, headers: comToken(pcJoao) });
    const depois = await conversa(pcMaria);
    assert.ok(depois.lidaAte >= criadaEm, 'João já leu a última mensagem');
  });
});

describe('reações', () => {
  test('participantes reagem à mensagem: uma por pessoa, que troca, sai e some com a mensagem', async () => {
    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'Fechou a escala de outubro!' },
    });
    const id = enviada.json().mensagem.id;
    assert.deepEqual(enviada.json().mensagem.reacoes, []);
    const reagir = (token: string, emoji: string | null) =>
      app.inject({ method: 'PUT', url: `/api/conversas/mensagens/${id}/reacao`, headers: comToken(token), payload: { emoji } });
    const doJoao = async () =>
      (await app.inject({ method: 'GET', url: `/api/conversas/${conversaMariaJoao}/mensagens`, headers: comToken(pcJoao) }))
        .json()
        .mensagens.find((m: { id: number }) => m.id === id);

    assert.equal((await reagir(pcJoao, '👍')).statusCode, 200);
    assert.equal((await reagir(pcMaria, '👍')).statusCode, 200);
    let vista = await doJoao();
    assert.deepEqual(vista.reacoes.map((r: { emoji: string; total: number; minha: boolean }) => [r.emoji, r.total, r.minha]), [['👍', 2, true]]);
    assert.deepEqual([...vista.reacoes[0].nomes].sort(), ['João Lima', 'Maria Souza'].sort());

    // João troca para 😂: continua com uma reação só
    await reagir(pcJoao, '😂');
    vista = await doJoao();
    assert.deepEqual(vista.reacoes.map((r: { emoji: string; total: number; minha: boolean }) => [r.emoji, r.total, r.minha]).sort(), [['👍', 1, false], ['😂', 1, true]].sort());

    // Tira a reação; emoji fora da lista é recusado
    await reagir(pcJoao, null);
    assert.equal((await doJoao()).reacoes.length, 1);
    assert.equal((await reagir(pcJoao, '🍕')).statusCode, 400);

    // Quem não participa da conversa não reage
    const pcDeFora = await registrarPc('PC-DDDD77778888', 'd'.repeat(40));
    assert.ok([401, 404].includes((await reagir(pcDeFora, '👍')).statusCode));

    // Mensagem apagada perde as reações
    await app.inject({ method: 'DELETE', url: `/api/conversas/mensagens/${id}`, headers: comToken(pcMaria) });
    assert.deepEqual((await doJoao()).reacoes, []);
    assert.equal((await reagir(pcJoao, '👍')).statusCode, 404);
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

  test('apagada com anexo: o outro lado não recebe mais o id do arquivo', async () => {
    const midia = await app.inject({
      method: 'POST',
      url: '/api/midias',
      headers: { ...comToken(pcMaria), 'content-type': 'image/png', 'x-nome': encodeURIComponent('recibo.png') },
      payload: IMAGEM,
    });
    const midiaId = midia.json().id as string;
    const enviada = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaMariaJoao}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'o recibo', midiaId },
    });
    const id = enviada.json().mensagem.id;

    await app.inject({ method: 'DELETE', url: `/api/conversas/mensagens/${id}`, headers: comToken(pcMaria) });

    // Com o midiaId em mãos qualquer pessoa autenticada baixa o arquivo:
    // apagada tem de sair sem ele, dos dois lados da conversa
    for (const token of [pcJoao, pcMaria]) {
      const lista = (
        await app.inject({ method: 'GET', url: `/api/conversas/${conversaMariaJoao}/mensagens`, headers: comToken(token) })
      ).json().mensagens as { id: number; midiaId: string | null; midia: unknown }[];
      const apagada = lista.find((m) => m.id === id);
      assert.equal(apagada?.midiaId, null, 'mensagem apagada não pode levar o id do anexo');
      assert.equal(apagada?.midia, null, 'mensagem apagada não pode levar os dados do anexo');
    }

    // Para o TI o anexo continua: é o que permite baixar a conversa completa
    const doTi = (
      await app.inject({
        method: 'GET',
        url: `/api/admin/conversas/${conversaMariaJoao}/mensagens`,
        headers: comToken(tokenTi),
      })
    ).json().mensagens as { id: number; midiaId: string | null }[];
    assert.equal(doTi.find((m) => m.id === id)?.midiaId, midiaId);
  });
});

describe('o TI baixa a conversa', () => {
  /** Conversa própria destes testes: a de Maria e João é apagada mais adiante */
  let conversaId = '';
  const SEGREDO = 'combinado que eu nao devia ter escrito';

  before(async () => {
    const criada = await app.inject({
      method: 'POST',
      url: '/api/conversas/direta',
      headers: comToken(pcJoao),
      payload: { comUsuarioId: carlaId },
    });
    conversaId = criada.json().id;

    await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaId}/mensagens`,
      headers: comToken(pcJoao),
      payload: { conteudo: 'Carla, bom dia' },
    });
    const some = await app.inject({
      method: 'POST',
      url: `/api/conversas/${conversaId}/mensagens`,
      headers: comToken(pcJoao),
      payload: { conteudo: SEGREDO },
    });
    const apagar = await app.inject({
      method: 'DELETE',
      url: `/api/conversas/mensagens/${some.json().mensagem.id}`,
      headers: comToken(pcJoao),
    });
    assert.equal(apagar.statusCode, 204);
  });

  test('o arquivo traz o texto apagado, que a conversa não mostra mais', async () => {
    // Quem participa não lê mais: o texto saiu da coluna que as telas usam
    const paraCarla = await app.inject({
      method: 'GET',
      url: `/api/conversas/${conversaId}/mensagens`,
      headers: comToken(pcJoao),
    });
    assert.ok(!paraCarla.payload.includes(SEGREDO), 'quem participa não pode receber o texto apagado');

    const arquivo = await app.inject({
      method: 'GET',
      url: `/api/admin/conversas/${conversaId}/exportar`,
      headers: comToken(tokenTi),
    });
    assert.equal(arquivo.statusCode, 200);
    const { nome, html } = arquivo.json() as { nome: string; html: string };
    assert.match(nome, /^conversa-.*\.html$/);
    assert.ok(html.includes(SEGREDO), 'o arquivo do TI precisa trazer o texto apagado');
    assert.ok(html.includes('Carla, bom dia'), 'o arquivo precisa trazer as mensagens que ficaram');
    assert.ok(html.includes('apagada em'), 'a mensagem apagada precisa aparecer marcada');
    // Os dois lados e o setor de cada um ficam no cabeçalho do arquivo
    assert.ok(html.includes('João Lima'));
    assert.ok(html.includes('Carla'));
  });

  test('baixar conta como leitura e fica registrado', async () => {
    const acessos = await app.inject({ method: 'GET', url: '/api/admin/conversas/acessos', headers: comToken(tokenTi) });
    const registro = (acessos.json().acessos as { conversaId: string; usuarioNome: string }[]).find(
      (a) => a.conversaId === conversaId,
    );
    assert.ok(registro, 'baixar a conversa precisa ficar registrado');
    assert.equal(registro.usuarioNome, 'TI');
  });

  test('o log de apagadas diz quem apagou e com quem', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/admin/conversas/apagadas', headers: comToken(tokenTi) });
    assert.equal(resposta.statusCode, 200);
    const apagadas = resposta.json().apagadas as {
      conversaId: string;
      autorNome: string;
      apagadaPorNome: string | null;
      apagadaPorOutro: boolean;
      apagadaEm: string;
      comQuem: string;
      temTexto: boolean;
    }[];
    const linha = apagadas.find((a) => a.conversaId === conversaId);
    assert.ok(linha, 'a exclusão precisa entrar no log');
    assert.equal(linha.autorNome, 'João Lima');
    assert.equal(linha.apagadaPorNome, 'João Lima');
    assert.equal(linha.apagadaPorOutro, false);
    assert.ok(linha.apagadaEm);
    assert.ok(linha.comQuem.includes('João Lima'), 'o log precisa dizer com quem era a conversa');
    assert.equal(linha.temTexto, true);
    // O log não é caminho para o texto: para ler, o TI baixa a conversa
    assert.ok(!resposta.payload.includes(SEGREDO));
  });

  test('quem é do setor TI usa a área do TI sem login à parte', async () => {
    await app.inject({ method: 'POST', url: '/api/sectors', headers: comToken(tokenTi), payload: { name: 'TI' } });
    const suporte = await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: comToken(tokenTi),
      payload: { name: 'Rafael Costa', registration: '3100', sector: 'TI', password: 'Senha-Rafael-3100' },
    });
    assert.equal(suporte.statusCode, 201);
    const pcSuporte = await registrarPc('PC-CCCC55556666', 'c'.repeat(40));
    await app.inject({
      method: 'POST',
      url: '/api/session/login',
      headers: comToken(pcSuporte),
      payload: { registration: '3100', password: 'Senha-Rafael-3100' },
    });

    // O setor do TI abre a tela, mas não dispensa a senha da área
    const trancada = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(pcSuporte) });
    assert.equal(trancada.statusCode, 423);
    await liberarAreaTi(pcSuporte);

    // O acesso vem do setor, pelo token do computador: sem isso a tela abria vazia
    const lista = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(pcSuporte) });
    assert.equal(lista.statusCode, 200);
    assert.ok(lista.json().conversas.some((c: { id: string }) => c.id === conversaId));

    const log = await app.inject({ method: 'GET', url: '/api/admin/conversas/apagadas', headers: comToken(pcSuporte) });
    assert.equal(log.statusCode, 200);
    assert.ok((log.json().apagadas as unknown[]).length > 0);

    const arquivo = await app.inject({
      method: 'GET',
      url: `/api/admin/conversas/${conversaId}/exportar`,
      headers: comToken(pcSuporte),
    });
    assert.equal(arquivo.statusCode, 200);
    assert.ok((arquivo.json() as { html: string }).html.includes(SEGREDO));
  });

  test('funcionário não baixa conversa nem lê o log', async () => {
    const baixar = await app.inject({
      method: 'GET',
      url: `/api/admin/conversas/${conversaId}/exportar`,
      headers: comToken(pcJoao),
    });
    assert.equal(baixar.statusCode, 403);

    const log = await app.inject({ method: 'GET', url: '/api/admin/conversas/apagadas', headers: comToken(pcJoao) });
    assert.equal(log.statusCode, 403);
  });
});

describe('conta apagada', () => {
  test('a conversa direta com quem foi apagado some da lista, mas o TI continua vendo', async () => {
    const temporarioId = await criarFuncionario('Rita Alves', '3009', 'Senha-Rita-3009');
    const aberta = await app.inject({
      method: 'POST',
      url: '/api/conversas/direta',
      headers: comToken(pcMaria),
      payload: { comUsuarioId: temporarioId },
    });
    assert.equal(aberta.statusCode, 201);
    const conversaId = aberta.json().id;

    const antes = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcMaria) });
    assert.ok(antes.json().conversas.some((c: { id: string }) => c.id === conversaId));

    const apagou = await app.inject({
      method: 'DELETE',
      url: `/api/employees/${temporarioId}`,
      headers: comToken(tokenTi),
    });
    assert.equal(apagou.statusCode, 204);

    const depois = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcMaria) });
    assert.ok(!depois.json().conversas.some((c: { id: string }) => c.id === conversaId));

    // O histórico continua no banco: a área do TI ainda enxerga a conversa
    const doTi = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(tokenTi) });
    assert.ok(doTi.json().conversas.some((c: { id: string }) => c.id === conversaId));
  });

  test('em grupo, quem foi apagado sai da lista de participantes', async () => {
    const temporarioId = await criarFuncionario('Paulo Reis', '3010', 'Senha-Paulo-3010');
    const grupo = await app.inject({
      method: 'POST',
      url: '/api/conversas/grupo',
      headers: comToken(pcMaria),
      payload: { nome: 'Turno da tarde', membros: [joaoId, temporarioId] },
    });
    assert.equal(grupo.statusCode, 201);
    const grupoId = grupo.json().id;

    await app.inject({ method: 'DELETE', url: `/api/employees/${temporarioId}`, headers: comToken(tokenTi) });

    const lista = await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcMaria) });
    const resumo = lista.json().conversas.find((c: { id: string }) => c.id === grupoId);
    assert.ok(resumo, 'o grupo continua na lista');
    assert.ok(!resumo.participantes.some((p: { removido: boolean }) => p.removido));
    assert.equal(resumo.participantes.length, 2);
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

describe('DP/TI que só recebe mensagem do DP e do TI', () => {
  let pcLivia: string;
  let liviaId = '';
  let conversaMariaLivia = '';

  const pedir = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object) =>
    app.inject({ method, url, headers: comToken(token), payload });

  before(async () => {
    await pedir('POST', '/api/sectors', tokenTi, { name: 'Departamento Pessoal' });
    const criada = await pedir('POST', '/api/employees', tokenTi, {
      name: 'Lívia Rocha',
      registration: 'liviadp',
      sector: 'Departamento Pessoal',
      password: 'Senha-Livia-3004',
    });
    assert.equal(criada.statusCode, 201);
    liviaId = criada.json().employee.id;
    pcLivia = await registrarPc('PC-CCCC55556666', 'c'.repeat(40));
    await pedir('POST', '/api/session/login', pcLivia, { registration: 'liviadp', password: 'Senha-Livia-3004' });

    // Conversa aberta antes de a Lívia ligar a opção
    conversaMariaLivia = (await pedir('POST', '/api/conversas/direta', pcMaria, { comUsuarioId: liviaId })).json().id;
  });

  test('só quem é do DP/TI pode ligar a opção', async () => {
    const joao = await pedir('GET', '/api/conversas/preferencias', pcJoao);
    assert.deepEqual(joao.json(), { podeRestringir: false, mensagensSoDpTi: false });
    assert.equal((await pedir('PUT', '/api/conversas/preferencias', pcJoao, { mensagensSoDpTi: true })).statusCode, 403);

    const ligada = await pedir('PUT', '/api/conversas/preferencias', pcLivia, { mensagensSoDpTi: true });
    assert.equal(ligada.statusCode, 200);
    assert.deepEqual(ligada.json(), { podeRestringir: true, mensagensSoDpTi: true });
  });

  test('funcionário comum não vê, não escreve e não põe em grupo', async () => {
    const contatos = (await pedir('GET', '/api/contatos', pcMaria)).json().contatos as { id: string }[];
    assert.ok(!contatos.some((c) => c.id === liviaId));

    const naConversa = await pedir('POST', `/api/conversas/${conversaMariaLivia}/mensagens`, pcMaria, { conteudo: 'Oi' });
    assert.equal(naConversa.statusCode, 403);
    assert.equal(naConversa.json().error, 'SO_DP_TI');
    assert.equal((await pedir('POST', '/api/conversas/direta', pcMaria, { comUsuarioId: liviaId })).statusCode, 403);
    assert.equal(
      (await pedir('POST', '/api/conversas/grupo', pcMaria, { nome: 'Com a Lívia', membros: [joaoId, liviaId] })).statusCode,
      403,
    );
  });

  test('o TI continua conversando com ela', async () => {
    const contatos = (await pedir('GET', '/api/contatos', tokenTi)).json().contatos as { id: string }[];
    assert.ok(contatos.some((c) => c.id === liviaId));
    const direta = await pedir('POST', '/api/conversas/direta', tokenTi, { comUsuarioId: liviaId });
    assert.equal(direta.statusCode, 201);
    const enviada = await pedir('POST', `/api/conversas/${direta.json().id}/mensagens`, tokenTi, { conteudo: 'Tudo certo?' });
    assert.equal(enviada.statusCode, 201);
  });

  test('desligando, todo mundo volta a escrever', async () => {
    await pedir('PUT', '/api/conversas/preferencias', pcLivia, { mensagensSoDpTi: false });
    const enviada = await pedir('POST', `/api/conversas/${conversaMariaLivia}/mensagens`, pcMaria, { conteudo: 'Oi' });
    assert.equal(enviada.statusCode, 201);
  });

  test('resposta automática de quem é do DP pelo setor (sem conta da Central)', async () => {
    const regra = await pedir('POST', '/api/auto-replies', pcLivia, {
      sector: null,
      content: 'Olá, {primeiro_nome}! Aqui é a {nome_dp}, já respondo.',
      active: true,
    });
    assert.equal(regra.statusCode, 201);

    await pedir('POST', `/api/conversas/${conversaMariaLivia}/mensagens`, pcMaria, { conteudo: 'Tudo bem?' });
    const mensagens = (await pedir('GET', `/api/conversas/${conversaMariaLivia}/mensagens`, pcMaria)).json().mensagens as {
      autorId: string;
      conteudo: string;
      automatica: boolean;
    }[];
    const automatica = mensagens.find((m) => m.automatica);
    assert.ok(automatica, 'a resposta automática não chegou');
    assert.equal(automatica.autorId, liviaId);
    assert.equal(automatica.conteudo, 'Olá, Maria! Aqui é a Lívia Rocha, já respondo.');

    // Entre duas pessoas da equipe do DP/TI não há resposta automática
    const direta = (await pedir('POST', '/api/conversas/direta', tokenTi, { comUsuarioId: liviaId })).json();
    await pedir('POST', `/api/conversas/${direta.id}/mensagens`, tokenTi, { conteudo: 'Oi Lívia' });
    const doTi = (await pedir('GET', `/api/conversas/${direta.id}/mensagens`, tokenTi)).json().mensagens as { automatica: boolean }[];
    assert.ok(!doTi.some((m) => m.automatica));
  });
});

describe('senha do TI para abrir a área de conversas', () => {
  /** Sessão só desta suíte: trancar aqui não atrapalha os outros testes */
  let sessao = '';
  let pcBruna = '';
  let conversaQualquer = '';

  /** Todas as rotas da área do TI, para conferir que nenhuma escapa da tranca */
  const rotasDoTi = (conversaId: string): { metodo: 'GET' | 'DELETE'; url: string }[] => [
    { metodo: 'GET', url: '/api/admin/conversas' },
    { metodo: 'GET', url: '/api/admin/conversas/acessos' },
    { metodo: 'GET', url: '/api/admin/conversas/apagadas' },
    { metodo: 'GET', url: `/api/admin/conversas/${conversaId}/mensagens` },
    { metodo: 'GET', url: `/api/admin/conversas/${conversaId}/exportar` },
    { metodo: 'DELETE', url: `/api/admin/conversas/${conversaId}` },
  ];

  before(async () => {
    sessao = (
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ti', password: SENHA_TI } })
    ).json().token;

    // Alguém do DP (não do TI): tem conta administrativa, mas não é desta área.
    // O setor pode já existir de outra suíte: o status não importa aqui
    await app.inject({
      method: 'POST',
      url: '/api/sectors',
      headers: comToken(tokenTi),
      payload: { name: 'Departamento Pessoal' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/employees',
      headers: comToken(tokenTi),
      payload: { name: 'Bruna Dias', registration: 'brunadp', sector: 'Departamento Pessoal', password: 'Senha-Bruna-3011' },
    });
    pcBruna = await registrarPc('PC-DDDD77778888', 'd'.repeat(40));
    await app.inject({
      method: 'POST',
      url: '/api/session/login',
      headers: comToken(pcBruna),
      payload: { registration: 'brunadp', password: 'Senha-Bruna-3011' },
    });

    conversaQualquer = (
      await app.inject({
        method: 'POST',
        url: '/api/conversas/direta',
        headers: comToken(pcMaria),
        payload: { comUsuarioId: carlaId },
      })
    ).json().id;
  });

  test('sem a senha, nenhuma rota da área do TI responde', async () => {
    for (const rota of rotasDoTi(conversaQualquer)) {
      const resposta = await app.inject({ method: rota.metodo, url: rota.url, headers: comToken(sessao) });
      assert.equal(resposta.statusCode, 423, `${rota.metodo} ${rota.url} abriu sem a senha`);
      assert.equal(resposta.json().error, 'AREA_TI_TRANCADA');
    }
  });

  test('senha errada não libera', async () => {
    const errada = await app.inject({
      method: 'POST',
      url: '/api/admin/conversas/liberar',
      headers: comToken(sessao),
      payload: { senha: 'nao-e-essa' },
    });
    assert.equal(errada.statusCode, 401);
    assert.equal(errada.json().error, 'SENHA_TI_INVALIDA');

    const continua = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(sessao) });
    assert.equal(continua.statusCode, 423);
  });

  test('com a senha abre, e o botão Trancar fecha de novo', async () => {
    const liberada = await app.inject({
      method: 'POST',
      url: '/api/admin/conversas/liberar',
      headers: comToken(sessao),
      payload: { senha: SENHA_DA_AREA },
    });
    assert.equal(liberada.statusCode, 200);
    assert.ok(new Date(liberada.json().validoAte).getTime() > Date.now(), 'a liberação precisa dizer até quando vale');

    const aberta = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(sessao) });
    assert.equal(aberta.statusCode, 200);

    const trancou = await app.inject({ method: 'DELETE', url: '/api/admin/conversas/liberar', headers: comToken(sessao) });
    assert.equal(trancou.statusCode, 204);
    const depois = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(sessao) });
    assert.equal(depois.statusCode, 423);
  });

  test('a liberação é de uma sessão só: outra conta do TI digita a sua', async () => {
    await liberarAreaTi(sessao);
    const outra = (
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ti', password: SENHA_TI } })
    ).json().token;

    const tentativa = await app.inject({ method: 'GET', url: '/api/admin/conversas', headers: comToken(outra) });
    assert.equal(tentativa.statusCode, 423, 'a senha de uma sessão não vale para outra');
  });

  test('quem é do DP mas não do TI não entra nem tentando a senha', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: '/api/admin/conversas/liberar',
      headers: comToken(pcBruna),
      payload: { senha: SENHA_DA_AREA },
    });
    assert.equal(tentativa.statusCode, 403);
  });

  test('funcionário comum nem chega na tranca', async () => {
    const tentativa = await app.inject({
      method: 'POST',
      url: '/api/admin/conversas/liberar',
      headers: comToken(pcMaria),
      payload: { senha: SENHA_DA_AREA },
    });
    assert.equal(tentativa.statusCode, 403);
  });
});

describe('limpeza de conversas pelo TI', () => {
  test('"apagar conversas" sem escolher pessoa limpa também as conversas entre funcionários', async () => {
    const direta = (
      await app.inject({ method: 'POST', url: '/api/conversas/direta', headers: comToken(pcMaria), payload: { comUsuarioId: carlaId } })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/conversas/${direta.id}/mensagens`,
      headers: comToken(pcMaria),
      payload: { conteudo: 'Carla, amanhã eu chego mais cedo.' },
    });

    const limpeza = await app.inject({
      method: 'POST',
      url: '/api/admin/chats/purge',
      headers: comToken(tokenTi),
      payload: { dpUserId: null, olderThanDays: null },
    });
    assert.equal(limpeza.statusCode, 200);
    assert.ok(limpeza.json().removed > 0);

    // "Apagar tudo" tira a conversa da lista (antes ficava lá, vazia, e parecia que não tinha apagado)
    const depois = await app.inject({ method: 'GET', url: `/api/conversas/${direta.id}/mensagens`, headers: comToken(pcMaria) });
    assert.equal(depois.statusCode, 404);
    const lista = (await app.inject({ method: 'GET', url: '/api/conversas', headers: comToken(pcMaria) })).json().conversas;
    assert.ok(!lista.some((c: { id: string }) => c.id === direta.id));
  });
});
