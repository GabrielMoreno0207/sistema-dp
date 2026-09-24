import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error';

/** Quem está fazendo a requisição. */
export type Principal =
  /**
   * Computador (ou celular) do funcionário. Quando a pessoa logada nele é do
   * setor do DP ou do TI, `admin` vem preenchido e vale como acesso do DP:
   * o setor dá o poder, sem precisar de um login à parte.
   */
  | { type: 'COMPUTER'; computerId: string; admin: AdminPrincipal | null }
  /** superAdmin = conta do TI (poderes extras: apagar comunicados/conversas e gerenciar logins) */
  | ({ type: 'ADMIN' } & AdminPrincipal);

/** Quem responde como DP: a conta da Central ou o funcionário do setor do DP/TI */
export interface AdminPrincipal {
  userId: string;
  name: string;
  superAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

export function requireAdmin(request: FastifyRequest): AdminPrincipal {
  const principal = request.principal;
  if (!principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
  if (principal.type === 'ADMIN') return principal;
  // Funcionário do setor do DP/TI: o acesso vem do setor, pelo token do computador
  if (principal.admin) return principal.admin;
  throw new AppError('Acesso permitido apenas ao DP', 403, 'FORBIDDEN');
}

/** Só quem é do TI: apagar comunicados e conversas, gerenciar os logins do DP */
export function requireSuperAdmin(request: FastifyRequest): AdminPrincipal {
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
