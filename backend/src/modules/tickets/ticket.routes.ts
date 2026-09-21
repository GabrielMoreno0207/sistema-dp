import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error';
import { requireAdmin, requireComputer } from '../auth/principal';
import { MIDIA_ID_PATTERN } from '../content/content.types';
import type { Solicitante, TicketService } from './ticket.service';
import { CATEGORIAS, CHAMADO_ID_PATTERN, LIMITES_CHAMADO, PRIORIDADES, STATUS } from './ticket.types';

const chamadoParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: CHAMADO_ID_PATTERN } },
} as const;

const novoChamadoBody = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'descricao', 'categoria'],
  properties: {
    titulo: { type: 'string', minLength: 1, maxLength: LIMITES_CHAMADO.maxTitulo },
    descricao: { type: 'string', minLength: 1, maxLength: LIMITES_CHAMADO.maxDescricao },
    categoria: { type: 'string', enum: [...CATEGORIAS] },
    prioridade: { type: 'string', enum: [...PRIORIDADES] },
    midiaIds: { type: 'array', maxItems: LIMITES_CHAMADO.maxMidias, items: { type: 'string', pattern: MIDIA_ID_PATTERN } },
  },
} as const;

const mensagemBody = {
  type: 'object',
  additionalProperties: false,
  required: ['conteudo'],
  properties: { conteudo: { type: 'string', minLength: 1, maxLength: LIMITES_CHAMADO.maxMensagem } },
} as const;

const statusBody = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: [...STATUS] } },
} as const;

const filaQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { encerrados: { type: 'string', enum: ['true', 'false'] } },
} as const;

export interface TicketRoutesOptions {
  tickets: TicketService;
}

export const ticketRoutes: FastifyPluginAsync<TicketRoutesOptions> = async (app, { tickets }) => {
  /**
   * Quem está falando: o funcionário logado no PC ou alguém do DP na Central.
   * O TI é reconhecido pelo superAdmin, que já é a conta com poderes extras.
   */
  async function quemEstaAgindo(request: FastifyRequest): Promise<Solicitante> {
    const principal = request.principal;
    if (!principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    if (principal.type === 'COMPUTER') return tickets.solicitanteDoPc(principal.computerId);
    return { tipo: 'ADMIN', id: principal.userId, nome: principal.name, ti: principal.superAdmin };
  }

  /** Abre um chamado (funcionário no app ou pessoa do DP na Central). */
  app.post('/chamados', { schema: { body: novoChamadoBody } }, async (request, reply) => {
    const quem = await quemEstaAgindo(request);
    const body = request.body as {
      titulo: string;
      descricao: string;
      categoria: (typeof CATEGORIAS)[number];
      prioridade?: (typeof PRIORIDADES)[number];
      midiaIds?: string[];
    };
    const chamado = await tickets.abrir(quem, {
      titulo: body.titulo,
      descricao: body.descricao,
      categoria: body.categoria,
      prioridade: body.prioridade ?? 'NORMAL',
      midiaIds: body.midiaIds ?? [],
    });
    return reply.code(201).send(chamado);
  });

  /** Meus chamados (quem abriu). */
  app.get('/chamados', async (request) => ({
    chamados: await tickets.listarDoSolicitante(await quemEstaAgindo(request)),
  }));

  /** Fila do TI: todos os chamados. */
  app.get('/chamados/fila', { schema: { querystring: filaQuery } }, async (request) => {
    const admin = requireAdmin(request);
    if (!admin.superAdmin) throw new AppError('Acesso permitido apenas ao TI', 403, 'FORBIDDEN');
    const { encerrados } = request.query as { encerrados?: string };
    return { chamados: await tickets.listarParaTi(encerrados === 'true') };
  });

  app.get('/chamados/:id', { schema: { params: chamadoParams } }, async (request) => {
    const quem = await quemEstaAgindo(request);
    const { id } = request.params as { id: string };
    return tickets.detalhe(id, quem);
  });

  app.post('/chamados/:id/mensagens', { schema: { params: chamadoParams, body: mensagemBody } }, async (request, reply) => {
    const quem = await quemEstaAgindo(request);
    const { id } = request.params as { id: string };
    const { conteudo } = request.body as { conteudo: string };
    return reply.code(201).send({ mensagem: await tickets.responder(id, quem, conteudo) });
  });

  app.put('/chamados/:id/status', { schema: { params: chamadoParams, body: statusBody } }, async (request) => {
    const quem = await quemEstaAgindo(request);
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: (typeof STATUS)[number] };
    return tickets.mudarStatus(id, quem, status);
  });

  app.post('/chamados/:id/lidas', { schema: { params: chamadoParams } }, async (request) => {
    const quem = await quemEstaAgindo(request);
    const { id } = request.params as { id: string };
    return { marcadas: await tickets.marcarLidas(id, quem) };
  });

  app.delete('/chamados/:id', { schema: { params: chamadoParams } }, async (request, reply) => {
    const quem = await quemEstaAgindo(request);
    const { id } = request.params as { id: string };
    await tickets.remover(id, quem);
    return reply.code(204).send();
  });

  // Rota separada para o app: o PC precisa saber se há resposta nova sem abrir a lista
  app.get('/chamados/resumo', async (request) => {
    const computerId = requireComputer(request);
    const quem = await tickets.solicitanteDoPc(computerId);
    const meus = await tickets.listarDoSolicitante(quem);
    return {
      total: meus.length,
      emAberto: meus.filter((c) => c.status === 'ABERTO' || c.status === 'EM_ANDAMENTO').length,
      naoLidas: meus.reduce((soma, c) => soma + c.mensagensNaoLidas, 0),
    };
  });
};
