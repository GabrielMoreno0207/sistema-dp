import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireAdmin, requireComputer } from '../auth/principal';
import type { ChatCompatService } from './chat.compat-service';
import { CHAT_CONTENT_MAX } from './chat.types';

const contentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['content'],
  properties: { content: { type: 'string', minLength: 1, maxLength: CHAT_CONTENT_MAX } },
} as const;

const employeeParamsSchema = {
  type: 'object',
  required: ['employeeId'],
  properties: { employeeId: { type: 'string', format: 'uuid' } },
} as const;

const dpUserId = { type: 'string', format: 'uuid' } as const;

const employeeSendSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dpUserId', 'content'],
  properties: { dpUserId, content: { type: 'string', minLength: 1, maxLength: CHAT_CONTENT_MAX } },
} as const;

const dpUserBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['dpUserId'],
  properties: { dpUserId },
} as const;

const dpUserQuerySchema = {
  type: 'object',
  required: ['dpUserId'],
  properties: { dpUserId },
} as const;

// Acesso checado no onRequest, antes de validar o corpo
const adminOnly = { onRequest: async (request: FastifyRequest) => void requireAdmin(request) };
const computerOnly = { onRequest: async (request: FastifyRequest) => void requireComputer(request) };

export const chatRoutes: FastifyPluginAsync<{ chat: ChatCompatService }> = async (app, { chat }) => {
  // ---------------------------------------------------------------- DP (Central): cada pessoa vê só as próprias conversas

  app.get('/chats', adminOnly, async (request) => ({
    conversations: await chat.listConversations(requireAdmin(request).userId),
  }));

  app.get<{ Params: { employeeId: string } }>(
    '/chats/:employeeId/messages',
    { ...adminOnly, schema: { params: employeeParamsSchema } },
    async (request) => chat.threadForDp(requireAdmin(request).userId, request.params.employeeId),
  );

  app.post<{ Params: { employeeId: string }; Body: { content: string } }>(
    '/chats/:employeeId/messages',
    { ...adminOnly, schema: { params: employeeParamsSchema, body: contentSchema } },
    async (request, reply) => {
      const admin = requireAdmin(request);
      reply.status(201);
      return chat.sendFromDp(admin.userId, admin.name, request.params.employeeId, request.body.content);
    },
  );

  app.post<{ Params: { employeeId: string } }>(
    '/chats/:employeeId/read',
    { ...adminOnly, schema: { params: employeeParamsSchema } },
    async (request, reply) => {
      await chat.markReadByDp(requireAdmin(request).userId, request.params.employeeId);
      reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------- funcionário (app desktop)

  app.get('/chat/contacts', computerOnly, async (request) => chat.contactsForEmployee(requireComputer(request)));

  app.get<{ Querystring: { dpUserId: string } }>(
    '/chat/messages',
    { ...computerOnly, schema: { querystring: dpUserQuerySchema } },
    async (request) => chat.threadForEmployee(requireComputer(request), request.query.dpUserId),
  );

  app.post<{ Body: { dpUserId: string; content: string } }>(
    '/chat/messages',
    { ...computerOnly, schema: { body: employeeSendSchema } },
    async (request, reply) => {
      reply.status(201);
      return { message: await chat.sendFromEmployee(requireComputer(request), request.body.dpUserId, request.body.content) };
    },
  );

  app.post<{ Body: { dpUserId: string } }>(
    '/chat/read',
    { ...computerOnly, schema: { body: dpUserBodySchema } },
    async (request, reply) => {
      await chat.markReadByEmployee(requireComputer(request), request.body.dpUserId);
      reply.status(204).send();
    },
  );
};
