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
import { PostgresAttachmentRepository } from '../modules/attachments/attachment.postgres-repository';
import { PostgresAutoReplyRepository } from '../modules/auto-replies/auto-reply.postgres-repository';
import { PostgresTokenRepository } from '../modules/auth/token.postgres-repository';
import { PostgresChatRepository } from '../modules/chat/chat.postgres-repository';
import { PostgresComputerRepository } from '../modules/computers/computer.postgres-repository';
import { PostgresMessageRepository } from '../modules/messages/message.postgres-repository';
import { PostgresSectorRepository } from '../modules/sectors/sector.postgres-repository';
import { PostgresUserRepository } from '../modules/users/user.postgres-repository';
import type { PostgresDatabase } from './postgres';
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
 * Implementações SQLite (banco padrão quando DATABASE_URL não está definida).
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

/**
 * Implementações PostgreSQL. As mesmas interfaces de cima, então nada muda
 * para os serviços e rotas: só a fábrica usada na inicialização.
 */
export function createPostgresRepositories(db: PostgresDatabase): Repositories {
  return {
    computers: new PostgresComputerRepository(db),
    messages: new PostgresMessageRepository(db),
    attachments: new PostgresAttachmentRepository(db),
    users: new PostgresUserRepository(db),
    tokens: new PostgresTokenRepository(db),
    sectors: new PostgresSectorRepository(db),
    chat: new PostgresChatRepository(db),
    autoReplies: new PostgresAutoReplyRepository(db),
  };
}
