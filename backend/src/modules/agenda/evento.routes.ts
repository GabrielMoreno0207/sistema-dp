import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error';
import type { EmployeeService } from '../employees/employee.service';
import type { EventoService, PessoaDaAgenda } from './evento.service';
import { COR_PATTERN, DIA_PATTERN, EVENTO_ID_PATTERN, HORA_PATTERN, LIMITES_EVENTO } from './evento.types';

const periodoQuery = {
  type: 'object',
  additionalProperties: false,
  required: ['de', 'ate'],
  properties: {
    de: { type: 'string', pattern: DIA_PATTERN },
    ate: { type: 'string', pattern: DIA_PATTERN },
  },
} as const;

const eventoBody = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'dia'],
  properties: {
    titulo: { type: 'string', minLength: 1, maxLength: LIMITES_EVENTO.maxTitulo },
    descricao: { type: 'string', maxLength: LIMITES_EVENTO.maxDescricao },
    dia: { type: 'string', pattern: DIA_PATTERN },
    hora: { type: ['string', 'null'], pattern: HORA_PATTERN },
    escopo: { type: 'string', enum: ['PESSOAL', 'GERAL'] },
    cor: { type: 'string', pattern: COR_PATTERN },
  },
} as const;

const eventoParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: EVENTO_ID_PATTERN } },
} as const;

export interface EventoRoutesOptions {
  eventos: EventoService;
  employees: EmployeeService;
}

/** Calendário da tela inicial: anotações de cada um e os eventos da empresa. */
export const eventoRoutes: FastifyPluginAsync<EventoRoutesOptions> = async (app, { eventos, employees }) => {
  /** Mesma dupla de credenciais do resto do sistema: o PC (com funcionário) ou a conta do DP/TI. */
  async function quemEstaAgindo(request: FastifyRequest): Promise<PessoaDaAgenda> {
    const principal = request.principal;
    if (!principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');

    if (principal.type === 'COMPUTER') {
      const employee = await employees.getSessionEmployee(principal.computerId);
      if (!employee) throw new AppError('Entre com seu usuário para usar a agenda', 401, 'NO_EMPLOYEE');
      // Funcionário do setor do DP/TI: o setor dá o mesmo poder da conta do DP (publicar para todos)
      const admin = principal.admin;
      return { id: employee.id, nome: employee.name, ehDp: admin !== null, ehTi: admin?.superAdmin ?? false };
    }
    return { id: principal.userId, nome: principal.name, ehDp: true, ehTi: principal.superAdmin };
  }

  app.get('/eventos', { schema: { querystring: periodoQuery } }, async (request) => {
    const { de, ate } = request.query as { de: string; ate: string };
    return { eventos: await eventos.listar(await quemEstaAgindo(request), de, ate) };
  });

  app.post('/eventos', { schema: { body: eventoBody } }, async (request, reply) => {
    const corpo = request.body as {
      titulo: string;
      descricao?: string;
      dia: string;
      hora?: string | null;
      escopo?: 'PESSOAL' | 'GERAL';
      cor?: string;
    };
    const evento = await eventos.criar(await quemEstaAgindo(request), {
      titulo: corpo.titulo,
      descricao: corpo.descricao ?? '',
      dia: corpo.dia,
      hora: corpo.hora ?? null,
      escopo: corpo.escopo ?? 'PESSOAL',
      cor: corpo.cor ?? '#17b3a3',
    });
    return reply.code(201).send(evento);
  });

  app.put('/eventos/:id', { schema: { params: eventoParams, body: eventoBody } }, async (request) => {
    const { id } = request.params as { id: string };
    const corpo = request.body as {
      titulo: string;
      descricao?: string;
      dia: string;
      hora?: string | null;
      cor?: string;
    };
    return eventos.alterar(await quemEstaAgindo(request), id, {
      titulo: corpo.titulo,
      descricao: corpo.descricao ?? '',
      dia: corpo.dia,
      hora: corpo.hora ?? null,
      escopo: 'PESSOAL', // o escopo não muda depois de criado
      cor: corpo.cor ?? '#17b3a3',
    });
  });

  app.delete('/eventos/:id', { schema: { params: eventoParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await eventos.apagar(await quemEstaAgindo(request), id);
    return reply.code(204).send();
  });
};
