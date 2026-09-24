import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EmployeeService } from '../employees/employee.service';
import { acessoDoSetor } from './acesso-por-setor';
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
 *
 * Token de computador: se o funcionário logado nele for do setor do DP ou do
 * TI, a requisição também vale como DP (é o acesso pelo setor). A conferência
 * passa pelo getSessionEmployee, então sessão expirada ou conta desativada
 * perde o acesso na hora.
 */
export function registerAuthentication(app: FastifyInstance, auth: AuthService, employees: EmployeeService): void {
  app.decorateRequest('principal', null);

  app.addHook('onRequest', async (request) => {
    const token = bearerToken(request);
    const principal = token ? await auth.authenticate(token) : null;
    if (principal?.type === 'COMPUTER') {
      const funcionario = await employees.getSessionEmployee(principal.computerId);
      const acesso = acessoDoSetor(funcionario?.sector);
      principal.admin =
        funcionario && acesso !== 'NENHUM'
          ? { userId: funcionario.id, name: funcionario.name, superAdmin: acesso === 'TI' }
          : null;
    }
    request.principal = principal;
  });
}
