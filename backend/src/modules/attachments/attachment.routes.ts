import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import { requireAdmin } from '../auth/principal';
import { formatMessageId } from '../messages/message.types';
import type { MessageService } from '../messages/message.service';
import type { AttachmentService } from './attachment.service';
import { ATTACHMENT_ID_PATTERN, ATTACHMENT_LIMITS, type StoredAttachment } from './attachment.types';

const idParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', pattern: ATTACHMENT_ID_PATTERN } },
} as const;

const downloadQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { t: { type: 'string', minLength: 32, maxLength: 64 } },
} as const;

/** Cabeçalho de texto simples (nome do arquivo vem codificado com encodeURIComponent) */
function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Content-Disposition com o nome original (inclusive com acentos):
 * um nome simples para navegadores antigos e o nome completo em UTF-8.
 */
function contentDisposition(attachment: StoredAttachment): string {
  const kind = attachment.kind === 'IMAGE' ? 'inline' : 'attachment';
  const fallback = attachment.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`;
}

export interface AttachmentRoutesOptions {
  attachments: AttachmentService;
  messages: MessageService;
}

export const attachmentRoutes: FastifyPluginAsync<AttachmentRoutesOptions> = async (app, { attachments, messages }) => {
  /**
   * Quem pode ver o anexo: o DP (qualquer pessoa) e o computador que é destinatário
   * do comunicado. Um anexo ainda não enviado é só de quem o subiu.
   */
  async function authorize(request: FastifyRequest, attachment: StoredAttachment): Promise<void> {
    const principal = request.principal;
    if (principal?.type === 'ADMIN') {
      if (attachment.messageSeq === null && attachment.uploadedBy !== principal.userId) {
        throw new NotFoundError('Anexo não encontrado');
      }
      return;
    }
    if (principal?.type === 'COMPUTER') {
      if (attachment.messageSeq === null) throw new NotFoundError('Anexo não encontrado');
      // Lança 404 se este computador não for destinatário do comunicado
      await messages.getForComputer(formatMessageId(attachment.messageSeq), principal.computerId);
      return;
    }
    throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
  }

  // DP envia um arquivo. Ele só entra no comunicado quando o envio citar o id devolvido aqui.
  app.post(
    '/attachments',
    {
      bodyLimit: ATTACHMENT_LIMITS.maxBytes,
      onRequest: async (request) => void requireAdmin(request),
    },
    async (request, reply) => {
      const admin = requireAdmin(request);
      const content = request.body;
      if (!Buffer.isBuffer(content)) {
        throw new AppError('Envie o arquivo como application/octet-stream', 415, 'VALIDATION_ERROR');
      }
      const attachment = await attachments.upload(
        { name: header(request, 'x-file-name'), mimeType: header(request, 'x-file-type'), content },
        admin.userId,
      );
      reply.status(201);
      return { attachment };
    },
  );

  // DP tirou o arquivo do comunicado antes de enviar
  app.delete<{ Params: { id: string } }>(
    '/attachments/:id',
    { schema: { params: idParamsSchema }, onRequest: async (request) => void requireAdmin(request) },
    async (request) => {
      const admin = requireAdmin(request);
      await attachments.deletePending(request.params.id, admin.userId);
      return { ok: true };
    },
  );

  /**
   * Link temporário para abrir o anexo sem cabeçalho de autenticação
   * (a tag <img> e o botão "Baixar" do navegador não mandam o token).
   */
  app.post<{ Params: { id: string } }>('/attachments/:id/link', { schema: { params: idParamsSchema } }, async (request) => {
    const attachment = await attachments.get(request.params.id);
    await authorize(request, attachment);
    return attachments.createTicket(attachment.id);
  });

  // Conteúdo do anexo: com o token (app do computador, Central) ou com o link temporário (?t=)
  app.get<{ Params: { id: string }; Querystring: { t?: string } }>(
    '/attachments/:id',
    { schema: { params: idParamsSchema, querystring: downloadQuerySchema } },
    async (request, reply) => {
      const attachment = await attachments.get(request.params.id);
      const ticket = request.query.t;
      if (!ticket || !attachments.checkTicket(attachment.id, ticket)) await authorize(request, attachment);

      const stream = attachments.openStream(attachment);
      reply
        .header('Content-Type', attachment.mimeType)
        .header('Content-Length', String(attachment.size))
        .header('Content-Disposition', contentDisposition(attachment))
        .header('Cache-Control', 'private, max-age=300');
      return reply.send(stream);
    },
  );
};
