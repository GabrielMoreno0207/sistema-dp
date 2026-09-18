import { nullableText, text, type SqliteDatabase } from '../../database/sqlite';
import type { ChatRepository } from './chat.repository';
import type { ChatContact, ChatConversation, ChatLastMessage, ChatMessage, ChatSender, NewChatMessage } from './chat.types';

function toChatMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: Number(row.id),
    employeeId: text(row, 'employee_id'),
    dpUserId: text(row, 'dp_user_id'),
    senderType: text(row, 'sender_type') as ChatSender,
    senderName: text(row, 'sender_name'),
    content: text(row, 'content'),
    createdAt: text(row, 'created_at'),
    readAt: nullableText(row, 'read_at'),
    automatic: Number(row.automatic ?? 0) === 1,
  };
}

function toLastMessage(row: Record<string, unknown>): ChatLastMessage | null {
  if (row.last_content === null || row.last_content === undefined) return null;
  return {
    content: text(row, 'last_content'),
    senderType: text(row, 'last_sender') as ChatSender,
    createdAt: text(row, 'last_at'),
  };
}

export class SqliteChatRepository implements ChatRepository {
  private readonly sql;

  constructor(db: SqliteDatabase) {
    this.sql = {
      insert: db.prepare(
        `INSERT INTO chat_messages (employee_id, dp_user_id, sender_type, sender_name, content, automatic, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      ),
      // As mais recentes da conversa, depois reordenadas em ordem cronológica
      listThread: db.prepare(
        `SELECT * FROM (
           SELECT * FROM chat_messages WHERE employee_id = ? AND dp_user_id = ? ORDER BY id DESC LIMIT ?
         ) ORDER BY id`,
      ),
      listConversationsForDp: db.prepare(
        `SELECT c.employee_id,
           u.name AS user_name, u.registration AS user_registration, u.sector AS user_sector, u.status AS user_status,
           last.content AS last_content, last.sender_type AS last_sender, last.created_at AS last_at,
           (SELECT COUNT(*) FROM chat_messages x
             WHERE x.employee_id = c.employee_id AND x.dp_user_id = :dpUserId
               AND x.sender_type = 'EMPLOYEE' AND x.read_at IS NULL) AS unread
         FROM (SELECT employee_id, MAX(id) AS last_id FROM chat_messages WHERE dp_user_id = :dpUserId GROUP BY employee_id) c
         JOIN chat_messages last ON last.id = c.last_id
         LEFT JOIN users u ON u.id = c.employee_id
         ORDER BY c.last_id DESC`,
      ),
      listContactsForEmployee: db.prepare(
        `SELECT u.id, u.name,
           (SELECT COUNT(*) FROM chat_messages x
             WHERE x.employee_id = :employeeId AND x.dp_user_id = u.id
               AND x.sender_type = 'DP' AND x.read_at IS NULL) AS unread,
           last.id AS last_id, last.content AS last_content, last.sender_type AS last_sender, last.created_at AS last_at
         FROM users u
         LEFT JOIN chat_messages last ON last.id = (
           SELECT MAX(m.id) FROM chat_messages m WHERE m.employee_id = :employeeId AND m.dp_user_id = u.id
         )
         WHERE u.role = 'ADMIN' AND u.status = 'ACTIVE'
           AND (u.chat_contact = 1 OR last.id IS NOT NULL)
         ORDER BY (last.id IS NULL), last.id DESC, u.name COLLATE NOCASE`,
      ),
      countUnread: db.prepare(
        `SELECT COUNT(*) AS total FROM chat_messages
         WHERE employee_id = ? AND dp_user_id = ? AND sender_type = ? AND read_at IS NULL`,
      ),
      markRead: db.prepare(
        `UPDATE chat_messages SET read_at = ?
         WHERE employee_id = ? AND dp_user_id = ? AND sender_type = ? AND read_at IS NULL`,
      ),
      lastDpMessageAt: db.prepare(
        `SELECT MAX(created_at) AS at FROM chat_messages WHERE employee_id = ? AND dp_user_id = ? AND sender_type = 'DP'`,
      ),
      // Limpeza (TI): só contagens, nunca o conteúdo das mensagens
      summaryByDpUser: db.prepare(
        `SELECT dp_user_id, COUNT(DISTINCT employee_id) AS conversations, COUNT(*) AS messages, MAX(created_at) AS last_at
         FROM chat_messages GROUP BY dp_user_id`,
      ),
      deleteConversation: db.prepare('DELETE FROM chat_messages WHERE dp_user_id = ? AND employee_id = ?'),
      deleteByDpUser: db.prepare('DELETE FROM chat_messages WHERE dp_user_id = ?'),
      deleteByDpUserBefore: db.prepare('DELETE FROM chat_messages WHERE dp_user_id = ? AND created_at < ?'),
      deleteAllChat: db.prepare('DELETE FROM chat_messages'),
      deleteAllChatBefore: db.prepare('DELETE FROM chat_messages WHERE created_at < ?'),
    };
  }

  async create(data: NewChatMessage, now: Date): Promise<ChatMessage> {
    const row = this.sql.insert.get(
      data.employeeId,
      data.dpUserId,
      data.senderType,
      data.senderName,
      data.content,
      data.automatic ? 1 : 0,
      now.toISOString(),
    ) as Record<string, unknown>;
    return toChatMessage(row);
  }

  async listThread(employeeId: string, dpUserId: string, limit: number): Promise<ChatMessage[]> {
    return this.sql.listThread.all(employeeId, dpUserId, limit).map(toChatMessage);
  }

  async listConversationsForDp(dpUserId: string): Promise<ChatConversation[]> {
    return this.sql.listConversationsForDp.all({ dpUserId }).map((row) => ({
      employee: {
        id: text(row, 'employee_id'),
        name: nullableText(row, 'user_name') ?? 'Funcionário excluído',
        registration: nullableText(row, 'user_registration'),
        sector: nullableText(row, 'user_sector'),
        status: (nullableText(row, 'user_status') as 'ACTIVE' | 'INACTIVE' | null) ?? null,
      },
      lastMessage: toLastMessage(row) as ChatLastMessage,
      unreadCount: Number(row.unread),
    }));
  }

  async listContactsForEmployee(employeeId: string): Promise<ChatContact[]> {
    return this.sql.listContactsForEmployee.all({ employeeId }).map((row) => ({
      id: text(row, 'id'),
      name: text(row, 'name'),
      unreadCount: Number(row.unread),
      lastMessage: toLastMessage(row),
    }));
  }

  async countUnread(employeeId: string, dpUserId: string, from: ChatSender): Promise<number> {
    return Number((this.sql.countUnread.get(employeeId, dpUserId, from) as Record<string, unknown>).total);
  }

  async markRead(employeeId: string, dpUserId: string, from: ChatSender, now: Date): Promise<number> {
    return Number(this.sql.markRead.run(now.toISOString(), employeeId, dpUserId, from).changes);
  }

  async lastDpMessageAt(employeeId: string, dpUserId: string): Promise<string | null> {
    const row = this.sql.lastDpMessageAt.get(employeeId, dpUserId) as Record<string, unknown>;
    return nullableText(row, 'at');
  }

  // ---------------------------------------------------------------- limpeza (conta do TI)

  async summaryByDpUser(): Promise<{ dpUserId: string; conversations: number; messages: number; lastAt: string | null }[]> {
    return this.sql.summaryByDpUser.all().map((row) => ({
      dpUserId: text(row, 'dp_user_id'),
      conversations: Number(row.conversations),
      messages: Number(row.messages),
      lastAt: nullableText(row, 'last_at'),
    }));
  }

  async deleteConversation(dpUserId: string, employeeId: string): Promise<number> {
    return Number(this.sql.deleteConversation.run(dpUserId, employeeId).changes);
  }

  async deleteMessages(dpUserId: string | null, before: Date | null): Promise<number> {
    const iso = before?.toISOString();
    if (dpUserId && iso) return Number(this.sql.deleteByDpUserBefore.run(dpUserId, iso).changes);
    if (dpUserId) return Number(this.sql.deleteByDpUser.run(dpUserId).changes);
    if (iso) return Number(this.sql.deleteAllChatBefore.run(iso).changes);
    return Number(this.sql.deleteAllChat.run().changes);
  }
}
