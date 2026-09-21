import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { ChatRepository } from './chat.repository';
import type { ChatContact, ChatConversation, ChatLastMessage, ChatMessage, ChatSender, NewChatMessage } from './chat.types';

function toChatMessage(row: Row): ChatMessage {
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

function toLastMessage(row: Row): ChatLastMessage | null {
  if (row.last_content === null || row.last_content === undefined) return null;
  return {
    content: text(row, 'last_content'),
    senderType: text(row, 'last_sender') as ChatSender,
    createdAt: text(row, 'last_at'),
  };
}

export class PostgresChatRepository implements ChatRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async create(data: NewChatMessage, now: Date): Promise<ChatMessage> {
    const row = await this.db.one(
      `INSERT INTO chat_messages (employee_id, dp_user_id, sender_type, sender_name, content, automatic, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [data.employeeId, data.dpUserId, data.senderType, data.senderName, data.content, data.automatic ? 1 : 0, now.toISOString()],
    );
    return toChatMessage(row as Row);
  }

  async listThread(employeeId: string, dpUserId: string, limit: number): Promise<ChatMessage[]> {
    // As mais recentes da conversa, depois reordenadas em ordem cronológica
    const rows = await this.db.all(
      `SELECT * FROM (
         SELECT * FROM chat_messages WHERE employee_id = $1 AND dp_user_id = $2 ORDER BY id DESC LIMIT $3
       ) AS ultimas ORDER BY id`,
      [employeeId, dpUserId, limit],
    );
    return rows.map(toChatMessage);
  }

  async listConversationsForDp(dpUserId: string): Promise<ChatConversation[]> {
    const rows = await this.db.all(
      `SELECT c.employee_id,
         u.name AS user_name, u.registration AS user_registration, u.sector AS user_sector, u.status AS user_status,
         last.content AS last_content, last.sender_type AS last_sender, last.created_at AS last_at,
         (SELECT COUNT(*) FROM chat_messages x
           WHERE x.employee_id = c.employee_id AND x.dp_user_id = $1
             AND x.sender_type = 'EMPLOYEE' AND x.read_at IS NULL) AS unread
       FROM (SELECT employee_id, MAX(id) AS last_id FROM chat_messages WHERE dp_user_id = $1 GROUP BY employee_id) c
       JOIN chat_messages last ON last.id = c.last_id
       LEFT JOIN users u ON u.id = c.employee_id
       ORDER BY c.last_id DESC`,
      [dpUserId],
    );
    return rows.map((row) => ({
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
    const rows = await this.db.all(
      `SELECT u.id, u.name,
         (SELECT COUNT(*) FROM chat_messages x
           WHERE x.employee_id = $1 AND x.dp_user_id = u.id
             AND x.sender_type = 'DP' AND x.read_at IS NULL) AS unread,
         last.id AS last_id, last.content AS last_content, last.sender_type AS last_sender, last.created_at AS last_at
       FROM users u
       LEFT JOIN chat_messages last ON last.id = (
         SELECT MAX(m.id) FROM chat_messages m WHERE m.employee_id = $1 AND m.dp_user_id = u.id
       )
       WHERE u.role = 'ADMIN' AND u.status = 'ACTIVE'
         AND (u.chat_contact = 1 OR last.id IS NOT NULL)
       ORDER BY (last.id IS NULL), last.id DESC NULLS LAST, lower(u.name)`,
      [employeeId],
    );
    return rows.map((row) => ({
      id: text(row, 'id'),
      name: text(row, 'name'),
      unreadCount: Number(row.unread),
      lastMessage: toLastMessage(row),
    }));
  }

  async countUnread(employeeId: string, dpUserId: string, from: ChatSender): Promise<number> {
    const row = await this.db.one(
      `SELECT COUNT(*) AS total FROM chat_messages
       WHERE employee_id = $1 AND dp_user_id = $2 AND sender_type = $3 AND read_at IS NULL`,
      [employeeId, dpUserId, from],
    );
    return Number(row?.total ?? 0);
  }

  async markRead(employeeId: string, dpUserId: string, from: ChatSender, now: Date): Promise<number> {
    return this.db.run(
      `UPDATE chat_messages SET read_at = $1
       WHERE employee_id = $2 AND dp_user_id = $3 AND sender_type = $4 AND read_at IS NULL`,
      [now.toISOString(), employeeId, dpUserId, from],
    );
  }

  async lastDpMessageAt(employeeId: string, dpUserId: string): Promise<string | null> {
    const row = await this.db.one(
      `SELECT MAX(created_at) AS at FROM chat_messages WHERE employee_id = $1 AND dp_user_id = $2 AND sender_type = 'DP'`,
      [employeeId, dpUserId],
    );
    return row ? nullableText(row, 'at') : null;
  }

  // ---------------------------------------------------------------- limpeza (conta do TI)

  async summaryByDpUser(): Promise<{ dpUserId: string; conversations: number; messages: number; lastAt: string | null }[]> {
    const rows = await this.db.all(
      `SELECT dp_user_id, COUNT(DISTINCT employee_id) AS conversations, COUNT(*) AS messages, MAX(created_at) AS last_at
       FROM chat_messages GROUP BY dp_user_id`,
    );
    return rows.map((row) => ({
      dpUserId: text(row, 'dp_user_id'),
      conversations: Number(row.conversations),
      messages: Number(row.messages),
      lastAt: nullableText(row, 'last_at'),
    }));
  }

  async deleteConversation(dpUserId: string, employeeId: string): Promise<number> {
    return this.db.run('DELETE FROM chat_messages WHERE dp_user_id = $1 AND employee_id = $2', [dpUserId, employeeId]);
  }

  async deleteMessages(dpUserId: string | null, before: Date | null): Promise<number> {
    const iso = before?.toISOString();
    if (dpUserId && iso) {
      return this.db.run('DELETE FROM chat_messages WHERE dp_user_id = $1 AND created_at < $2', [dpUserId, iso]);
    }
    if (dpUserId) return this.db.run('DELETE FROM chat_messages WHERE dp_user_id = $1', [dpUserId]);
    if (iso) return this.db.run('DELETE FROM chat_messages WHERE created_at < $1', [iso]);
    return this.db.run('DELETE FROM chat_messages');
  }
}
