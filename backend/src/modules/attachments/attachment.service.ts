import type { FastifyBaseLogger } from 'fastify';
import { randomBytes } from 'node:crypto';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { AttachmentRepository } from './attachment.repository';
import { ERRO_TAMANHO, type AttachmentStorage } from './attachment.storage';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_TYPES,
  ATTACHMENT_LIMITS,
  DOWNLOAD_TICKET_TTL_MS,
  ORPHAN_FILE_GRACE_MS,
  PENDING_UPLOAD_TTL_MS,
  formatBytes,
  limitFor,
  safeExtension,
  sanitizeFileName,
  type Attachment,
  type StoredAttachment,
} from './attachment.types';

/**
 * Assinatura (primeiros bytes) dos formatos que dá para conferir de forma barata.
 * Serve para recusar um .exe renomeado para .png; formatos sem assinatura clara
 * (texto, csv) passam pela lista de tipos permitidos.
 */
const SIGNATURES: Record<string, Uint8Array[]> = {
  'image/jpeg': [new Uint8Array([0xff, 0xd8, 0xff])],
  'image/png': [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/gif': [new Uint8Array([0x47, 0x49, 0x46, 0x38])],
  'image/bmp': [new Uint8Array([0x42, 0x4d])],
  'application/pdf': [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
  // OOXML (docx/xlsx/pptx) e zip são todos arquivos ZIP
  'application/zip': [new Uint8Array([0x50, 0x4b])],
  'application/x-zip-compressed': [new Uint8Array([0x50, 0x4b])],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [new Uint8Array([0x50, 0x4b])],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [new Uint8Array([0x50, 0x4b])],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [new Uint8Array([0x50, 0x4b])],
  // Formatos antigos do Office (doc/xls/ppt): arquivo OLE2
  'application/msword': [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])],
  'application/vnd.ms-excel': [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])],
  'application/vnd.ms-powerpoint': [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])],
};

