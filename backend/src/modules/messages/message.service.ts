import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { AttachmentRepository } from '../attachments/attachment.repository';
import { ATTACHMENT_LIMITS, formatBytes, type StoredAttachment } from '../attachments/attachment.types';
import type { ComputerService } from '../computers/computer.service';
import { COMPUTER_ID_PATTERN } from '../computers/computer.types';
import type { EmployeeService } from '../employees/employee.service';
import type { MessageRepository } from './message.repository';
import {
  isRecipient,
  parseMessageId,
  readerIdOf,
  type Message,
  type MessageRead,
  type MessageType,
  type MessageWithStats,
  type PendingView,
  type ReaderView,
  type Recipient,
  type RecipientMessage,
  type TargetType,
} from './message.types';

function toReaderView(read: MessageRead): ReaderView {
  if (read.user) {
    return {
      type: read.user.removed ? 'REMOVED' : 'EMPLOYEE',
      id: read.readerId,
      name: read.user.removed ? `${read.user.name} (excluído)` : read.user.name,
      detail: read.user.registration ? `Matrícula ${read.user.registration}` : null,
      sector: read.user.sector,
      computer: read.readOnHostname,
      readAt: read.readAt,
    };
  }
  if (read.readerHostname) {
    return {
      type: 'COMPUTER',
      id: read.readerId,
      name: read.readerHostname,
      detail: `${read.readerId} (sem funcionário logado)`,
      sector: null,
      computer: read.readerHostname,
      readAt: read.readAt,
    };
  }
  return {
    type: 'REMOVED',
    id: read.readerId,
    name: 'Funcionário excluído',
    detail: null,
    sector: null,
    computer: read.readOnHostname,
    readAt: read.readAt,
  };
}

const computerIdRegex = new RegExp(COMPUTER_ID_PATTERN);

export interface SendMessageInput {
  title: string;
  content: string;
  type: MessageType;
  target: TargetType;
  targetId?: string;
  /** Ids devolvidos por POST /api/attachments, na ordem em que o DP escolheu os arquivos */
  attachmentIds?: string[];
}

/** Quem entrega a mensagem em tempo real (implementado pelo WebSocket). */
export interface MessageNotifier {
  /** Retorna quantos computadores conectados receberam. */
  publish(message: Message): Promise<number>;
}

