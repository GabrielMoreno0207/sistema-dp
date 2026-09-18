import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { DpMessage, MessagesState } from '../shared/types';
import { MESSAGE_ID_REGEX, parseMessage } from './message-validation';

const PERSIST_DELAY_MS = 300;

interface CacheFile {
  version: 1;
  serverUrl: string;
  messages: unknown[];
  pendingReads: unknown[];
}

/**
 * Mensagens deste computador, mantidas pelo processo main.
 *
 * Guarda uma cópia local (messages-cache.json em %APPDATA%) para:
 * - mostrar o histórico mesmo sem conexão;
 * - não repetir o popup de mensagens já conhecidas ao reiniciar;
 * - não perder leituras feitas offline.
 * O servidor continua sendo a fonte oficial: a cada conexão a lista é sincronizada.
 */
export class MessageStore extends EventEmitter<{ change: [MessagesState] }> {
  private readonly messages = new Map<string, DpMessage>();
  /** Leituras feitas sem conexão, a enviar ao servidor quando reconectar */
  private readonly pendingReads = new Set<string>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly cacheFile: string,
    private serverUrl: string | null,
  ) {
    super();
    this.loadCache();
  }

  getState(): MessagesState {
    const messages = [...this.messages.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { messages, unreadCount: messages.filter((m) => !m.read).length };
  }

  get(id: string): DpMessage | undefined {
    return this.messages.get(id);
  }

  /**
   * Substitui a lista pela versão do servidor (sincronização após conectar).
   * Retorna as mensagens não lidas que este computador ainda não conhecia.
   */
  replaceAll(serverMessages: DpMessage[]): DpMessage[] {
    // Mesmo ID com outra data = banco do servidor recriado: é outra mensagem
    const fresh = serverMessages.filter((m) => !m.read && this.messages.get(m.id)?.createdAt !== m.createdAt);
    this.messages.clear();
    for (const message of serverMessages) {
      // Leitura local ainda não enviada vale mais que o estado do servidor
      const pendingRead = this.pendingReads.has(message.id);
      this.messages.set(
        message.id,
        pendingRead ? { ...message, read: true, readAt: message.readAt ?? new Date().toISOString() } : message,
      );
    }
    this.changed();
    return fresh;
  }

  /** Adiciona uma mensagem recebida em tempo real. Retorna false se já existia. */
  add(message: DpMessage): boolean {
    if (this.messages.has(message.id)) return false;
    this.messages.set(message.id, message);
    this.changed();
    return true;
  }

  markRead(id: string, readAt: string, pending: boolean): void {
    if (pending) this.pendingReads.add(id);
    else this.pendingReads.delete(id);
    const message = this.messages.get(id);
    if (message && !message.read) this.messages.set(id, { ...message, read: true, readAt });
    this.changed();
  }

  getPendingReads(): string[] {
    return [...this.pendingReads];
  }

  /** Desiste de enviar uma leitura que o servidor recusou (mensagem não existe mais / não é deste PC). */
  discardPendingRead(id: string): void {
    if (this.pendingReads.delete(id)) this.changed();
  }

  /** Limpa tudo e passa a guardar as mensagens do novo servidor. */
  reset(serverUrl: string | null): void {
    this.serverUrl = serverUrl;
    this.messages.clear();
    this.pendingReads.clear();
    this.changed();
  }

  /** Grava imediatamente (chamado ao sair do aplicativo). */
  flush(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.writeCache();
  }

  private changed(): void {
    this.emit('change', this.getState());
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flush(), PERSIST_DELAY_MS);
  }

  private loadCache(): void {
    if (!this.serverUrl || !existsSync(this.cacheFile)) return;
    try {
      const data = JSON.parse(readFileSync(this.cacheFile, 'utf-8')) as Partial<CacheFile>;
      // Cache de outro servidor não vale para este
      if (data.version !== 1 || data.serverUrl !== this.serverUrl) return;

      for (const raw of data.messages ?? []) {
        const message = parseMessage(raw);
        if (message) this.messages.set(message.id, message);
      }
      for (const id of data.pendingReads ?? []) {
        if (typeof id === 'string' && MESSAGE_ID_REGEX.test(id) && this.messages.has(id)) this.pendingReads.add(id);
      }
      console.log(`[cache] ${this.messages.size} mensagens carregadas do cache local`);
    } catch (err) {
      console.error('[cache] cache local inválido, ignorando:', err);
    }
  }

  private writeCache(): void {
    if (!this.serverUrl) return;
    const data: CacheFile = {
      version: 1,
      serverUrl: this.serverUrl,
      messages: [...this.messages.values()],
      pendingReads: [...this.pendingReads],
    };
    try {
      // Grava num arquivo temporário e renomeia: nunca deixa o cache pela metade
      const tmp = `${this.cacheFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), 'utf-8');
      renameSync(tmp, this.cacheFile);
    } catch (err) {
      console.error('[cache] falha ao gravar cache local:', err);
    }
  }
}
