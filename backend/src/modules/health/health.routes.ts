import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
            },
            required: ['status', 'service'],
          },
        },
      },
    },
    async () => ({ status: 'ok', service: 'sistema-dp-backend' }),
  );
}
