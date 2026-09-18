import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { AttachmentService } from '../attachments/attachment.service';
import { hashSecret } from '../auth/crypto';
import type { TokenRepository } from '../auth/token.repository';
import type { ChatRepository } from '../chat/chat.repository';
import type { MessageRepository } from '../messages/message.repository';
import type { UserRepository } from '../users/user.repository';
import { toPublicUser, type PublicUser } from '../users/user.types';

/** Conversas de uma pessoa do DP, só em números (o TI não lê o conteúdo) */
export interface ChatSummaryItem {
  dpUserId: string;
  name: string;
  username: string;
  conversations: number;
  messages: number;
  lastAt: string | null;
}

export interface AdminUserView extends PublicUser {
  status: 'ACTIVE' | 'INACTIVE';
  /** Aparece na lista de contatos do chat no aplicativo */
  chatContact: boolean;
  createdAt: string;
}

const PASSWORD_MIN = 8;

/**
 * Poderes extras da conta do TI (Central → seção TI):
 * apagar comunicados, apagar conversas (sem ler o conteúdo) e gerenciar os logins do DP.
 * O acesso é barrado nas rotas por requireSuperAdmin.
 */
export class AdminService {
  constructor(
    private readonly users: UserRepository,
    private readonly messages: MessageRepository,
    private readonly chat: ChatRepository,
    private readonly tokens: TokenRepository,
    private readonly attachments: AttachmentService,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ---------------------------------------------------------------- comunicados

  async deleteMessage(messageId: string): Promise<void> {
    if (!(await this.messages.delete(messageId))) throw new NotFoundError('Comunicado não encontrado');
    this.log.warn(`TI apagou o comunicado ${messageId}`);
    await this.sweepAttachments();
  }

  /** Os anexos saem junto com o comunicado (o registro cai por cascata; o arquivo, aqui) */
  private async sweepAttachments(): Promise<void> {
    await this.attachments.sweep().catch((err) => this.log.error({ err }, 'Falha ao remover os anexos apagados'));
  }

  /** olderThanDays null/0 = apaga todos */
  async purgeMessages(olderThanDays: number | null): Promise<number> {
    const removed =
      olderThanDays && olderThanDays > 0
        ? await this.messages.deleteOlderThan(new Date(Date.now() - olderThanDays * 86_400_000))
        : await this.messages.deleteAll();
    this.log.warn(`TI apagou ${removed} comunicado(s)${olderThanDays ? ` com mais de ${olderThanDays} dia(s)` : ''}`);
    await this.sweepAttachments();
    return removed;
  }

  // ---------------------------------------------------------------- conversas do chat

  async chatSummary(): Promise<ChatSummaryItem[]> {
    const admins = await this.users.listByRole('ADMIN');
    const summary = await this.chat.summaryByDpUser();
    return admins
      .map((user) => {
        const found = summary.find((s) => s.dpUserId === user.id);
        return {
          dpUserId: user.id,
          name: user.name,
          username: user.username,
          conversations: found?.conversations ?? 0,
          messages: found?.messages ?? 0,
          lastAt: found?.lastAt ?? null,
        };
      })
      .sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name, 'pt-BR'));
  }

  async deleteConversation(dpUserId: string, employeeId: string): Promise<number> {
    const removed = await this.chat.deleteConversation(dpUserId, employeeId);
    this.log.warn(`TI apagou uma conversa (${removed} mensagem(ns))`);
    return removed;
  }

  /** dpUserId null = todas as pessoas do DP; olderThanDays null/0 = tudo */
  async purgeChat(dpUserId: string | null, olderThanDays: number | null): Promise<number> {
    if (dpUserId && !(await this.users.findById(dpUserId))) throw new NotFoundError('Pessoa do DP não encontrada');
    const before = olderThanDays && olderThanDays > 0 ? new Date(Date.now() - olderThanDays * 86_400_000) : null;
    const removed = await this.chat.deleteMessages(dpUserId, before);
    this.log.warn(`TI apagou ${removed} mensagem(ns) de chat`);
    return removed;
  }

  // ---------------------------------------------------------------- logins do DP

  async listUsers(): Promise<AdminUserView[]> {
    const admins = await this.users.listByRole('ADMIN');
    return admins.map((user) => ({
      ...toPublicUser(user),
      status: user.status,
      chatContact: user.chatContact,
      createdAt: user.createdAt,
    }));
  }

  private validPassword(password: string): void {
    if (password.length < PASSWORD_MIN) {
      throw new AppError(`A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres`, 400, 'VALIDATION_ERROR');
    }
  }

  async createUser(input: { username: string; name: string; password: string; chatContact: boolean }): Promise<PublicUser> {
    const username = input.username.trim().toLowerCase();
    const name = input.name.trim();
    if (!username || !name) throw new AppError('Informe o usuário e o nome', 400, 'VALIDATION_ERROR');
    this.validPassword(input.password);
    if (await this.users.findByUsername(username)) {
      throw new AppError(`Já existe um login "${username}"`, 409, 'USER_EXISTS');
    }
    const user = await this.users.create(
      {
        username,
        name,
        registration: null,
        sector: 'Departamento Pessoal',
        shift: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        chatContact: input.chatContact,
        superAdmin: false, // só a conta do TI tem os poderes extras
        passwordHash: await hashSecret(input.password),
      },
      new Date(),
    );
    this.log.info(`TI criou o login do DP: ${username}`);
    return toPublicUser(user);
  }

  private async otherAdmin(selfId: string, userId: string) {
    if (userId === selfId) throw new AppError('Não é possível alterar a própria conta do TI por aqui', 400, 'SELF_CHANGE');
    const user = await this.users.findById(userId);
    if (!user || user.role !== 'ADMIN') throw new NotFoundError('Login não encontrado');
    if (user.superAdmin) throw new AppError('Este login é do TI e não pode ser alterado por aqui', 400, 'SUPER_ADMIN');
    return user;
  }

  async setStatus(selfId: string, userId: string, status: 'ACTIVE' | 'INACTIVE'): Promise<void> {
    const user = await this.otherAdmin(selfId, userId);
    await this.users.updateStatus(userId, status);
    if (status === 'INACTIVE') await this.tokens.deleteBySubject('USER', userId); // derruba a sessão aberta
    this.log.info(`TI ${status === 'ACTIVE' ? 'ativou' : 'desativou'} o login ${user.username}`);
  }

  async resetPassword(selfId: string, userId: string, password: string): Promise<void> {
    const user = await this.otherAdmin(selfId, userId);
    this.validPassword(password);
    await this.users.updatePassword(userId, await hashSecret(password), false);
    await this.tokens.deleteBySubject('USER', userId); // a pessoa entra de novo com a senha nova
    this.log.info(`TI redefiniu a senha do login ${user.username}`);
  }
}
