import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireSuperAdmin } from '../auth/principal';
import { MESSAGE_ID_PATTERN } from '../messages/message.types';
import type { AdminService } from './admin.service';

/** Todas as rotas daqui são só da conta do TI (checado no onRequest, antes do corpo) */
const superAdminOnly = { onRequest: async (request: FastifyRequest) => void requireSuperAdmin(request) };

const messageIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: MESSAGE_ID_PATTERN } },
} as const;

const purgeMessagesBody = {
  type: 'object',
  additionalProperties: false,
  properties: { olderThanDays: { type: ['integer', 'null'], minimum: 0, maximum: 3650 } },
} as const;

const conversationParams = {
  type: 'object',
  required: ['dpUserId', 'employeeId'],
  properties: { dpUserId: { type: 'string', format: 'uuid' }, employeeId: { type: 'string', format: 'uuid' } },
} as const;

const purgeChatBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dpUserId: { type: ['string', 'null'], format: 'uuid' },
    olderThanDays: { type: ['integer', 'null'], minimum: 0, maximum: 3650 },
  },
} as const;

const newUserBody = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'name', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9._-]+$' },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    password: { type: 'string', minLength: 8, maxLength: 128 },
    /** true = aparece na lista de contatos do chat no aplicativo (pessoas do DP) */
    chatContact: { type: 'boolean', default: true },
  },
} as const;

const userIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

const statusBody = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
} as const;

const passwordBody = {
  type: 'object',
  additionalProperties: false,
  required: ['password'],
  properties: { password: { type: 'string', minLength: 8, maxLength: 128 } },
} as const;

export const adminRoutes: FastifyPluginAsync<{ admin: AdminService }> = async (app, { admin }) => {
  // ---------------------------------------------------------------- comunicados

  app.delete<{ Params: { id: string } }>(
    '/admin/messages/:id',
    { ...superAdminOnly, schema: { params: messageIdParams } },
    async (request, reply) => {
      await admin.deleteMessage(request.params.id);
      reply.status(204).send();
    },
  );

  app.post<{ Body: { olderThanDays?: number | null } }>(
    '/admin/messages/purge',
    { ...superAdminOnly, schema: { body: purgeMessagesBody } },
    async (request) => ({ removed: await admin.purgeMessages(request.body?.olderThanDays ?? null) }),
  );

  // ---------------------------------------------------------------- conversas (só números, sem conteúdo)

  app.get('/admin/chats', superAdminOnly, async () => ({ summary: await admin.chatSummary() }));

  app.delete<{ Params: { dpUserId: string; employeeId: string } }>(
    '/admin/chats/:dpUserId/:employeeId',
    { ...superAdminOnly, schema: { params: conversationParams } },
    async (request) => ({ removed: await admin.deleteConversation(request.params.dpUserId, request.params.employeeId) }),
  );

  app.post<{ Body: { dpUserId?: string | null; olderThanDays?: number | null } }>(
    '/admin/chats/purge',
    { ...superAdminOnly, schema: { body: purgeChatBody } },
    async (request) => ({
      removed: await admin.purgeChat(request.body?.dpUserId ?? null, request.body?.olderThanDays ?? null),
    }),
  );

  // ---------------------------------------------------------------- logins do DP

  app.get('/admin/users', superAdminOnly, async () => ({ users: await admin.listUsers() }));

  app.post<{ Body: { username: string; name: string; password: string; chatContact?: boolean } }>(
    '/admin/users',
    { ...superAdminOnly, schema: { body: newUserBody } },
    async (request, reply) => {
      reply.status(201);
      return {
        user: await admin.createUser({
          username: request.body.username,
          name: request.body.name,
          password: request.body.password,
          chatContact: request.body.chatContact !== false,
        }),
      };
    },
  );

  app.patch<{ Params: { id: string }; Body: { status: 'ACTIVE' | 'INACTIVE' } }>(
    '/admin/users/:id',
    { ...superAdminOnly, schema: { params: userIdParams, body: statusBody } },
    async (request, reply) => {
      await admin.setStatus(requireSuperAdmin(request).userId, request.params.id, request.body.status);
      reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string }; Body: { password: string } }>(
    '/admin/users/:id/password',
    { ...superAdminOnly, schema: { params: userIdParams, body: passwordBody } },
    async (request, reply) => {
      await admin.resetPassword(requireSuperAdmin(request).userId, request.params.id, request.body.password);
      reply.status(204).send();
    },
  );
};
