import type { AttachmentRepository } from '../modules/attachments/attachment.repository';
import type { AutoReplyRepository } from '../modules/auto-replies/auto-reply.repository';
import type { TokenRepository } from '../modules/auth/token.repository';
import type { ChatRepository } from '../modules/chat/chat.repository';
import type { ComputerRepository } from '../modules/computers/computer.repository';
import type { MessageRepository } from '../modules/messages/message.repository';
import type { SectorRepository } from '../modules/sectors/sector.repository';
import type { UserRepository } from '../modules/users/user.repository';
import { PostgresAttachmentRepository } from '../modules/attachments/attachment.postgres-repository';
import { PostgresAutoReplyRepository } from '../modules/auto-replies/auto-reply.postgres-repository';
import { PostgresTokenRepository } from '../modules/auth/token.postgres-repository';
import { PostgresChatRepository } from '../modules/chat/chat.postgres-repository';
import { PostgresComputerRepository } from '../modules/computers/computer.postgres-repository';
import { PostgresMessageRepository } from '../modules/messages/message.postgres-repository';
import { PostgresSectorRepository } from '../modules/sectors/sector.postgres-repository';
import { PostgresUserRepository } from '../modules/users/user.postgres-repository';
import {
  PostgresAtalhoRepository,
  PostgresMidiaRepository,
  PostgresMuralRepository,
} from '../modules/content/content.postgres-repository';
import type { AtalhoRepository, MidiaRepository, MuralRepository } from '../modules/content/content.repository';
import { PostgresChamadoRepository } from '../modules/tickets/ticket.postgres-repository';
import type { ChamadoRepository } from '../modules/tickets/ticket.repository';
import { PostgresEventoRepository } from '../modules/agenda/evento.postgres-repository';
import type { EventoRepository } from '../modules/agenda/evento.repository';
import { PostgresConversaRepository } from '../modules/conversas/conversa.postgres-repository';
import type { ConversaRepository } from '../modules/conversas/conversa.repository';
import type { PostgresDatabase } from './postgres';

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
  /** Imagens e vídeos do mural e fotos de perfil */
  midias: MidiaRepository;
  /** Recado fixado na tela inicial */
  mural: MuralRepository;
  /** Atalhos que cada colaborador monta */
  atalhos: AtalhoRepository;
  /** Chamados abertos para o TI */
  chamados: ChamadoRepository;
  /** Conversas do chat (diretas e grupos) */
  conversas: ConversaRepository;
  /** Eventos do calendário da tela inicial */
  eventos: EventoRepository;
}

/** Implementações PostgreSQL: é o único banco do sistema. */
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
    midias: new PostgresMidiaRepository(db),
    mural: new PostgresMuralRepository(db),
    atalhos: new PostgresAtalhoRepository(db),
    chamados: new PostgresChamadoRepository(db),
    conversas: new PostgresConversaRepository(db),
    eventos: new PostgresEventoRepository(db),
  };
}
