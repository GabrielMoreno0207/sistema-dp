import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.service';

/** Token do header "Authorization: Bearer <token>", se houver. */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length >= 20 && token.length <= 200 ? token : null;
}

/**
 * Identifica quem faz cada requisição (request.principal).
 * As rotas decidem o que exigir com requireAdmin / requireComputer.
 */
export function registerAuthentication(app: FastifyInstance, auth: AuthService): void {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    const token = bearerToken(request);
    request.principal = token ? await auth.authenticate(token) : null;
  });
}
