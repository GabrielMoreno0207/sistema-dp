import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { AppError } from '../../errors/app-error';
import { requireAdmin, requireComputer } from '../auth/principal';
import type { ContentService } from './content.service';
import { ATALHO_ID_PATTERN, DESTINOS, LIMITES_CONTEUDO, MIDIA_ID_PATTERN, MURAL_ID_PATTERN } from './content.types';

const adminOnly = { onRequest: async (request: FastifyRequest) => void requireAdmin(request) };
const computerOnly = { onRequest: async (request: FastifyRequest) => void requireComputer(request) };

const midiaParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: MIDIA_ID_PATTERN } },
} as const;

const muralParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: MURAL_ID_PATTERN } },
} as const;

const atalhoParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: ATALHO_ID_PATTERN } },
} as const;

const muralBody = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'texto'],
  properties: {
    titulo: { type: 'string', minLength: 1, maxLength: LIMITES_CONTEUDO.maxTitulo },
    texto: { type: 'string', minLength: 1, maxLength: LIMITES_CONTEUDO.maxTexto },
    midiaId: { type: ['string', 'null'], pattern: MIDIA_ID_PATTERN },
    ativo: { type: 'boolean' },
  },
} as const;

const atalhoBody = {
  type: 'object',
  additionalProperties: false,
  required: ['rotulo', 'icone', 'cor', 'destino'],
  properties: {
    rotulo: { type: 'string', minLength: 1, maxLength: LIMITES_CONTEUDO.maxRotulo },
    icone: { type: 'string', minLength: 1, maxLength: 8 },
    cor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    destino: { type: 'string', enum: [...DESTINOS] },
  },
} as const;

const ordemBody = {
  type: 'object',
  additionalProperties: false,
  required: ['ids'],
  properties: {
    ids: { type: 'array', maxItems: LIMITES_CONTEUDO.atalhosPorUsuario, items: { type: 'string', pattern: ATALHO_ID_PATTERN } },
  },
} as const;

const fotoBody = {
  type: 'object',
  additionalProperties: false,
  required: ['midiaId'],
  properties: { midiaId: { type: 'string', pattern: MIDIA_ID_PATTERN } },
} as const;

/** Cabeçalho de texto (nome do arquivo vem com encodeURIComponent). */
function header(request: FastifyRequest, nome: string): string {
  const valor = request.headers[nome];
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  if (typeof bruto !== 'string') return '';
  try {
    return decodeURIComponent(bruto);
  } catch {
    return bruto;
  }
}

/**
 * Interpreta o cabeçalho Range ("bytes=0-1023"), que o player de vídeo usa para
 * pular para o meio do arquivo. Fora do formato ou fora do arquivo: null.
 */
export function faixaPedida(range: string | undefined, tamanho: number): { inicio: number; fim: number } | null {
  if (!range) return null;
  const achado = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!achado) return null;
  const [, cru1, cru2] = achado;
  if (cru1 === '' && cru2 === '') return null;

  // "bytes=-500" = os últimos 500 bytes
  const inicio = cru1 === '' ? Math.max(tamanho - Number(cru2), 0) : Number(cru1);
  const fim = cru1 === '' ? tamanho - 1 : cru2 === '' ? tamanho - 1 : Math.min(Number(cru2), tamanho - 1);
  if (Number.isNaN(inicio) || Number.isNaN(fim) || inicio > fim || inicio >= tamanho) return null;
  return { inicio, fim };
}

