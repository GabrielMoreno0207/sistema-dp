import type { FastifyPluginAsync } from 'fastify';
import { bearerToken } from './auth.hooks';
import type { AuthService } from './auth.service';
import { requireAdmin } from './principal';

const loginSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

const passwordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['currentPassword', 'newPassword'],
  properties: {
    currentPassword: { type: 'string', minLength: 1, maxLength: 128 },
    newPassword: { type: 'string', minLength: 8, maxLength: 128 },
  },
} as const;

export interface AuthRoutesOptions {
  auth: AuthService;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { auth }) => {
  // Login do DP na Central
  app.post<{ Body: { username: string; password: string } }>(
    '/auth/login',
    { schema: { body: loginSchema } },
    async (request) => auth.login(request.body.username.trim(), request.body.password, request.ip),
  );

  app.post('/auth/logout', async (request, reply) => {
    requireAdmin(request);
    const token = bearerToken(request);
    if (token) await auth.logout(token);
    reply.status(204).send();
  });

  // Usuário logado (a Central usa para saber se precisa pedir a troca da senha inicial)
  app.get('/auth/me', async (request) => {
    const admin = requireAdmin(request);
    return { user: await auth.getAdmin(admin.userId) };
  });

  // O próprio usuário do DP troca a senha
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/auth/password',
    { schema: { body: passwordSchema }, onRequest: async (request) => void requireAdmin(request) },
    async (request) => {
      const admin = requireAdmin(request);
      return { user: await auth.changeOwnPassword(admin.userId, request.body.currentPassword, request.body.newPassword) };
    },
  );
};
