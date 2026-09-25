import type { ConversaRepository } from '../conversas/conversa.repository';
import type { UserRepository } from '../users/user.repository';
import type { AdminChatData } from './admin.service';

/**
 * O que a seção do TI faz com as conversas: números por login do DP e limpeza.
 * Nunca devolve o conteúdo das mensagens.
 */
export class ConversasDoTi implements AdminChatData {
  constructor(
    private readonly conversas: ConversaRepository,
    private readonly users: UserRepository,
  ) {}

  /** Conversas e mensagens de cada login do DP (contas da Central) */
  async summaryByDpUser(): Promise<{ dpUserId: string; conversations: number; messages: number; lastAt: string | null }[]> {
    const conversas = await this.conversas.listTodas(500);
    const ids = conversas.map((c) => c.id);
    const [membros, totais, ultimas] = await Promise.all([
      this.conversas.membrosDeVarias(ids),
      this.conversas.contarMensagensPorConversa(ids),
      this.conversas.ultimaMensagemDeVarias(ids),
    ]);

    const porDp = new Map<string, { conversations: number; messages: number; lastAt: string | null }>();
    for (const conversa of conversas) {
      const quantidade = totais.get(conversa.id) ?? 0;
      if (quantidade === 0) continue;
      for (const membro of membros.get(conversa.id) ?? []) {
        const usuario = await this.users.findById(membro.userId);
        if (!usuario || usuario.role !== 'ADMIN') continue;
        const atual = porDp.get(usuario.id) ?? { conversations: 0, messages: 0, lastAt: null };
        const ultima = ultimas.get(conversa.id)?.createdAt ?? null;
        porDp.set(usuario.id, {
          conversations: atual.conversations + 1,
          messages: atual.messages + quantidade,
          lastAt: !atual.lastAt || (ultima && ultima > atual.lastAt) ? ultima : atual.lastAt,
        });
      }
    }
    return [...porDp.entries()].map(([dpUserId, dados]) => ({ dpUserId, ...dados }));
  }

  async deleteConversation(dpUserId: string, employeeId: string): Promise<number> {
    const conversa = await this.conversas.findDireta(dpUserId, employeeId);
    if (!conversa) return 0;
    return this.conversas.apagarMensagens([conversa.id], null);
  }

  /**
   * Limpeza: com dpUserId, só as conversas daquela pessoa; sem, todas as
   * conversas (inclusive entre funcionários). "antes" limita pela data.
   */
  async deleteMessages(dpUserId: string | null, antes: Date | null): Promise<number> {
    const conversas = await this.conversas.listTodas(10_000);
    const ids: string[] = [];
    for (const conversa of conversas) {
      if (dpUserId) {
        const membros = await this.conversas.membros(conversa.id, true);
        if (!membros.some((m) => m.userId === dpUserId)) continue;
      }
      ids.push(conversa.id);
    }
    // "Apagar tudo": as conversas somem da lista de todo mundo (grupos inclusive)
    if (!antes) return this.conversas.apagarConversas(ids);
    const removidas = await this.conversas.apagarMensagens(ids, antes.toISOString());
    // Pelo prazo: sai o que é antigo; a conversa direta que ficou vazia também sai da lista
    await this.conversas.apagarDiretasVazias(ids);
    return removidas;
  }
}
