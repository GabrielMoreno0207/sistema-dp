import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { AppError } from '../../errors/app-error';
import { requireAdmin, requireSuperAdmin } from '../auth/principal';
import type { UpdateService } from './update.service';
import { APPS, isAppName, LIMITES, type AppName } from './update.types';

const appParamsSchema = {
  type: 'object',
  required: ['app'],
  properties: { app: { type: 'string', enum: [...APPS] } },
} as const;

const appVersaoParamsSchema = {
  type: 'object',
  required: ['app', 'versao'],
  properties: {
    app: { type: 'string', enum: [...APPS] },
    versao: { type: 'string', pattern: LIMITES.versaoPattern },
  },
} as const;

const verificarQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { versao: { type: 'string', pattern: LIMITES.versaoPattern } },
} as const;

/** Cabeçalho de texto (valores com acento vão codificados com encodeURIComponent). */
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

function appDaRota(request: FastifyRequest): AppName {
  const { app } = request.params as { app: string };
  if (!isAppName(app)) throw new AppError(`Aplicativo desconhecido: ${app}`, 404, 'APP_DESCONHECIDO');
  return app;
}

export interface UpdateRoutesOptions {
  updates: UpdateService;
}

export const updateRoutes: FastifyPluginAsync<UpdateRoutesOptions> = async (app, { updates }) => {
  /**
   * O app pergunta se existe versão mais nova que a dele.
   * Vale para computador registrado e para quem está logado na Central.
   */
  app.get('/atualizacoes/:app/verificar', { schema: { params: appParamsSchema, querystring: verificarQuerySchema } }, async (request) => {
    if (!request.principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    const { versao } = request.query as { versao?: string };
    return updates.verificar(appDaRota(request), versao ?? null);
  });

  /** Download do instalador/APK da versão. */
  app.get('/atualizacoes/:app/download/:versao', { schema: { params: appVersaoParamsSchema } }, async (request, reply) => {
    if (!request.principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    const { versao } = request.params as { versao: string };
    const { release, conteudo } = await updates.abrirDownload(appDaRota(request), versao);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Length', String(release.tamanho));
    reply.header('Content-Disposition', `attachment; filename="${release.arquivo}"`);
    // O app confere o arquivo baixado com este hash antes de instalar
    reply.header('X-Sha256', release.sha256);
    return reply.send(conteudo);
  });

  /** Versões publicadas de um aplicativo (tela do versionador). */
  app.get('/atualizacoes/:app', { schema: { params: appParamsSchema } }, async (request) => {
    requireAdmin(request);
    return { releases: await updates.listar(appDaRota(request)) };
  });

  /**
   * Publica uma versão. O arquivo vem como corpo binário puro e os dados da
   * versão em cabeçalhos, no mesmo formato usado pelos anexos dos comunicados.
   */
  app.post('/atualizacoes/:app', { schema: { params: appParamsSchema } }, async (request, reply) => {
    const admin = requireSuperAdmin(request);
    const alvo = appDaRota(request);
    const corpo = request.body as Readable | undefined;
    if (!corpo || typeof (corpo as Readable).pipe !== 'function') {
      throw new AppError(
        'Envie o arquivo como corpo binário, com Content-Type: application/vnd.dp-atualizacao.',
        400,
        'CORPO_INVALIDO',
      );
    }

    const release = await updates.publicar(
      alvo,
      {
        versao: header(request, 'x-versao'),
        arquivo: header(request, 'x-arquivo'),
        notas: header(request, 'x-notas'),
        obrigatoria: header(request, 'x-obrigatoria') === 'true',
        publicadoPor: admin.name,
      },
      corpo,
    );
    return reply.code(201).send(release);
  });

  /** Tira uma versão do ar (o arquivo é apagado do servidor). */
  app.delete('/atualizacoes/:app/:versao', { schema: { params: appVersaoParamsSchema } }, async (request, reply) => {
    const admin = requireSuperAdmin(request);
    const { versao } = request.params as { versao: string };
    await updates.remover(appDaRota(request), versao, admin.name);
    return reply.code(204).send();
  });
};
