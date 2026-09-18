import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error';

/** Quem está fazendo a requisição. */
export type Principal =
  | { type: 'COMPUTER'; computerId: string }
  /** superAdmin = conta do TI (poderes extras: apagar comunicados/conversas e gerenciar logins) */
  | { type: 'ADMIN'; userId: string; name: string; superAdmin: boolean };

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export function requireAdmin(request: FastifyRequest): Extract<Principal, { type: 'ADMIN' }> {
  const principal = request.principal;
  if (!principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
  if (principal.type !== 'ADMIN') throw new AppError('Acesso permitido apenas ao DP', 403, 'FORBIDDEN');
  return principal;
}

/** Só a conta do TI: apagar comunicados e conversas, gerenciar os logins do DP */
export function requireSuperAdmin(request: FastifyRequest): Extract<Principal, { type: 'ADMIN' }> {
  const admin = requireAdmin(request);
  if (!admin.superAdmin) throw new AppError('Acesso permitido apenas ao TI', 403, 'FORBIDDEN');
  return admin;
}

export function requireComputer(request: FastifyRequest): string {
  const principal = request.principal;
  if (!principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
  if (principal.type !== 'COMPUTER') throw new AppError('Acesso permitido apenas a computadores', 403, 'FORBIDDEN');
  return principal.computerId;
}
