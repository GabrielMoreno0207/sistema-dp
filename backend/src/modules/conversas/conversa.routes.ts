import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error';
import { requireAdmin } from '../auth/principal';
import { MIDIA_ID_PATTERN } from '../content/content.types';
import type { EmployeeService } from '../employees/employee.service';
import type { UserRepository } from '../users/user.repository';
import type { ConversaService, Pessoa } from './conversa.service';
import { CONVERSA_ID_PATTERN, LIMITES_CONVERSA } from './conversa.types';

const conversaParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: CONVERSA_ID_PATTERN } },
} as const;

const mensagensQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { antes: { type: 'integer', minimum: 1 } },
} as const;

const novaDiretaBody = {
  type: 'object',
  additionalProperties: false,
  required: ['comUsuarioId'],
  properties: { comUsuarioId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const novoGrupoBody = {
  type: 'object',
  additionalProperties: false,
  required: ['nome', 'membros'],
  properties: {
    nome: { type: 'string', minLength: 1, maxLength: LIMITES_CONVERSA.maxNomeGrupo },
    membros: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITES_CONVERSA.maxMembrosGrupo,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
} as const;

const mensagemBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    conteudo: { type: 'string', maxLength: LIMITES_CONVERSA.maxConteudo },
    midiaId: { type: ['string', 'null'], pattern: MIDIA_ID_PATTERN },
  },
} as const;

const membroBody = {
  type: 'object',
  additionalProperties: false,
  required: ['usuarioId'],
  properties: { usuarioId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const nomeBody = {
  type: 'object',
  additionalProperties: false,
  required: ['nome'],
  properties: { nome: { type: 'string', minLength: 1, maxLength: LIMITES_CONVERSA.maxNomeGrupo } },
} as const;

export interface ConversaRoutesOptions {
  conversas: ConversaService;
  employees: EmployeeService;
  users: UserRepository;
}

export const conversaRoutes: FastifyPluginAsync<ConversaRoutesOptions> = async (app, { conversas, employees, users }) => {
  /**
   * Quem está falando: o funcionário logado no PC, ou a pessoa do DP/TI.
   * É o mesmo par de credenciais que o resto do sistema já usa.
   */
  async function quemEstaAgindo(request: FastifyRequest): Promise<Pessoa> {
    const principal = request.principal;
    if (!principal) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');

    if (principal.type === 'COMPUTER') {
      const employee = await employees.getSessionEmployee(principal.computerId);
      if (!employee) throw new AppError('Entre com sua matrícula para usar as mensagens', 401, 'NO_EMPLOYEE');
      const completo = await users.findById(employee.id);
      return { id: employee.id, nome: employee.name, setor: completo?.sector ?? null, ehDp: false, ehTi: false };
    }
    return { id: principal.userId, nome: principal.name, setor: null, ehDp: true, ehTi: principal.superAdmin };
  }

  /** Com quem dá para conversar. */
  app.get('/contatos', async (request) => ({ contatos: await conversas.contatos(await quemEstaAgindo(request)) }));

  /** Minhas conversas, da mais movimentada para a mais antiga. */
  app.get('/conversas', async (request) => ({ conversas: await conversas.listar(await quemEstaAgindo(request)) }));

  /** Contador para o menu do aplicativo. */
  app.get('/conversas/resumo', async (request) => ({
    naoLidas: await conversas.totalNaoLidas(await quemEstaAgindo(request)),
  }));

  /** Abre (ou reaproveita) a conversa direta com alguém. */
  app.post('/conversas/direta', { schema: { body: novaDiretaBody } }, async (request, reply) => {
    const quem = await quemEstaAgindo(request);
    const { comUsuarioId } = request.body as { comUsuarioId: string };
    const conversa = await conversas.abrirDireta(quem, comUsuarioId);
    return reply.code(201).send(await conversas.detalhe(quem, conversa.id));
  });

  app.post('/conversas/grupo', { schema: { body: novoGrupoBody } }, async (request, reply) => {
    const quem = await quemEstaAgindo(request);
    const { nome, membros } = request.body as { nome: string; membros: string[] };
    const conversa = await conversas.criarGrupo(quem, nome, membros);
    return reply.code(201).send(await conversas.detalhe(quem, conversa.id));
  });

  app.get('/conversas/:id', { schema: { params: conversaParams } }, async (request) => {
    const { id } = request.params as { id: string };
    return conversas.detalhe(await quemEstaAgindo(request), id);
  });

  app.get(
    '/conversas/:id/mensagens',
    { schema: { params: conversaParams, querystring: mensagensQuery } },
    async (request) => {
      const { id } = request.params as { id: string };
      const { antes } = request.query as { antes?: number };
      return { mensagens: await conversas.mensagens(await quemEstaAgindo(request), id, antes) };
    },
  );

  app.post('/conversas/:id/mensagens', { schema: { params: conversaParams, body: mensagemBody } }, async (request, reply) => {
    const quem = await quemEstaAgindo(request);
    const { id } = request.params as { id: string };
    const { conteudo, midiaId } = request.body as { conteudo?: string; midiaId?: string | null };
    const mensagem = await conversas.enviar(quem, id, conteudo ?? '', midiaId ?? null);
    return reply.code(201).send({ mensagem });
  });

  app.post('/conversas/:id/lidas', { schema: { params: conversaParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await conversas.marcarLidas(await quemEstaAgindo(request), id);
    return reply.code(204).send();
  });

  app.delete('/conversas/mensagens/:mensagemId', async (request, reply) => {
    const { mensagemId } = request.params as { mensagemId: string };
    const numero = Number(mensagemId);
    if (!Number.isInteger(numero) || numero < 1) throw new AppError('Mensagem inválida.', 400, 'MENSAGEM_INVALIDA');
    await conversas.apagarMensagem(await quemEstaAgindo(request), numero);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- grupo

  app.post('/conversas/:id/membros', { schema: { params: conversaParams, body: membroBody } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { usuarioId } = request.body as { usuarioId: string };
    await conversas.adicionarMembro(await quemEstaAgindo(request), id, usuarioId);
    return reply.code(204).send();
  });

  app.delete('/conversas/:id/membros/:usuarioId', { schema: { params: conversaParams } }, async (request, reply) => {
    const { id, usuarioId } = request.params as { id: string; usuarioId: string };
    await conversas.removerMembro(await quemEstaAgindo(request), id, usuarioId);
    return reply.code(204).send();
  });

  app.post('/conversas/:id/sair', { schema: { params: conversaParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await conversas.sair(await quemEstaAgindo(request), id);
    return reply.code(204).send();
  });

  app.put('/conversas/:id/nome', { schema: { params: conversaParams, body: nomeBody } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { nome } = request.body as { nome: string };
    await conversas.renomearGrupo(await quemEstaAgindo(request), id, nome);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- TI (com registro de acesso)

  app.get('/admin/conversas', async (request) => {
    requireAdmin(request);
    return { conversas: await conversas.listarComoTi(await quemEstaAgindo(request)) };
  });

  /** Abrir o conteúdo pelo TI fica registrado em conversa_acessos_ti. */
  app.get(
    '/admin/conversas/:id/mensagens',
    { schema: { params: conversaParams, querystring: mensagensQuery } },
    async (request) => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const { antes } = request.query as { antes?: number };
      return { mensagens: await conversas.lerComoTi(await quemEstaAgindo(request), id, antes) };
    },
  );

  app.get('/admin/conversas/acessos', async (request) => {
    requireAdmin(request);
    return { acessos: await conversas.acessosDoTi(await quemEstaAgindo(request)) };
  });

  app.delete('/admin/conversas/:id', { schema: { params: conversaParams } }, async (request, reply) => {
    requireAdmin(request);
    const { id } = request.params as { id: string };
    await conversas.apagarConversa(await quemEstaAgindo(request), id);
    return reply.code(204).send();
  });
};
