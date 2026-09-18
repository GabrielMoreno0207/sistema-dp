import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { AutoReplyService } from '../auto-replies/auto-reply.service';
import { AUTO_REPLY_COOLDOWN_MINUTES, renderAutoReply } from '../auto-replies/auto-reply.types';
import type { EmployeeService } from '../employees/employee.service';
import type { User } from '../users/user.types';
import type { UserRepository } from '../users/user.repository';
import type { ChatRepository } from './chat.repository';
import { CHAT_CONTENT_MAX, type ChatContact, type ChatConversation, type ChatMessage } from './chat.types';

const THREAD_LIMIT = 300;

/** Quem entrega as mensagens do chat em tempo real ao app (WebSocket) */
export interface ChatNotifier {
  /** Envia à sala do funcionário. Retorna quantos PCs conectados receberam. */
  chatMessage(message: ChatMessage): Promise<number>;
}

function validContent(raw: string): string {
  const content = raw.trim();
  if (!content) throw new AppError('A mensagem não pode ficar em branco', 400, 'VALIDATION_ERROR');
  if (content.length > CHAT_CONTENT_MAX) {
    throw new AppError(`Mensagem com no máximo ${CHAT_CONTENT_MAX} caracteres`, 400, 'VALIDATION_ERROR');
  }
  return content;
}

/**
 * Chat individual: cada pessoa do DP tem as próprias conversas, e cada funcionário
 * pode conversar com qualquer pessoa do DP. Os dois lados podem iniciar.
 * O app recebe em tempo real; a Central atualiza periodicamente.
 */
