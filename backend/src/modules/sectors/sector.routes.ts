import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireAdmin } from '../auth/principal';
import type { SectorService } from './sector.service';
import { SECTOR_ID_PATTERN, SECTOR_NAME_MAX } from './sector.types';

const nameSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: SECTOR_NAME_MAX } },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: SECTOR_ID_PATTERN } },
} as const;

// Só o DP gerencia setores (checado no onRequest, antes de validar o corpo)
const adminOnly = { onRequest: async (request: FastifyRequest) => void requireAdmin(request) };

export const sectorRoutes: FastifyPluginAsync<{ sectors: SectorService }> = async (app, { sectors }) => {
  app.get('/sectors', adminOnly, async () => ({ sectors: await sectors.list() }));

  app.post<{ Body: { name: string } }>('/sectors', { ...adminOnly, schema: { body: nameSchema } }, async (request, reply) => {
    reply.status(201);
    return { sector: await sectors.create(request.body.name) };
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    '/sectors/:id',
    { ...adminOnly, schema: { params: idParamsSchema, body: nameSchema } },
    async (request) => ({ sector: await sectors.rename(request.params.id, request.body.name) }),
  );

  app.delete<{ Params: { id: string } }>(
    '/sectors/:id',
    { ...adminOnly, schema: { params: idParamsSchema } },
    async (request, reply) => {
      await sectors.delete(request.params.id);
      reply.status(204).send();
    },
  );
};
