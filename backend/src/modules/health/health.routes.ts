import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Versão que está rodando, lida do package.json ao lado do código.
 *
 * Vale tanto em dist/modules/health quanto em src/modules/health: os dois
 * ficam três pastas abaixo da raiz do backend. Lida uma vez, na subida.
 */
function versaoEmUso(): string {
  try {
    const manifesto = readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf-8');
    return (JSON.parse(manifesto) as { version?: string }).version ?? 'desconhecida';
  } catch {
    return 'desconhecida';
  }
}

const VERSAO = versaoEmUso();
const SUBIU_EM = new Date().toISOString();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Usada para saber se o servidor está de pé (o versionador espera por ela
   * depois de publicar o pacote) e, agora, qual versão subiu: sem isso não dá
   * para conferir se a troca pegou sem entrar no servidor.
   */
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
              versao: { type: 'string' },
              desde: { type: 'string' },
            },
            required: ['status', 'service'],
          },
        },
      },
    },
    async () => ({ status: 'ok', service: 'sistema-dp-backend', versao: VERSAO, desde: SUBIU_EM }),
  );
}
