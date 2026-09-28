import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { env } from './config/env';
import { loggerOptions } from './config/logger';
import type { Repositories } from './database/repositories';
import { errorHandler, notFoundHandler } from './errors/error-handler';
import { registerAuthentication } from './modules/auth/auth.hooks';
import { adminRoutes } from './modules/admin/admin.routes';
import { AdminService } from './modules/admin/admin.service';
import { ConversasDoTi } from './modules/admin/conversas-do-ti';
import { attachmentRoutes } from './modules/attachments/attachment.routes';
import { AttachmentService } from './modules/attachments/attachment.service';
import { AttachmentStorage } from './modules/attachments/attachment.storage';
import { contentRoutes } from './modules/content/content.routes';
import { ContentService } from './modules/content/content.service';
import { MidiaStorage } from './modules/content/content.storage';
import { TIPOS_ACEITOS } from './modules/content/content.types';
import { eventoRoutes } from './modules/agenda/evento.routes';
import { agendamentoRoutes } from './modules/agendamentos/agendamento.routes';
import { AgendamentoService } from './modules/agendamentos/agendamento.service';
import { EventoService } from './modules/agenda/evento.service';
import { conversaRoutes } from './modules/conversas/conversa.routes';
import { ConversaService } from './modules/conversas/conversa.service';
import { ticketRoutes } from './modules/tickets/ticket.routes';
import { TicketService } from './modules/tickets/ticket.service';
import { siteRoutes } from './modules/site/site.routes';
import { updateRoutes } from './modules/updates/update.routes';
import { UpdateService } from './modules/updates/update.service';
import { UpdateStorage } from './modules/updates/update.storage';
import { ServerUpdateService } from './modules/updates/server-update.service';
import { authRoutes } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { autoReplyRoutes } from './modules/auto-replies/auto-reply.routes';
import { AutoReplyService } from './modules/auto-replies/auto-reply.service';
import { computerRoutes } from './modules/computers/computer.routes';
import { ComputerService } from './modules/computers/computer.service';
import { employeeRoutes } from './modules/employees/employee.routes';
import { EmployeeService } from './modules/employees/employee.service';
import { healthRoutes } from './modules/health/health.routes';
import { messageRoutes } from './modules/messages/message.routes';
import { MessageService } from './modules/messages/message.service';
import { sectorRoutes } from './modules/sectors/sector.routes';
import { SectorService } from './modules/sectors/sector.service';
import { createSocketServer } from './realtime/socket-server';

const TOKEN_PURGE_INTERVAL_MS = 60 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;
/** Faxina dos anexos sem dono (upload abandonado, comunicado apagado pelo TI) */
const ATTACHMENT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface BuildAppOptions {
  repositories: Repositories;
  /** Certificado e chave para HTTPS direto no backend (opcional) */
  https?: { cert: Buffer; key: Buffer } | null;
  /** Pasta dos anexos (padrão: a do .env) */
  uploadsPath?: string;
  /** Pasta com os instaladores publicados (padrão: a do .env) */
  updatesPath?: string;
  /** Pasta com as imagens e vídeos (padrão: a do .env) */
  midiasPath?: string;
}

/**
 * Monta a aplicação sem iniciar o servidor (facilita testes com app.inject()).
 */