export class MessageService {
  constructor(
    private readonly repository: MessageRepository,
    private readonly attachments: AttachmentRepository,
    private readonly computers: ComputerService,
    private readonly employees: EmployeeService,
    private readonly notifier: MessageNotifier,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Confere o destino e devolve o targetId normalizado. */
  private async resolveTarget(target: TargetType, rawTargetId: string | undefined): Promise<string | null> {
    if (target === 'ALL') return null;

    const targetId = rawTargetId?.trim();
    if (!targetId) throw new AppError(`Informe targetId para o destino ${target}`, 400, 'VALIDATION_ERROR');

    switch (target) {
      case 'COMPUTER':
        if (!computerIdRegex.test(targetId)) throw new AppError('targetId de computador inválido', 400, 'VALIDATION_ERROR');
        await this.computers.get(targetId); // 404 se o computador não existir
        return targetId;
      case 'EMPLOYEE':
        await this.employees.getActive(targetId); // 404 se não existir ou estiver inativo
        return targetId;
      case 'SECTOR':
      case 'SHIFT': {
        const field = target === 'SECTOR' ? 'sector' : 'shift';
        if ((await this.employees.countActive(field, targetId)) === 0) {
          throw new NotFoundError(`Nenhum funcionário ativo no ${target === 'SECTOR' ? 'setor' : 'turno'} "${targetId}"`);
        }
        return targetId;
      }
      default:
        throw new AppError(`Destino ${target} ainda não implementado`, 400, 'TARGET_NOT_SUPPORTED');
    }
  }

  /**
   * Confere os arquivos que o DP subiu para este comunicado: precisam existir, ainda não
   * pertencer a outro comunicado e ser de quem está enviando.
   */
  private async resolveAttachments(ids: string[] | undefined, uploadedBy: string): Promise<StoredAttachment[]> {
    if (!ids || ids.length === 0) return [];
    const unique = [...new Set(ids)];
    if (unique.length > ATTACHMENT_LIMITS.perMessage) {
      throw new AppError(`No máximo ${ATTACHMENT_LIMITS.perMessage} anexos por comunicado`, 400, 'TOO_MANY_ATTACHMENTS');
    }

    const found = await this.attachments.findPending(unique, uploadedBy);
    if (found.length !== unique.length) {
      throw new AppError(
        'Algum anexo não está mais disponível. Anexe os arquivos novamente e envie.',
        400,
        'ATTACHMENT_NOT_AVAILABLE',
      );
    }

    const total = found.reduce((sum, attachment) => sum + attachment.size, 0);
    if (total > ATTACHMENT_LIMITS.totalBytes) {
      throw new AppError(
        `Os anexos somam ${formatBytes(total)}; o limite por comunicado é ${formatBytes(ATTACHMENT_LIMITS.totalBytes)}`,
        413,
        'ATTACHMENTS_TOO_LARGE',
      );
    }
    return found;
  }

  /** Preenche os anexos de cada comunicado (ficam em outra tabela) numa consulta só. */
  private async withAttachments<T extends Message>(messages: T[]): Promise<T[]> {
    if (messages.length === 0) return messages;
    const seqs = messages.map((message) => parseMessageId(message.id)).filter((seq): seq is number => seq !== null);
    const bySeq = await this.attachments.listForMessages(seqs);
    if (bySeq.size === 0) return messages;
    for (const message of messages) {
      const seq = parseMessageId(message.id);
      message.attachments = (seq !== null && bySeq.get(seq)) || [];
    }
    return messages;
  }

  /** Salva a mensagem e entrega imediatamente aos destinatários conectados. */
  async send(input: SendMessageInput, sender: string, senderId: string): Promise<{ message: Message; deliveredTo: number }> {
    const title = input.title.trim();
    const content = input.content.trim();
    if (!title || !content) throw new AppError('Título e conteúdo não podem ficar em branco', 400, 'VALIDATION_ERROR');

    const targetId = await this.resolveTarget(input.target, input.targetId);
    const attachments = await this.resolveAttachments(input.attachmentIds, senderId);
    const message = await this.repository.create(
      { title, content, type: input.type, target: input.target, targetId, sender },
      new Date(),
    );

    if (attachments.length > 0) {
      const seq = parseMessageId(message.id);
      if (seq !== null) await this.attachments.attachToMessage(attachments.map((a) => a.id), seq);
      message.attachments = attachments.map(({ id, name, mimeType, size, kind }) => ({ id, name, mimeType, size, kind }));
      this.log.info(`Comunicado ${message.id} com ${attachments.length} anexo(s)`);
    }

    const deliveredTo = await this.notifier.publish(message);
    this.log.info(
      `Mensagem enviada: ${message.id} (${message.type}, destino ${message.target}${targetId ? `:${targetId}` : ''}) → ${deliveredTo} PC(s) online`,
    );
    return { message, deliveredTo };
  }

  async listAll(limit: number): Promise<MessageWithStats[]> {
    return this.withAttachments(await this.repository.findAllWithStats(limit));
  }

  async getWithStats(id: string): Promise<MessageWithStats> {
    const message = await this.repository.findById(id);
    if (!message) throw new NotFoundError(`Mensagem ${id} não encontrada`);
    const [readCount, recipientCount] = await Promise.all([
      this.repository.countReads(id),
      this.repository.countRecipients(message),
    ]);
    const [withAttachments] = await this.withAttachments([{ ...message, readCount, recipientCount }]);
    return withAttachments;
  }

  /**
   * Quem leu a mensagem e, quando o destino tem lista conhecida (funcionário, setor, turno,
   * computador), quem ainda não leu. Para "Todos" a lista de pendentes não é calculada (null).
   */
  async getReads(id: string): Promise<{ message: Message; reads: ReaderView[]; pending: PendingView[] | null }> {
    const message = await this.repository.findById(id);
    if (!message) throw new NotFoundError(`Mensagem ${id} não encontrada`);
    await this.withAttachments([message]);
    const reads = await this.repository.listReads(id);
    const readerIds = new Set(reads.map((r) => r.readerId));

    let pending: PendingView[] | null = null;
    if (message.target === 'EMPLOYEE' || message.target === 'SECTOR' || message.target === 'SHIFT') {
      const all = await this.employees.list();
      const targets = all.filter((e) => {
        if (message.target === 'EMPLOYEE') return e.id === message.targetId;
        if (e.status !== 'ACTIVE') return false;
        return message.target === 'SECTOR' ? e.sector === message.targetId : e.shift === message.targetId;
      });
      pending = targets
        .filter((e) => !readerIds.has(e.id))
        .map((e) => ({
          type: 'EMPLOYEE',
          id: e.id,
          name: e.name,
          detail: `Matrícula ${e.registration}`,
          sector: e.sector,
          situation: e.status === 'ACTIVE' ? 'Ativo' : 'Inativo',
        }));
      // Destinatário individual que foi excluído sem ter lido
      if (message.target === 'EMPLOYEE' && message.targetId && targets.length === 0 && !readerIds.has(message.targetId)) {
        pending.push({
          type: 'EMPLOYEE',
          id: message.targetId,
          name: 'Funcionário excluído',
          detail: null,
          sector: null,
          situation: 'Excluído',
        });
      }
    } else if (message.target === 'COMPUTER' && message.targetId) {
      // Conta como lida se alguém leu naquele PC (o próprio PC ou um funcionário logado nele)
      const readOnTarget = reads.some((r) => r.readerId === message.targetId || r.computerId === message.targetId);
      const computer = await this.computers.get(message.targetId).catch(() => null);
      pending =
        readOnTarget || !computer
          ? []
          : [
              {
                type: 'COMPUTER',
                id: computer.computerId,
                name: computer.hostname,
                detail: computer.computerId,
                sector: null,
                situation: computer.status === 'ONLINE' ? 'Online' : 'Offline',
              },
            ];
    }

    return { message, reads: reads.map(toReaderView), pending };
  }

  /** Leitor atual do computador: o funcionário logado (se houver) e o próprio PC */
  private async recipient(computerId: string): Promise<Recipient> {
    const computer = await this.computers.get(computerId);
    const employee = await this.employees.getSessionEmployee(computerId);
    return {
      computerId,
      registeredAt: computer.registeredAt,
      employee: employee && {
        id: employee.id,
        name: employee.name,
        registration: employee.registration,
        sector: employee.sector,
        shift: employee.shift,
        createdAt: employee.createdAt,
      },
    };
  }

  async listForComputer(computerId: string, unreadOnly: boolean, limit: number) {
    const recipient = await this.recipient(computerId);
    const [messages, unreadCount] = await Promise.all([
      this.repository.findForRecipient(recipient, { unreadOnly, limit }),
      this.repository.countUnread(recipient),
    ]);
    return { messages: await this.withAttachments(messages), unreadCount };
  }

  /** Busca a mensagem garantindo que o leitor atual é destinatário (senão, 404). */
  async getForComputer(id: string, computerId: string): Promise<RecipientMessage> {
    const recipient = await this.recipient(computerId);
    const message = await this.repository.findById(id);
    if (!message || !isRecipient(message, recipient)) throw new NotFoundError(`Mensagem ${id} não encontrada`);
    const readAt = await this.repository.getReadAt(id, readerIdOf(recipient));
    const [withAttachments] = await this.withAttachments([{ ...message, read: readAt !== null, readAt }]);
    return withAttachments;
  }

  async markRead(id: string, computerId: string): Promise<{ id: string; readAt: string }> {
    const recipient = await this.recipient(computerId);
    const message = await this.repository.findById(id);
    if (!message || !isRecipient(message, recipient)) throw new NotFoundError(`Mensagem ${id} não encontrada`);
    const reader = recipient.employee && { name: recipient.employee.name, registration: recipient.employee.registration };
    const readAt = await this.repository.markRead(id, readerIdOf(recipient), computerId, reader, new Date());
    const who = recipient.employee ? `funcionário ${recipient.employee.id} no PC ${computerId}` : computerId;
    this.log.info(`Mensagem ${id} lida por ${who}`);
    return { id, readAt };
  }
}
