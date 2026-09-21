// Conversa com o backend. Fica fora do main.js (sem Electron) para poder ser
// testado com Node puro: node testar-api.js
const { createReadStream, statSync } = require('node:fs');
const { basename } = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

/** Requisição JSON simples (login, listar, remover). */
function pedirJson(servidor, caminho, { metodo = 'GET', corpo = null, token = null } = {}) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(caminho, servidor);
    const transporte = alvo.protocol === 'https:' ? https : http;
    const dados = corpo ? Buffer.from(JSON.stringify(corpo)) : null;
    const requisicao = transporte.request(
      alvo,
      {
        method: metodo,
        headers: {
          ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        timeout: 30_000,
      },
      (resposta) => juntarResposta(resposta, resolve),
    );
    requisicao.on('timeout', () => requisicao.destroy(new Error('O servidor não respondeu em 30 segundos.')));
    requisicao.on('error', reject);
    if (dados) requisicao.write(dados);
    requisicao.end();
  });
}

function juntarResposta(resposta, resolve) {
  let texto = '';
  resposta.on('data', (parte) => (texto += parte));
  resposta.on('end', () => {
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    resolve({ status: resposta.statusCode ?? 0, json, texto });
  });
}

/** Envio do instalador: vai como fluxo, sem carregar o arquivo inteiro na memória. */
function enviarArquivo(servidor, token, alvo, dadosVersao, onProgresso = () => {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/api/atualizacoes/${alvo}`, servidor);
    const transporte = url.protocol === 'https:' ? https : http;
    const tamanho = statSync(dadosVersao.caminho).size;
    let enviado = 0;

    const requisicao = transporte.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.dp-atualizacao',
          'Content-Length': tamanho,
          'X-Versao': dadosVersao.versao,
          'X-Arquivo': basename(dadosVersao.caminho),
          'X-Notas': encodeURIComponent(dadosVersao.notas ?? ''),
          'X-Obrigatoria': dadosVersao.obrigatoria ? 'true' : 'false',
        },
      },
      (resposta) => juntarResposta(resposta, resolve),
    );
    requisicao.on('error', reject);

    const leitura = createReadStream(dadosVersao.caminho);
    leitura.on('data', (parte) => {
      enviado += parte.length;
      onProgresso(Math.round((enviado / tamanho) * 100));
    });
    leitura.on('error', reject);
    leitura.pipe(requisicao);
  });
}

async function entrar(servidor, usuario, senha) {
  const resposta = await pedirJson(servidor, '/api/auth/login', {
    metodo: 'POST',
    corpo: { username: usuario, password: senha },
  });
  if (resposta.status !== 200 || !resposta.json?.token) {
    return { ok: false, erro: resposta.json?.message ?? `Falha no login (HTTP ${resposta.status})` };
  }
  if (!resposta.json.user?.superAdmin) {
    return { ok: false, erro: 'Esta conta não é do TI. Só a conta do TI publica versões.' };
  }
  return { ok: true, token: resposta.json.token, nome: resposta.json.user?.name ?? usuario };
}

async function listar(servidor, token, alvo) {
  const resposta = await pedirJson(servidor, `/api/atualizacoes/${alvo}`, { token });
  if (resposta.status !== 200) {
    return { ok: false, erro: resposta.json?.message ?? `Falha ao listar (HTTP ${resposta.status})` };
  }
  return { ok: true, releases: resposta.json?.releases ?? [] };
}

async function publicar(servidor, token, alvo, dadosVersao, onProgresso) {
  try {
    const resposta = await enviarArquivo(servidor, token, alvo, dadosVersao, onProgresso);
    if (resposta.status !== 201) {
      return { ok: false, erro: resposta.json?.message ?? `Falha ao publicar (HTTP ${resposta.status})` };
    }
    return { ok: true, release: resposta.json };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

async function remover(servidor, token, alvo, versao) {
  const resposta = await pedirJson(servidor, `/api/atualizacoes/${alvo}/${versao}`, { metodo: 'DELETE', token });
  if (resposta.status !== 204) {
    return { ok: false, erro: resposta.json?.message ?? `Falha ao remover (HTTP ${resposta.status})` };
  }
  return { ok: true };
}

module.exports = { entrar, listar, publicar, remover };
