import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { requireAdmin, requireComputer } from '../auth/principal';
import { EMPLOYEE_LIMITS, type EmployeeService, type EmployeeUpdateInput, type NewEmployeeInput } from './employee.service';

const { name, registration, group, password } = EMPLOYEE_LIMITS;
const nullableGroup = { type: ['string', 'null'], maxLength: group } as const;

const createSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'registration', 'password'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: name },
    registration: { type: 'string', minLength: 1, maxLength: registration, pattern: '^[A-Za-z0-9._-]+$' },
    sector: nullableGroup,
    shift: nullableGroup,
    password: { type: 'string', minLength: password.min, maxLength: password.max },
  },
} as const;

const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: name },
    registration: { type: 'string', minLength: 1, maxLength: registration, pattern: '^[A-Za-z0-9._-]+$' },
    sector: nullableGroup,
    shift: nullableGroup,
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
  },
} as const;

const passwordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['password'],
  properties: { password: { type: 'string', minLength: password.min, maxLength: password.max } },
} as const;

const loginSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['registration', 'password'],
  properties: {
    registration: { type: 'string', minLength: 1, maxLength: registration },
    password: { type: 'string', minLength: 1, maxLength: password.max },
  },
} as const;

const changePasswordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['currentPassword', 'newPassword'],
  properties: {
    currentPassword: { type: 'string', minLength: 1, maxLength: password.max },
    newPassword: { type: 'string', minLength: password.min, maxLength: password.max },
  },
} as const;

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

// Checagem de acesso no onRequest: sem permissão → 401/403 antes de validar o corpo
const adminOnly = { onRequest: async (request: FastifyRequest) => void requireAdmin(request) };
const computerOnly = { onRequest: async (request: FastifyRequest) => void requireComputer(request) };

export interface EmployeeRoutesOptions {
  employees: EmployeeService;
}

export const employeeRoutes: FastifyPluginAsync<EmployeeRoutesOptions> = async (app, { employees }) => {
  // ---------------------------------------------------------------- cadastro (DP, na Central)

  app.get('/employees', adminOnly, async () => ({ employees: await employees.list() }));

  app.post<{ Body: NewEmployeeInput }>('/employees', { ...adminOnly, schema: { body: createSchema } }, async (request, reply) => {
    reply.status(201);
    return { employee: await employees.create(request.body) };
  });

  app.patch<{ Params: { id: string }; Body: EmployeeUpdateInput }>(
    '/employees/:id',
    { ...adminOnly, schema: { params: idParamsSchema, body: updateSchema } },
    async (request) => ({ employee: await employees.update(request.params.id, request.body) }),
  );

  // Excluir: o funcionário sai dos computadores; o histórico de mensagens é mantido
  app.delete<{ Params: { id: string } }>(
    '/employees/:id',
    { ...adminOnly, schema: { params: idParamsSchema } },
    async (request, reply) => {
      await employees.remove(request.params.id);
      reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string }; Body: { password: string } }>(
    '/employees/:id/password',
    { ...adminOnly, schema: { params: idParamsSchema, body: passwordSchema } },
    async (request, reply) => {
      await employees.resetPassword(request.params.id, request.body.password);
      reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------- sessão do funcionário (app desktop)

  app.get('/session', computerOnly, async (request) => {
    const employee = await employees.getSessionEmployee(requireComputer(request));
    if (!employee) return { employee: null };
    const { status: _status, createdAt: _createdAt, ...profile } = employee; // só o que o app precisa
    return { employee: profile };
  });

  app.post<{ Body: { registration: string; password: string } }>(
    '/session/login',
    { ...computerOnly, schema: { body: loginSchema } },
    async (request) => ({
      employee: await employees.login(requireComputer(request), request.body.registration.trim(), request.body.password),
    }),
  );

  app.post('/session/logout', computerOnly, async (request, reply) => {
    await employees.logout(requireComputer(request));
    reply.status(204).send();
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/session/password',
    { ...computerOnly, schema: { body: changePasswordSchema } },
    async (request, reply) => {
      await employees.changePassword(requireComputer(request), request.body.currentPassword, request.body.newPassword);
      reply.status(204).send();
    },
  );
};
