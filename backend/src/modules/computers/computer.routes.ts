import type { FastifyPluginAsync } from 'fastify';
import type { RealtimeGateway } from '../../realtime/socket-server';
import type { AuthService } from '../auth/auth.service';
import { requireAdmin } from '../auth/principal';
import type { ComputerService } from './computer.service';
import { COMPUTER_ID_PATTERN, COMPUTER_LIMITS, type ComputerInfo } from './computer.types';

const registerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['computerId', 'hostname', 'appVersion', 'platform', 'computerSecret'],
  properties: {
    computerId: { type: 'string', pattern: COMPUTER_ID_PATTERN },
    hostname: { type: 'string', minLength: 1, maxLength: COMPUTER_LIMITS.hostname },
    appVersion: { type: 'string', minLength: 1, maxLength: COMPUTER_LIMITS.appVersion },
    platform: { type: 'string', minLength: 1, maxLength: COMPUTER_LIMITS.platform },
    computerSecret: { type: 'string', minLength: 32, maxLength: 128 },
  },
} as const;

const computerIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: COMPUTER_ID_PATTERN } },
} as const;

type RegisterBody = ComputerInfo & { computerSecret: string };

export interface ComputerRoutesOptions {
  computers: ComputerService;
  auth: AuthService;
  realtime: Pick<RealtimeGateway, 'disconnectComputer'>;
}

export const computerRoutes: FastifyPluginAsync<ComputerRoutesOptions> = async (app, { computers, auth, realtime }) => {
  // Aparelho (PC ou celular) se registra e recebe um token. O segredo da instalação é o que
  // impede alguém de se passar por um aparelho já registrado.
  app.post<{ Body: RegisterBody }>('/computers/register', { schema: { body: registerSchema } }, async (request) => {
    const { computerSecret, ...info } = request.body;
    return auth.registerComputer(info, { computerSecret });
  });

  app.get('/computers', async (request) => {
    requireAdmin(request);
    return { computers: await computers.list() };
  });

  app.get<{ Params: { id: string } }>(
    '/computers/:id',
    { schema: { params: computerIdParamsSchema } },
    async (request) => {
      requireAdmin(request);
      return { computer: await computers.get(request.params.id) };
    },
  );

  // DP libera o PC para se registrar de novo (ex.: Windows reinstalado)
  app.post<{ Params: { id: string } }>(
    '/computers/:id/reset-credential',
    { schema: { params: computerIdParamsSchema } },
    async (request, reply) => {
      requireAdmin(request);
      await auth.resetComputerCredential(request.params.id);
      realtime.disconnectComputer(request.params.id); // o PC se registra de novo em seguida
      reply.status(204).send();
    },
  );
};
