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

/**
 * Mensagem de erro de uma resposta. Quando a rota nem existe no servidor, o
 * backend responde "Rota PATCH /api/... não encontrada": nesse caso o
 * problema não é a versão, é o servidor estar desatualizado, e a tela precisa
 * dizer isso em vez de "não encontrada".
 */
function erroDaResposta(resposta, quando) {
  const mensagem = resposta.json?.message ?? '';
  if (resposta.status === 404 && /^Rota /.test(mensagem)) {
    return { ok: false, servidorAntigo: true, erro: 'Este servidor ainda não tem essa função. Publique primeiro o pacote do servidor, na aba Servidor.' };
  }
  return { ok: false, erro: mensagem || `${quando} (HTTP ${resposta.status})` };
}

/** Liga ou desliga a obrigatoriedade de uma versão já publicada. */
async function marcarObrigatoria(servidor, token, alvo, versao, obrigatoria) {
  const resposta = await pedirJson(servidor, `/api/atualizacoes/${alvo}/${versao}`, {
    metodo: 'PATCH',
    corpo: { obrigatoria },
    token,
  });
  if (resposta.status !== 200) return erroDaResposta(resposta, 'Falha ao mudar a versão');
  return { ok: true, release: resposta.json };
}

/** Manda todos os aparelhos conectados conferirem a atualização agora. */
async function avisarTodos(servidor, token, alvo) {
  const resposta = await pedirJson(servidor, `/api/atualizacoes/${alvo}/avisar`, { metodo: 'POST', token });
  if (resposta.status !== 200) return erroDaResposta(resposta, 'Falha ao avisar os aparelhos');
  return { ok: true, ...resposta.json };
}

/**
 * Aparelhos cadastrados (PCs e celulares), com a versão que cada um tem
 * instalada. É com isso que a tela mostra quem ficou atrás.
 */
async function listarAparelhos(servidor, token) {
  const resposta = await pedirJson(servidor, '/api/computers', { token });
  if (resposta.status !== 200) {
    return { ok: false, erro: resposta.json?.message ?? `Falha ao listar os aparelhos (HTTP ${resposta.status})` };
  }
  return { ok: true, aparelhos: resposta.json?.computers ?? [] };
}

async function remover(servidor, token, alvo, versao) {
  const resposta = await pedirJson(servidor, `/api/atualizacoes/${alvo}/${versao}`, { metodo: 'DELETE', token });
  if (resposta.status !== 204) {
    return { ok: false, erro: resposta.json?.message ?? `Falha ao remover (HTTP ${resposta.status})` };
  }
  return { ok: true };
}

/**
 * Servidor de pé? Devolve também quanto demorou para responder e qual versão
 * subiu — é como se confere, sem entrar no servidor, que a troca pegou.
 */
async function saude(servidor) {
  const comecou = Date.now();
  try {
    const resposta = await pedirJson(servidor, '/api/health');
    const ms = Date.now() - comecou;
    if (resposta.status !== 200) return { ok: false, ms, erro: `HTTP ${resposta.status}` };
    return {
      ok: true,
      ms,
      // Servidor anterior ao 1.27.0 não informa nenhum dos dois
      versao: resposta.json?.versao ?? null,
      desde: resposta.json?.desde ?? null,
    };
  } catch (err) {
    return { ok: false, ms: Date.now() - comecou, erro: err.message };
  }
}

/**
 * Espera o servidor responder de novo. Usada depois de publicar o pacote do
 * backend: ele aplica a versão e reinicia, então some por alguns segundos.
 */
async function esperarServidor(servidor, { tentativas = 40, intervaloMs = 1500 } = {}) {
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      const resposta = await pedirJson(servidor, '/api/health');
      // Era "resposta.ok", que pedirJson nunca devolve: a espera ia até o fim
      // das 40 tentativas e dizia que o servidor não voltou, mesmo de pé.
      if (resposta.status === 200) {
        return { ok: true, tentativas: tentativa, versao: resposta.json?.versao ?? null };
      }
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }
  return { ok: false, erro: 'O servidor não voltou a responder. Veja os logs do container.' };
}

module.exports = {
  entrar,
  saude,
  listar,
  publicar,
  remover,
  esperarServidor,
  marcarObrigatoria,
  avisarTodos,
  listarAparelhos,
};