export class ChatService {
  constructor(
    private readonly repository: ChatRepository,
    private readonly employees: EmployeeService,
    private readonly users: UserRepository,
    private readonly notifier: ChatNotifier,
    private readonly autoReplies: AutoReplyService,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Pessoa do DP válida para conversar (login da Central ativo) */
  private async dpUser(dpUserId: string) {
    const user = await this.users.findById(dpUserId);
    if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') throw new NotFoundError('Pessoa do DP não encontrada');
    return user;
  }

  /** Reenvia ao app as mensagens que acabaram de ser lidas, para o "✓ lida" aparecer na hora */
  private async pushReadReceipts(employeeId: string, dpUserId: string, readAt: string): Promise<void> {
    for (const message of await this.repository.listThread(employeeId, dpUserId, THREAD_LIMIT)) {
      if (message.senderType === 'EMPLOYEE' && message.readAt === readAt) await this.notifier.chatMessage(message);
    }
  }

  // ---------------------------------------------------------------- lado do DP (Central): só as próprias conversas

  listConversations(dpUserId: string): Promise<ChatConversation[]> {
    return this.repository.listConversationsForDp(dpUserId);
  }

  /** Conversa com um funcionário (pode estar inativo, para consultar o histórico) */
  async threadForDp(dpUserId: string, employeeId: string): Promise<{ messages: ChatMessage[] }> {
    await this.employees.getAny(employeeId);
    return { messages: await this.repository.listThread(employeeId, dpUserId, THREAD_LIMIT) };
  }

  async sendFromDp(
    dpUserId: string,
    dpName: string,
    employeeId: string,
    rawContent: string,
  ): Promise<{ message: ChatMessage; deliveredTo: number }> {
    const employee = await this.employees.getActive(employeeId); // só para funcionários ativos
    const message = await this.repository.create(
      { employeeId, dpUserId, senderType: 'DP', senderName: dpName, content: validContent(rawContent), automatic: false },
      new Date(),
    );
    const deliveredTo = await this.notifier.chatMessage(message);
    this.log.info(`Chat: ${dpName} → ${employee.name} (matrícula ${employee.registration}) · ${deliveredTo} PC(s) online`);
    return { message, deliveredTo };
  }

  async markReadByDp(dpUserId: string, employeeId: string): Promise<void> {
    const now = new Date();
    if ((await this.repository.markRead(employeeId, dpUserId, 'EMPLOYEE', now)) > 0) {
      await this.pushReadReceipts(employeeId, dpUserId, now.toISOString());
    }
  }

  // ---------------------------------------------------------------- lado do funcionário (app)

  private async sessionEmployee(computerId: string) {
    const employee = await this.employees.getSessionEmployee(computerId);
    if (!employee) throw new AppError('Entre com sua matrícula para usar as mensagens', 401, 'NO_EMPLOYEE');
    return employee;
  }

  /** Pessoas do DP com quem o funcionário pode conversar, com não lidas e última mensagem */
  async contactsForEmployee(computerId: string): Promise<{ contacts: ChatContact[]; unreadCount: number }> {
    const employee = await this.sessionEmployee(computerId);
    const contacts = await this.repository.listContactsForEmployee(employee.id);
    return { contacts, unreadCount: contacts.reduce((sum, c) => sum + c.unreadCount, 0) };
  }

  async threadForEmployee(computerId: string, dpUserId: string): Promise<{ messages: ChatMessage[]; unreadCount: number }> {
    const employee = await this.sessionEmployee(computerId);
    await this.dpUser(dpUserId);
    const [messages, unreadCount] = await Promise.all([
      this.repository.listThread(employee.id, dpUserId, THREAD_LIMIT),
      this.repository.countUnread(employee.id, dpUserId, 'DP'),
    ]);
    return { messages, unreadCount };
  }

  async sendFromEmployee(computerId: string, dpUserId: string, rawContent: string): Promise<ChatMessage> {
    const employee = await this.sessionEmployee(computerId);
    const dp = await this.dpUser(dpUserId);
    // Guardado antes de salvar a mensagem: a resposta automática olha só o que o DP escreveu antes dela
    const lastDpAt = await this.repository.lastDpMessageAt(employee.id, dpUserId);
    const message = await this.repository.create(
      {
        employeeId: employee.id,
        dpUserId,
        senderType: 'EMPLOYEE',
        senderName: employee.name,
        content: validContent(rawContent),
        automatic: false,
      },
      new Date(),
    );
    // Também vai para a sala do funcionário: se ele estiver logado em outro PC, a conversa se atualiza lá
    await this.notifier.chatMessage(message);
    this.log.info(`Chat: ${employee.name} (matrícula ${employee.registration}) → ${dp.name}, pelo PC ${computerId}`);
    await this.sendAutoReply(employee, dp, lastDpAt).catch((err) => this.log.error({ err }, 'Falha na resposta automática'));
    return message;
  }

  /**
   * Resposta automática da pessoa do DP (configurada por ela na Central, por setor).
   * Não responde se ela escreveu nessa conversa (à mão ou automático) há menos de AUTO_REPLY_COOLDOWN_MINUTES.
   * Não marca nada como lido: a pessoa do DP continua vendo a conversa como não lida.
   */
  private async sendAutoReply(
    employee: { id: string; name: string; sector: string | null },
    dp: User,
    lastDpAt: string | null,
  ): Promise<void> {
    const rule = await this.autoReplies.ruleFor(dp.id, employee.sector);
    if (!rule) return;
    if (lastDpAt && Date.now() - Date.parse(lastDpAt) < AUTO_REPLY_COOLDOWN_MINUTES * 60_000) return;
    const content = renderAutoReply(rule.content, { employeeName: employee.name, sector: employee.sector, dpName: dp.name })
      .trim()
      .slice(0, CHAT_CONTENT_MAX);
    if (!content) return;
    const reply = await this.repository.create(
      { employeeId: employee.id, dpUserId: dp.id, senderType: 'DP', senderName: dp.name, content, automatic: true },
      new Date(),
    );
    await this.notifier.chatMessage(reply);
    this.log.info(`Chat: resposta automática de ${dp.name} → ${employee.name} (${rule.sector ?? 'todos os setores'})`);
  }

  async markReadByEmployee(computerId: string, dpUserId: string): Promise<void> {
    const employee = await this.sessionEmployee(computerId);
    await this.repository.markRead(employee.id, dpUserId, 'DP', new Date());
  }
}
