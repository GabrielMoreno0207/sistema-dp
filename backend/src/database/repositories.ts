import type { AttachmentRepository } from '../modules/attachments/attachment.repository';
import { SqliteAttachmentRepository } from '../modules/attachments/attachment.sqlite-repository';
import type { AutoReplyRepository } from '../modules/auto-replies/auto-reply.repository';
import { SqliteAutoReplyRepository } from '../modules/auto-replies/auto-reply.sqlite-repository';
import type { TokenRepository } from '../modules/auth/token.repository';
import { SqliteTokenRepository } from '../modules/auth/token.sqlite-repository';
import type { ChatRepository } from '../modules/chat/chat.repository';
import { SqliteChatRepository } from '../modules/chat/chat.sqlite-repository';
import type { ComputerRepository } from '../modules/computers/computer.repository';
import { SqliteComputerRepository } from '../modules/computers/computer.sqlite-repository';
import type { MessageRepository } from '../modules/messages/message.repository';
import { SqliteMessageRepository } from '../modules/messages/message.sqlite-repository';
import type { SectorRepository } from '../modules/sectors/sector.repository';
import { SqliteSectorRepository } from '../modules/sectors/sector.sqlite-repository';
import type { UserRepository } from '../modules/users/user.repository';
import { SqliteUserRepository } from '../modules/users/user.sqlite-repository';
import type { SqliteDatabase } from './sqlite';

/** Tudo que a aplicação precisa da camada de dados (só interfaces). */
export interface Repositories {
  computers: ComputerRepository;
  messages: MessageRepository;
  attachments: AttachmentRepository;
  users: UserRepository;
  tokens: TokenRepository;
  sectors: SectorRepository;
  chat: ChatRepository;
  autoReplies: AutoReplyRepository;
}

/**
 * Implementações SQLite. Trocar de banco (PostgreSQL, Oracle) = criar classes
 * que implementam as mesmas interfaces e uma fábrica como esta.
 */
export function createSqliteRepositories(db: SqliteDatabase): Repositories {
  return {
    computers: new SqliteComputerRepository(db),
    messages: new SqliteMessageRepository(db),
    attachments: new SqliteAttachmentRepository(db),
    users: new SqliteUserRepository(db),
    tokens: new SqliteTokenRepository(db),
    sectors: new SqliteSectorRepository(db),
    chat: new SqliteChatRepository(db),
    autoReplies: new SqliteAutoReplyRepository(db),
  };
}
