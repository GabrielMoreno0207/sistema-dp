import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireAdmin } from '../auth/principal';
import { SECTOR_NAME_MAX } from '../sectors/sector.types';
import type { AutoReplyService } from './auto-reply.service';
import { AUTO_REPLY_CONTENT_MAX, type AutoReplyInput } from './auto-reply.types';

const bodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sector', 'content', 'active'],
  properties: {
    sector: { type: ['string', 'null'], maxLength: SECTOR_NAME_MAX },
    content: { type: 'string', minLength: 1, maxLength: AUTO_REPLY_CONTENT_MAX },
    active: { type: 'boolean' },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

// Só o DP; cada pessoa vê e altera apenas as próprias respostas (checado no onRequest, antes do corpo)
const adminOnly = { onRequest: async (request: FastifyRequest) => void requireAdmin(request) };

export const autoReplyRoutes: FastifyPluginAsync<{ autoReplies: AutoReplyService }> = async (app, { autoReplies }) => {
  app.get('/auto-replies', adminOnly, async (request) => ({ rules: await autoReplies.list(requireAdmin(request).userId) }));

  app.post<{ Body: AutoReplyInput }>('/auto-replies', { ...adminOnly, schema: { body: bodySchema } }, async (request, reply) => {
    reply.status(201);
    return { rule: await autoReplies.create(requireAdmin(request).userId, request.body) };
  });

  app.put<{ Params: { id: string }; Body: AutoReplyInput }>(
    '/auto-replies/:id',
    { ...adminOnly, schema: { params: idParamsSchema, body: bodySchema } },
    async (request) => ({ rule: await autoReplies.update(requireAdmin(request).userId, request.params.id, request.body) }),
  );

  app.delete<{ Params: { id: string } }>(
    '/auto-replies/:id',
    { ...adminOnly, schema: { params: idParamsSchema } },
    async (request, reply) => {
      await autoReplies.remove(requireAdmin(request).userId, request.params.id);
      reply.status(204).send();
    },
  );
};
