import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../auth/principal';
import { LIMITES_CONTEUDO, MIDIA_ID_PATTERN } from '../content/content.types';
import { sendMessageSchema } from '../messages/message.routes';
import type { SendMessageInput } from '../messages/message.service';
import type { AgendamentoService } from './agendamento.service';
import { AGENDAMENTO_ID_PATTERN, type DadosMuralAgendado, type TipoAgendamento } from './agendamento.types';

const QUANDO = { type: 'string', minLength: 10, maxLength: 40 } as const;

/** O mesmo corpo do envio na hora, mais "executarEm" */
const comunicadoBody = {
  ...sendMessageSchema,
  required: [...sendMessageSchema.required, 'executarEm'],
  properties: { ...sendMessageSchema.properties, executarEm: QUANDO },
} as const;

const muralBody = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'texto', 'executarEm'],
  properties: {
    titulo: { type: 'string', minLength: 1, maxLength: LIMITES_CONTEUDO.maxTitulo },
    texto: { type: 'string', minLength: 1, maxLength: LIMITES_CONTEUDO.maxTexto },
    midiaId: { type: ['string', 'null'], pattern: MIDIA_ID_PATTERN },
    executarEm: QUANDO,
  },
} as const;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: AGENDAMENTO_ID_PATTERN } },
} as const;

const listaQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { tipo: { type: 'string', enum: ['COMUNICADO', 'MURAL'] } },
} as const;

const soDpTi = { onRequest: async (request: Parameters<typeof requireAdmin>[0]) => void requireAdmin(request) };

/** Comunicados e recados do mural agendados pelo DP/TI. */
export const agendamentoRoutes: FastifyPluginAsync<{ agendamentos: AgendamentoService }> = async (app, { agendamentos }) => {
  app.post('/agendamentos/comunicado', { ...soDpTi, schema: { body: comunicadoBody } }, async (request, reply) => {
    const admin = requireAdmin(request);
    const { executarEm, ...dados } = request.body as SendMessageInput & { executarEm: string };
    const criado = await agendamentos.agendarComunicado(dados, executarEm, admin);
    return reply.code(201).send({ agendamento: criado });
  });

  app.post('/agendamentos/mural', { ...soDpTi, schema: { body: muralBody } }, async (request, reply) => {
    const admin = requireAdmin(request);
    const body = request.body as Omit<DadosMuralAgendado, 'midiaId'> & { midiaId?: string | null; executarEm: string };
    const criado = await agendamentos.agendarMural(
      { titulo: body.titulo, texto: body.texto, midiaId: body.midiaId ?? null },
      body.executarEm,
      admin,
    );
    return reply.code(201).send({ agendamento: criado });
  });

  app.get('/agendamentos', { ...soDpTi, schema: { querystring: listaQuery } }, async (request) => {
    const { tipo } = request.query as { tipo?: TipoAgendamento };
    return { agendamentos: await agendamentos.listar(tipo ?? null) };
  });

  app.delete('/agendamentos/:id', { ...soDpTi, schema: { params: idParams } }, async (request, reply) => {
    await agendamentos.cancelar((request.params as { id: string }).id, requireAdmin(request));
    return reply.code(204).send();
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    agendamentos: AgendamentoService;
  }
}
