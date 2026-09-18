import type { FastifyServerOptions } from 'fastify';
import { env } from './env';

/**
 * Logs estruturados (JSON) em produção.
 * Em desenvolvimento, formata de forma legível: [2026-09-11 21:30:02] INFO mensagem
 */
export const loggerOptions: FastifyServerOptions['logger'] =
  env.nodeEnv === 'development'
    ? {
        level: env.logLevel,
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        level: env.logLevel,
      };
