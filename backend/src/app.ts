import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { env } from './config/env';
import { loggerOptions } from './config/logger';
import type { Repositories } from './database/repositories';
import { errorHandler, notFoundHandler } from './errors/error-handler';
import { registerAuthentication } from './modules/auth/auth.hooks';
import { adminRoutes } from './modules/admin/admin.routes';
import { AdminService } from './modules/admin/admin.service';
import { attachmentRoutes } from './modules/attachments/attachment.routes';
import { AttachmentService } from './modules/attachments/attachment.service';
import { AttachmentStorage } from './modules/attachments/attachment.storage';
import { contentRoutes } from './modules/content/content.routes';
import { ContentService } from './modules/content/content.service';
import { MidiaStorage } from './modules/content/content.storage';
import { updateRoutes } from './modules/updates/update.routes';
import { UpdateService } from './modules/updates/update.service';
import { UpdateStorage } from './modules/updates/update.storage';
import { ATTACHMENT_LIMITS } from './modules/attachments/attachment.types';
import { authRoutes } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { autoReplyRoutes } from './modules/auto-replies/auto-reply.routes';
import { AutoReplyService } from './modules/auto-replies/auto-reply.service';
import { chatRoutes } from './modules/chat/chat.routes';
import { ChatService } from './modules/chat/chat.service';
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

  // Upload de anexo: o arquivo chega como corpo binário puro (nome e tipo vêm em cabeçalhos).
  // Assim não é preciso nenhuma biblioteca de multipart.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: ATTACHMENT_LIMITS.maxBytes },
    (_request, body, done) => done(null, body),
  );

  // Instalador de nova versão: são dezenas de MB, então o corpo chega como fluxo
  // e vai direto para o disco, sem passar inteiro pela memória.
  app.addContentTypeParser('application/vnd.dp-atualizacao', (_request, payload, done) => done(null, payload));

  // Imagens e vídeos do mural e fotos de perfil: mesmo caminho, pelo tipo real do arquivo
  app.addContentTypeParser(/^(image|video)\//, (_request, payload, done) => done(null, payload));

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
    if (request.url.startsWith('/central')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      );
    }
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
    { sessionHours: env.employeeSessionHours },
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
  const chat = new ChatService(repositories.chat, employees, repositories.users, realtime, autoReplies, app.log);
  // Poderes extras da conta do TI (apagar comunicados e conversas, gerenciar os logins do DP)
  const admin = new AdminService(
    repositories.users,
    repositories.messages,
    repositories.chat,
    repositories.tokens,
    attachments,
    app.log,
  );

  const updates = new UpdateService(new UpdateStorage(updatesPath), app.log);
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

  registerAuthentication(app, auth);

  // Central do DP: página estática (HTML/CSS/JS) que usa a própria API REST
  app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public', 'central'),
    prefix: '/central/',
  });
  app.get('/central', (_request, reply) => reply.redirect('/central/'));
  app.get('/', (_request, reply) => reply.redirect('/central/'));

  app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { auth });
      await api.register(computerRoutes, { computers, auth, realtime });
      await api.register(employeeRoutes, { employees });
      await api.register(sectorRoutes, { sectors });
      await api.register(chatRoutes, { chat });
      await api.register(autoReplyRoutes, { autoReplies });
      await api.register(adminRoutes, { admin });
      await api.register(messageRoutes, { messages });
      await api.register(attachmentRoutes, { attachments, messages });
      await api.register(updateRoutes, { updates });
      await api.register(contentRoutes, { content });
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
  });
  app.addHook('onClose', async () => {
    if (purgeTimer) clearInterval(purgeTimer);
    if (sessionTimer) clearInterval(sessionTimer);
    if (attachmentTimer) clearInterval(attachmentTimer);
  });

  return app;
}