/** WEBP: "RIFF" + 4 bytes de tamanho + "WEBP" */
function isWebp(content: Buffer): boolean {
  return (
    content.length >= 12 &&
    content.subarray(0, 4).toString('latin1') === 'RIFF' &&
    content.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}

function matchesSignature(content: Buffer, mimeType: string): boolean {
  if (mimeType === 'image/webp') return isWebp(content);
  const signatures = SIGNATURES[mimeType];
  if (!signatures) return true; // texto/csv: não têm assinatura para conferir
  return signatures.some(
    (signature) => content.length >= signature.length && content.subarray(0, signature.length).equals(signature),
  );
}

export interface UploadInput {
  /** Nome escolhido pelo DP (cabeçalho X-File-Name) */
  name: string;
  /** Tipo informado pelo navegador (cabeçalho X-File-Type) */
  mimeType: string;
  /** O arquivo: em fluxo (o normal) ou inteiro na memória (arquivos pequenos) */
  content: Buffer | AsyncIterable<Buffer>;
}

/** Quantos bytes bastam para conferir a assinatura do arquivo */
const BYTES_DA_ASSINATURA = 32;

/** Link temporário de download: o <img> e o "Baixar" da Central não mandam cabeçalho de autenticação */
interface Ticket {
  attachmentId: string;
  expiresAt: number;
}

export class AttachmentService {
  /** Links válidos, só em memória: reiniciou o servidor, os links expiram */
  private readonly tickets = new Map<string, Ticket>();

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly storage: AttachmentStorage,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ---------------------------------------------------------------- envio do arquivo

  /** Recebe o arquivo do DP. Ele fica "pendente" até sair junto com um comunicado. */
  async upload(input: UploadInput, uploadedBy: string): Promise<Attachment> {
    const name = sanitizeFileName(input.name);
    if (!name) throw new AppError('Informe o nome do arquivo', 400, 'VALIDATION_ERROR');

    const mimeType = input.mimeType.split(';')[0].trim().toLowerCase();
    const allowed = ALLOWED_TYPES[mimeType];
    if (!allowed) {
      throw new AppError(
        `Tipo de arquivo não permitido. Aceitos: ${ALLOWED_EXTENSIONS.join(', ')}`,
        415,
        'ATTACHMENT_TYPE_NOT_ALLOWED',
      );
    }
    const limite = limitFor(allowed.kind);
    const id = `ATT-${randomBytes(12).toString('hex')}`;
    const storedName = `${id}${safeExtension(name, mimeType)}`;

    // O começo do arquivo vem antes de gravar qualquer coisa: é ele que diz se
    // o conteúdo combina com o tipo informado (nada de .exe virando .png)
    const { inicio, resto } = await lerInicio(input.content);
    if (inicio.length === 0) throw new AppError('O arquivo está vazio', 400, 'VALIDATION_ERROR');
    if (!matchesSignature(inicio, mimeType)) {
      throw new AppError('O conteúdo do arquivo não corresponde ao tipo informado', 400, 'ATTACHMENT_TYPE_MISMATCH');
    }

    let size: number;
    try {
      size = await this.storage.saveStream(storedName, juntar(inicio, resto), limite);
    } catch (err) {
      if ((err as Error).message === ERRO_TAMANHO) {
        throw new AppError(
          `O arquivo passa de ${formatBytes(limite)}, o limite para este tipo`,
          413,
          'ATTACHMENT_TOO_LARGE',
        );
      }
      throw err;
    }

    try {
      const stored = await this.repository.create(
        { id, messageSeq: null, name, mimeType, size, kind: allowed.kind, storedName, uploadedBy },
        new Date(),
      );
      this.log.info(`Anexo recebido: ${id} (${name}, ${formatBytes(stored.size)})`);
      return { id: stored.id, name: stored.name, mimeType: stored.mimeType, size: stored.size, kind: stored.kind };
    } catch (err) {
      await this.storage.remove(storedName); // o banco recusou: não deixa o arquivo para trás
      throw err;
    }
  }

  /** Cancela um arquivo que o DP tirou do comunicado antes de enviar */
  async deletePending(id: string, uploadedBy: string): Promise<void> {
    const stored = await this.repository.findById(id);
    if (!stored) throw new NotFoundError('Anexo não encontrado');
    if (stored.messageSeq !== null) {
      throw new AppError('O anexo já faz parte de um comunicado enviado', 400, 'ATTACHMENT_SENT');
    }
    if (stored.uploadedBy !== uploadedBy) throw new AppError('Este anexo é de outra pessoa do DP', 403, 'FORBIDDEN');
    await this.repository.delete(id);
    await this.storage.remove(stored.storedName);
  }

  // ---------------------------------------------------------------- leitura

  async get(id: string): Promise<StoredAttachment> {
    const stored = await this.repository.findById(id);
    if (!stored) throw new NotFoundError('Anexo não encontrado');
    return stored;
  }

  /** Conteúdo do anexo, para mandar na resposta HTTP */
  openStream(stored: StoredAttachment) {
    if (!this.storage.exists(stored.storedName)) {
      throw new NotFoundError('O arquivo deste anexo não está mais no servidor');
    }
    return this.storage.read(stored.storedName);
  }

  // ---------------------------------------------------------------- link temporário

  /**
   * Cria um link de curta duração para o anexo. Quem chama já conferiu que a pessoa
   * (ou o computador) pode ver o comunicado.
   */
  createTicket(id: string): { url: string; expiresIn: number } {
    this.purgeTickets();
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, { attachmentId: id, expiresAt: Date.now() + DOWNLOAD_TICKET_TTL_MS });
    return {
      url: `/api/attachments/${encodeURIComponent(id)}?t=${ticket}`,
      expiresIn: Math.floor(DOWNLOAD_TICKET_TTL_MS / 1000),
    };
  }

  /** O link vale para este anexo e ainda está no prazo? */
  checkTicket(id: string, ticket: string): boolean {
    const found = this.tickets.get(ticket);
    if (!found) return false;
    if (found.expiresAt < Date.now()) {
      this.tickets.delete(ticket);
      return false;
    }
    return found.attachmentId === id;
  }

  private purgeTickets(): void {
    const now = Date.now();
    for (const [ticket, data] of this.tickets) if (data.expiresAt < now) this.tickets.delete(ticket);
  }

  // ---------------------------------------------------------------- faxina

  /**
   * Tira do disco o que não serve mais:
   * 1. uploads que nunca viraram comunicado;
   * 2. arquivos sem registro no banco (o comunicado foi apagado pelo TI).
   */
  async sweep(): Promise<number> {
    this.purgeTickets();
    let removed = 0;

    for (const abandoned of await this.repository.listAbandoned(new Date(Date.now() - PENDING_UPLOAD_TTL_MS))) {
      await this.repository.delete(abandoned.id);
      await this.storage.remove(abandoned.storedName);
      removed += 1;
    }

    const registered = new Set(await this.repository.listStoredNames());
    const cutoff = Date.now() - ORPHAN_FILE_GRACE_MS;
    for (const file of await this.storage.list()) {
      if (registered.has(file)) continue;
      // Folga de segurança: nunca apaga um arquivo recém-gravado (upload em andamento)
      if ((await this.storage.modifiedAt(file).catch(() => Date.now())) > cutoff) continue;
      await this.storage.remove(file);
      removed += 1;
    }

    if (removed > 0) this.log.info(`Faxina de anexos: ${removed} arquivo(s) removido(s)`);
    return removed;
  }
}

/**
 * Separa os primeiros bytes (para conferir a assinatura) do resto do arquivo,
 * sem juntar tudo na memória quando o conteúdo vem em fluxo.
 */
async function lerInicio(
  content: Buffer | AsyncIterable<Buffer>,
): Promise<{ inicio: Buffer; resto: AsyncIterable<Buffer> | null }> {
  if (Buffer.isBuffer(content)) return { inicio: content, resto: null };

  const leitor = content[Symbol.asyncIterator]();
  const partes: Buffer[] = [];
  let lidos = 0;
  while (lidos < BYTES_DA_ASSINATURA) {
    const { value, done } = await leitor.next();
    if (done) break;
    const parte = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    partes.push(parte);
    lidos += parte.length;
  }
  return {
    inicio: Buffer.concat(partes),
    resto: { [Symbol.asyncIterator]: () => leitor as AsyncIterator<Buffer> },
  };
}

/** Devolve o começo já lido e, na sequência, o que ainda está chegando. */
function juntar(inicio: Buffer, resto: AsyncIterable<Buffer> | null): AsyncIterable<Buffer> {
  return {
    async *[Symbol.asyncIterator]() {
      yield inicio;
      if (resto) for await (const parte of resto) yield parte;
    },
  };
}
