import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireComputer } from '../auth/principal';
import type { MessageService, SendMessageInput } from './message.service';
import { ATTACHMENT_ID_PATTERN, ATTACHMENT_LIMITS } from '../attachments/attachment.types';
import { IMPLEMENTED_TARGETS, MESSAGE_ID_PATTERN, MESSAGE_LIMITS, MESSAGE_TYPES } from './message.types';

const sendMessageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'content', 'type'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: MESSAGE_LIMITS.title },
    content: { type: 'string', minLength: 1, maxLength: MESSAGE_LIMITS.content },
    type: { type: 'string', enum: MESSAGE_TYPES },
    target: { type: 'string', enum: IMPLEMENTED_TARGETS, default: 'ALL' },
    // ID do computador, ID do funcionário, nome do setor ou do turno (conferido no service)
    targetId: { type: 'string', minLength: 1, maxLength: 64 },
    // Anexos já enviados por POST /api/attachments (conferidos no service)
    attachmentIds: {
      type: 'array',
      maxItems: ATTACHMENT_LIMITS.perMessage,
      items: { type: 'string', pattern: ATTACHMENT_ID_PATTERN },
    },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: MESSAGE_ID_PATTERN } },
} as const;

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    unread: { type: 'boolean', default: false },
    limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
  },
} as const;

interface ListQuery {
  unread: boolean;
  limit: number;
}

export interface MessageRoutesOptions {
  messages: MessageService;
}

export const messageRoutes: FastifyPluginAsync<MessageRoutesOptions> = async (app, { messages }) => {
  // DP envia uma mensagem
  // Acesso checado no onRequest: sem token → 401 antes de validar o corpo
  app.post<{ Body: SendMessageInput }>(
    '/messages',
    { schema: { body: sendMessageSchema }, onRequest: async (request) => void requireAdmin(request) },
    async (request, reply) => {
      const admin = requireAdmin(request);
      const result = await messages.send(request.body, admin.name, admin.userId);
      reply.status(201);
      return result;
    },
  );

  // Computador: suas mensagens. DP: todas, com contagem de leituras.
  app.get<{ Querystring: ListQuery }>('/messages', { schema: { querystring: listQuerySchema } }, async (request) => {
    const principal = request.principal;
    if (principal?.type === 'COMPUTER') {
      return messages.listForComputer(principal.computerId, request.query.unread, request.query.limit);
    }
    requireAdmin(request);
    return { messages: await messages.listAll(request.query.limit) };
  });

  app.get('/messages/unread', async (request) => {
    const computerId = requireComputer(request);
    return messages.listForComputer(computerId, true, 500);
  });

  app.get<{ Params: { id: string } }>('/messages/:id', { schema: { params: idParamsSchema } }, async (request) => {
    const principal = request.principal;
    if (principal?.type === 'COMPUTER') {
      return { message: await messages.getForComputer(request.params.id, principal.computerId) };
    }
    requireAdmin(request);
    return { message: await messages.getWithStats(request.params.id) };
  });

  // DP: quem leu (e quem ainda não leu) a mensagem
  app.get<{ Params: { id: string } }>(
    '/messages/:id/reads',
    { schema: { params: idParamsSchema }, onRequest: async (request) => void requireAdmin(request) },
    async (request) => messages.getReads(request.params.id),
  );

  app.patch<{ Params: { id: string } }>('/messages/:id/read', { schema: { params: idParamsSchema } }, async (request) => {
    const computerId = requireComputer(request);
    return messages.markRead(request.params.id, computerId);
  });
};