export function buildApp({
  repositories,
  https = null,
  uploadsPath = env.uploadsPath,
  updatesPath = env.updatesPath,
  midiasPath = env.midiasPath,
}: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: loggerOptions,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: env.trustProxy,
    ...(https ? { https } : {}),
  }) as unknown as FastifyInstance;

  // Upload de anexo: o arquivo chega como corpo binário puro (nome e tipo vêm em
  // cabeçalhos) e segue em fluxo até o disco. Assim não é preciso biblioteca de
  // multipart, e uma imagem grande não precisa caber inteira na memória.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));

  // Instalador de nova versão: são dezenas de MB, então o corpo chega como fluxo
  // e vai direto para o disco, sem passar inteiro pela memória.
  app.addContentTypeParser('application/vnd.dp-atualizacao', (_request, payload, done) => done(null, payload));

  // Imagens, vídeos e áudios (mural, fotos de perfil, mensagens de voz): mesmo caminho, pelo tipo real do arquivo
  app.addContentTypeParser(/^(image|video|audio)\//, (_request, payload, done) => done(null, payload));

  // Documentos anexados às conversas (PDF, Word, Excel, TXT...): também como fluxo.
  // A lista é a mesma que o serviço aceita, para não abrir aqui um tipo que ele recusaria.
  for (const [mimeType, aceito] of Object.entries(TIPOS_ACEITOS)) {
    if (aceito.tipo !== 'ARQUIVO') continue;
    app.addContentTypeParser(mimeType, (_request, payload, done) => done(null, payload));
  }

  // Uma linha por requisição; health check só em debug para não poluir o log
  app.addHook('onResponse', async (request, reply) => {
    const level = request.url === '/api/health' ? 'debug' : 'info';
    request.log[level](
      `${request.method} ${request.url} ${reply.statusCode} ${reply.elapsedTime.toFixed(1)}ms (${request.ip})`,
    );
  });

  // Cabeçalhos básicos de segurança em todas as respostas
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // Camadas: repository (dados) -> service (regras) -> routes/socket (entrada)
  const computers = new ComputerService(repositories.computers, app.log);
  const auth = new AuthService(
    repositories.users,
    repositories.tokens,
    computers,
    { sessionTtlHours: env.sessionTtlHours },
    app.log,
  );
  const employees = new EmployeeService(
    repositories.users,
    computers,
    repositories.sectors,
    { sessaoDiasSemUso: env.sessaoDiasSemUso },
    app.log,
  );
  const sectors = new SectorService(repositories.sectors, employees, app.log);
  const realtime = createSocketServer(app, { computers, auth, employees });
  const attachments = new AttachmentService(
    repositories.attachments,
    new AttachmentStorage(uploadsPath),
    app.log,
  );
  const messages = new MessageService(repositories.messages, repositories.attachments, computers, employees, realtime, app.log);
  const autoReplies = new AutoReplyService(repositories.autoReplies, repositories.sectors, app.log);
  // Chat novo: conversas diretas, grupos e arquivos
  const conversas = new ConversaService(
    repositories.conversas,
    repositories.users,
    repositories.midias,
    autoReplies,
    realtime,
    app.log,
  );
  // Poderes extras da conta do TI (apagar comunicados e conversas, gerenciar os logins do DP)
  const admin = new AdminService(
    repositories.users,
    repositories.messages,
    new ConversasDoTi(repositories.conversas, repositories.users),
    repositories.tokens,
    attachments,
    app.log,
    realtime,
  );

  const armazemDeAtualizacoes = new UpdateStorage(updatesPath);
  const updates = new UpdateService(armazemDeAtualizacoes, app.log, realtime);
  // Atualização do próprio servidor: só funciona dentro do container (APP_PATH)
  const atualizacaoDoServidor = new ServerUpdateService(env.appPath, app.log);
  const content = new ContentService(
    repositories.midias,
    repositories.mural,
    repositories.atalhos,
    repositories.users,
    employees,
    new MidiaStorage(midiasPath),
    realtime,
    app.log,
  );

  const tickets = new TicketService(repositories.chamados, repositories.midias, employees, realtime, app.log);
  const eventos = new EventoService(repositories.eventos, app.log);
  const agendamentos = new AgendamentoService(repositories.agendamentos, messages, content, app.log);
  // Os testes disparam a conferência na mão (sem esperar o relógio)
  app.decorate('agendamentos', agendamentos);

  registerAuthentication(app, auth, employees);

  // Endereço aberto no navegador: página do Comunica Trinys com os downloads dos aplicativos
  // (a Central web foi aposentada: o DP e o TI usam o próprio aplicativo)
  app.register(siteRoutes, { updates });

  app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { auth });
      await api.register(computerRoutes, { computers, auth, realtime });
      await api.register(employeeRoutes, { employees });
      await api.register(sectorRoutes, { sectors });
      await api.register(autoReplyRoutes, { autoReplies });
      await api.register(adminRoutes, { admin });
      await api.register(messageRoutes, { messages });
      await api.register(attachmentRoutes, { attachments, messages });
      await api.register(updateRoutes, { updates, atualizacaoDoServidor, armazem: armazemDeAtualizacoes });
      await api.register(contentRoutes, { content });
      await api.register(ticketRoutes, { tickets });
      await api.register(conversaRoutes, { conversas, employees, users: repositories.users });
      await api.register(eventoRoutes, { eventos, employees });
      await api.register(agendamentoRoutes, { agendamentos });
    },
    { prefix: '/api' },
  );

  let purgeTimer: NodeJS.Timeout | null = null;
  let sessionTimer: NodeJS.Timeout | null = null;
  let attachmentTimer: NodeJS.Timeout | null = null;
  app.addHook('onReady', async () => {
    // Sessões de funcionário vencidas saem das salas do WebSocket mesmo sem nenhuma chamada do PC
    sessionTimer = setInterval(() => {
      employees.sweepExpiredSessions().catch((err) => app.log.error({ err }, 'Falha na varredura de sessões'));
    }, SESSION_SWEEP_INTERVAL_MS);
    sessionTimer.unref();
    await computers.markAllOffline(); // backend acabou de subir: nenhum PC conectado ainda
    await auth.ensureInitialAdmin(env.admin);
    await auth.purgeExpired();
    purgeTimer = setInterval(() => {
      void auth.purgeExpired();
      employees.prune();
    }, TOKEN_PURGE_INTERVAL_MS);
    purgeTimer.unref();

    // Anexos: limpa o que ficou para trás agora e de tempos em tempos
    await attachments.sweep().catch((err) => app.log.error({ err }, 'Falha na faxina de anexos'));
    attachmentTimer = setInterval(() => {
      attachments.sweep().catch((err) => app.log.error({ err }, 'Falha na faxina de anexos'));
    }, ATTACHMENT_SWEEP_INTERVAL_MS);
    attachmentTimer.unref();

    // Comunicados e mural agendados: envia o que venceu (inclusive com o servidor desligado) e confere de tempos em tempos
    await agendamentos.iniciar().catch((err) => app.log.error({ err }, 'Falha ao iniciar os agendamentos'));
  });
  app.addHook('onClose', async () => {
    if (purgeTimer) clearInterval(purgeTimer);
    if (sessionTimer) clearInterval(sessionTimer);
    if (attachmentTimer) clearInterval(attachmentTimer);
    agendamentos.parar();
  });

  return app;
}
