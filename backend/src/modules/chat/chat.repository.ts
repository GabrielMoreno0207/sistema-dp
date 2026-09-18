import type { ChatContact, ChatConversation, ChatMessage, ChatSender, NewChatMessage } from './chat.types';

/** A conversa é identificada pelo par (employeeId, dpUserId). */
export interface ChatRepository {
  create(data: NewChatMessage, now: Date): Promise<ChatMessage>;
  /** Mensagens de uma conversa em ordem cronológica (as `limit` mais recentes) */
  listThread(employeeId: string, dpUserId: string, limit: number): Promise<ChatMessage[]>;
  /** Conversas de uma pessoa do DP (Central) */
  listConversationsForDp(dpUserId: string): Promise<ChatConversation[]>;
  /** Pessoas do DP disponíveis para o funcionário (contatos + quem já conversou com ele) */
  listContactsForEmployee(employeeId: string): Promise<ChatContact[]>;
  /** Quantas mensagens enviadas por `from` nesta conversa ainda não foram lidas */
  countUnread(employeeId: string, dpUserId: string, from: ChatSender): Promise<number>;
  /** Marca como lidas as mensagens enviadas por `from` nesta conversa. Retorna quantas mudaram. */
  markRead(employeeId: string, dpUserId: string, from: ChatSender, now: Date): Promise<number>;
  /** Quando a pessoa do DP escreveu por último nesta conversa (à mão ou automático) */
  lastDpMessageAt(employeeId: string, dpUserId: string): Promise<string | null>;

  // ---- Limpeza (só a conta do TI, pela Central). Nunca devolve o conteúdo das mensagens. ----
  /** Quantas conversas e mensagens existem por pessoa do DP (sem conteúdo) */
  summaryByDpUser(): Promise<{ dpUserId: string; conversations: number; messages: number; lastAt: string | null }[]>;
  /** Apaga a conversa de uma pessoa do DP com um funcionário. Retorna quantas mensagens saíram. */
  deleteConversation(dpUserId: string, employeeId: string): Promise<number>;
  /** Apaga as conversas de uma pessoa do DP (ou todas, se dpUserId for null). Retorna quantas mensagens saíram. */
  deleteMessages(dpUserId: string | null, before: Date | null): Promise<number>;
}
