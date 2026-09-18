import { EventEmitter } from 'node:events';
import type { ChatContact, ChatMessage, ChatState } from '../shared/types';

/**
 * Chat do funcionário logado com as pessoas do DP (uma conversa por pessoa), mantido pelo processo main.
 * Não é guardado em disco: o chat é da pessoa (não do computador) e vem do servidor a cada conexão/login.
 * Guarda a lista de contatos (com não lidas e última mensagem) e as conversas já abertas.
 * Emite 'change' sempre que algo muda.
 */
export class ChatStore extends EventEmitter<{ change: [ChatState] }> {
  private contacts: ChatContact[] = [];
  /** Conversas já carregadas: dpUserId -> mensagens por id */
  private readonly conversations = new Map<string, Map<number, ChatMessage>>();
  private openContactId: string | null = null;
  private loading = false;
  private available = false;

  getState(): ChatState {
    const open = this.openContactId ? this.conversations.get(this.openContactId) : undefined;
    return {
      contacts: this.contacts.map((c) => ({ ...c })),
      unreadCount: this.contacts.reduce((sum, c) => sum + c.unreadCount, 0),
      available: this.available,
      openContactId: this.openContactId,
      messages: open ? [...open.values()].sort((a, b) => a.id - b.id) : [],
      loadingConversation: this.loading,
    };
  }

  hasContact(dpUserId: string): boolean {
    return this.contacts.some((c) => c.id === dpUserId);
  }

  isLoaded(dpUserId: string): boolean {
    return this.conversations.has(dpUserId);
  }

  contactUnread(dpUserId: string): number {
    return this.contacts.find((c) => c.id === dpUserId)?.unreadCount ?? 0;
  }

  /** Lista de contatos vinda do servidor (há funcionário logado). */
  setContacts(contacts: ChatContact[]): void {
    this.contacts = contacts;
    this.available = true;
    this.changed();
  }

  setOpen(dpUserId: string | null): void {
    if (this.openContactId === dpUserId) return;
    this.openContactId = dpUserId;
    this.changed();
  }

  setLoading(loading: boolean): void {
    if (this.loading === loading) return;
    this.loading = loading;
    this.changed();
  }

  /** Substitui a conversa com uma pessoa do DP pela versão do servidor. */
  setConversation(dpUserId: string, messages: ChatMessage[]): void {
    this.conversations.set(dpUserId, new Map(messages.map((m) => [m.id, m])));
    this.changed();
  }

  /**
   * Mensagem nova ou atualizada (WebSocket ou resposta do envio). Deduplica por id.
   * Atualiza a conversa (se já carregada) e, de forma otimista, o contato; o main recarrega
   * a lista de contatos logo depois para ficar exatamente como no servidor.
   */
  add(message: ChatMessage): void {
    const conversation = this.conversations.get(message.dpUserId);
    const existing = conversation?.get(message.id);
    if (existing && existing.readAt === message.readAt && existing.content === message.content) return;
    conversation?.set(message.id, message);

    const contact = this.contacts.find((c) => c.id === message.dpUserId);
    if (contact) {
      if (!existing && (!contact.lastMessage || contact.lastMessage.createdAt <= message.createdAt)) {
        contact.lastMessage = { content: message.content, senderType: message.senderType, createdAt: message.createdAt };
      }
      if (message.senderType === 'DP') {
        // Mensagem nova do DP ainda não lida (só dá para saber se é nova quando a conversa está carregada)
        if (conversation && !existing && !message.readAt) contact.unreadCount += 1;
        // Lida em outro PC
        if (existing && !existing.readAt && message.readAt) contact.unreadCount = Math.max(0, contact.unreadCount - 1);
      }
    }
    this.changed();
  }

  /** O funcionário leu a conversa com esta pessoa do DP. */
  markRead(dpUserId: string, readAt: string): void {
    const conversation = this.conversations.get(dpUserId);
    if (conversation) {
      for (const [id, message] of conversation) {
        if (message.senderType === 'DP' && !message.readAt) conversation.set(id, { ...message, readAt });
      }
    }
    const contact = this.contacts.find((c) => c.id === dpUserId);
    if (contact) contact.unreadCount = 0;
    this.changed();
  }

  /** Sem funcionário logado (ou outra pessoa entrou): some tudo da tela. */
  clear(): void {
    if (!this.available && this.contacts.length === 0 && this.conversations.size === 0 && !this.openContactId) return;
    this.contacts = [];
    this.conversations.clear();
    this.openContactId = null;
    this.loading = false;
    this.available = false;
    this.changed();
  }

  private changed(): void {
    this.emit('change', this.getState());
  }
}
