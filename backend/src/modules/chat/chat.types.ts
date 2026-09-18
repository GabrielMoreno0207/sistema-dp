export const CHAT_CONTENT_MAX = 2000;

export type ChatSender = 'DP' | 'EMPLOYEE';

/**
 * Uma mensagem do chat. A conversa é o par (funcionário, pessoa do DP):
 * cada pessoa do DP tem as próprias conversas.
 */
export interface ChatMessage {
  id: number;
  employeeId: string;
  /** Pessoa do DP desta conversa */
  dpUserId: string;
  senderType: ChatSender;
  senderName: string;
  content: string;
  createdAt: string;
  /** Quando o outro lado leu */
  readAt: string | null;
  /** Enviada pela resposta automática da pessoa do DP */
  automatic: boolean;
}

export type NewChatMessage = Omit<ChatMessage, 'id' | 'createdAt' | 'readAt'>;

export interface ChatLastMessage {
  content: string;
  senderType: ChatSender;
  createdAt: string;
}

/** Conversa na Central (visão de uma pessoa do DP) */
export interface ChatConversation {
  employee: {
    id: string;
    name: string;
    registration: string | null;
    sector: string | null;
    /** null = funcionário excluído (a conversa fica no histórico) */
    status: 'ACTIVE' | 'INACTIVE' | null;
  };
  lastMessage: ChatLastMessage;
  /** Mensagens do funcionário que esta pessoa do DP ainda não leu */
  unreadCount: number;
}

/** Contato do DP na lista do app (visão do funcionário) */
export interface ChatContact {
  id: string;
  name: string;
  /** Mensagens desta pessoa do DP que o funcionário ainda não leu */
  unreadCount: number;
  lastMessage: ChatLastMessage | null;
}