export const contentRoutes: FastifyPluginAsync<{ content: ContentService }> = async (app, { content }) => {
  // ---------------------------------------------------------------- mídias

  /**
   * Envio de imagem ou vídeo. O arquivo vem como corpo binário puro, com o tipo
   * real em Content-Type e o nome original em X-Nome.
   */
  app.post('/midias', async (request, reply) => {
    const principal = request.principal;
    if (!principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    const corpo = request.body as Readable | undefined;
    if (!corpo || typeof corpo.pipe !== 'function') {
      throw new AppError('Envie o arquivo como corpo binário, com o Content-Type da mídia.', 400, 'CORPO_INVALIDO');
    }

    const midia = await content.enviarMidia(
      {
        mimeType: String(request.headers['content-type'] ?? '').split(';')[0].trim(),
        nome: header(request, 'x-nome'),
        enviadoPor: principal.type === 'ADMIN' ? principal.name : principal.computerId,
      },
      corpo,
    );
    return reply.code(201).send(midia);
  });

  /**
   * Entrega a imagem ou o vídeo. Aceita Range: sem isso o vídeo só tocaria do
   * começo, sem a pessoa conseguir arrastar a barra.
   */
  app.get('/midias/:id', { schema: { params: midiaParams } }, async (request, reply) => {
    if (!request.principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    const { id } = request.params as { id: string };
    const { midia, tamanho } = await content.abrirMidia(id);

    reply.header('Content-Type', midia.mimeType);
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', 'private, max-age=86400');

    const faixa = faixaPedida(request.headers.range, tamanho);
    if (!faixa) {
      reply.header('Content-Length', String(tamanho));
      return reply.send(content.fluxoDaMidia(midia));
    }

    reply.code(206);
    reply.header('Content-Range', `bytes ${faixa.inicio}-${faixa.fim}/${tamanho}`);
    reply.header('Content-Length', String(faixa.fim - faixa.inicio + 1));
    return reply.send(content.fluxoDaMidia(midia, faixa.inicio, faixa.fim));
  });

  // ---------------------------------------------------------------- mural

  /** O recado em exibição (aplicativo e Central). */
  app.get('/mural', async (request) => {
    if (!request.principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    return { post: await content.muralAtivo() };
  });

  /** Histórico de recados (só o DP). */
  app.get('/mural/todos', adminOnly, async () => ({ posts: await content.listarMural() }));

  app.post('/mural', { ...adminOnly, schema: { body: muralBody } }, async (request, reply) => {
    const admin = requireAdmin(request);
    const body = request.body as { titulo: string; texto: string; midiaId?: string | null; ativo?: boolean };
    const post = await content.criarMural(
      { titulo: body.titulo, texto: body.texto, midiaId: body.midiaId ?? null, ativo: body.ativo ?? true },
      admin.name,
    );
    return reply.code(201).send(post);
  });

  app.put('/mural/:id', { ...adminOnly, schema: { params: muralParams, body: muralBody } }, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { titulo: string; texto: string; midiaId?: string | null; ativo?: boolean };
    return content.atualizarMural(id, {
      titulo: body.titulo,
      texto: body.texto,
      midiaId: body.midiaId ?? null,
      ativo: body.ativo ?? true,
    });
  });

  app.delete('/mural/:id', { ...adminOnly, schema: { params: muralParams } }, async (request, reply) => {
    await content.removerMural((request.params as { id: string }).id);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- atalhos do colaborador

  app.get('/atalhos', computerOnly, async (request) => ({
    atalhos: await content.listarAtalhos(requireComputer(request)),
  }));

  app.post('/atalhos', { ...computerOnly, schema: { body: atalhoBody } }, async (request, reply) => {
    const atalho = await content.criarAtalho(requireComputer(request), request.body as never);
    return reply.code(201).send(atalho);
  });

  app.put('/atalhos/ordem', { ...computerOnly, schema: { body: ordemBody } }, async (request) => ({
    atalhos: await content.reordenarAtalhos(requireComputer(request), (request.body as { ids: string[] }).ids),
  }));

  app.put('/atalhos/:id', { ...computerOnly, schema: { params: atalhoParams, body: atalhoBody } }, async (request) =>
    content.atualizarAtalho(requireComputer(request), (request.params as { id: string }).id, request.body as never),
  );

  app.delete('/atalhos/:id', { ...computerOnly, schema: { params: atalhoParams } }, async (request, reply) => {
    await content.removerAtalho(requireComputer(request), (request.params as { id: string }).id);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- foto de perfil

  app.put('/perfil/foto', { ...computerOnly, schema: { body: fotoBody } }, async (request) => ({
    foto: await content.definirFotoDoFuncionario(requireComputer(request), (request.body as { midiaId: string }).midiaId),
  }));

  app.delete('/perfil/foto', computerOnly, async (request, reply) => {
    await content.removerFotoDoFuncionario(requireComputer(request));
    return reply.code(204).send();
  });
};
