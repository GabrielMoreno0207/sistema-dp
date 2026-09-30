/**
 * Reações (👍 ❤️ 😂 …) nas mensagens das conversas e nos recados do mural.
 *
 * Cada pessoa tem no máximo uma reação por mensagem/recado: escolher outra
 * troca; escolher a mesma de novo (ou mandar vazio) tira.
 */
import { text, type PostgresDatabase, type Row } from '../../database/postgres';

export type AlvoReacao = 'MENSAGEM' | 'MURAL';

/** As reações que o aplicativo oferece (fora desta lista o servidor recusa) */
export const EMOJIS_REACAO = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export function emojiValido(emoji: string): boolean {
  return (EMOJIS_REACAO as readonly string[]).includes(emoji);
}

/** Como a tela recebe: uma linha por emoji usado */
export interface ReacaoResumo {
  emoji: string;
  total: number;
  /** Quem está olhando reagiu com este emoji */
  minha: boolean;
  /** Quem reagiu (para o "fulano e beltrano reagiram") */
  nomes: string[];
}

interface ReacaoLinha {
  alvoId: string;
  userId: string;
  userNome: string;
  emoji: string;
}

export interface ReacaoRepository {
  /** Grava (ou troca) a reação da pessoa */
  definir(tipo: AlvoReacao, alvoId: string, userId: string, userNome: string, emoji: string, agora: string): Promise<void>;
  remover(tipo: AlvoReacao, alvoId: string, userId: string): Promise<void>;
  /** Reações de vários alvos de uma vez, já resumidas. alvoId -> resumo */
  resumos(tipo: AlvoReacao, alvoIds: string[], meuId: string | null): Promise<Map<string, ReacaoResumo[]>>;
  apagarDoAlvo(tipo: AlvoReacao, alvoId: string): Promise<void>;
  /** Tira as reações de mensagens e recados que não existem mais (limpeza do TI) */
  limparOrfas(): Promise<void>;
}

/** Agrupa por emoji, o mais usado primeiro (empate: a ordem da lista de emojis) */
export function resumir(linhas: ReacaoLinha[], meuId: string | null): Map<string, ReacaoResumo[]> {
  const porAlvo = new Map<string, Map<string, ReacaoResumo>>();
  for (const linha of linhas) {
    const doAlvo = porAlvo.get(linha.alvoId) ?? new Map<string, ReacaoResumo>();
    porAlvo.set(linha.alvoId, doAlvo);
    const atual = doAlvo.get(linha.emoji) ?? { emoji: linha.emoji, total: 0, minha: false, nomes: [] };
    atual.total += 1;
    atual.nomes.push(linha.userNome);
    if (meuId && linha.userId === meuId) atual.minha = true;
    doAlvo.set(linha.emoji, atual);
  }
  const ordem = (emoji: string) => (EMOJIS_REACAO as readonly string[]).indexOf(emoji);
  const saida = new Map<string, ReacaoResumo[]>();
  for (const [alvoId, doAlvo] of porAlvo) {
    saida.set(
      alvoId,
      [...doAlvo.values()].sort((a, b) => b.total - a.total || ordem(a.emoji) - ordem(b.emoji)),
    );
  }
  return saida;
}

function toLinha(row: Row): ReacaoLinha {
  return { alvoId: text(row, 'alvo_id'), userId: text(row, 'user_id'), userNome: text(row, 'user_nome'), emoji: text(row, 'emoji') };
}

export class PostgresReacaoRepository implements ReacaoRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async definir(tipo: AlvoReacao, alvoId: string, userId: string, userNome: string, emoji: string, agora: string): Promise<void> {
    await this.db.run(
      `INSERT INTO reacoes (alvo_tipo, alvo_id, user_id, user_nome, emoji, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (alvo_tipo, alvo_id, user_id)
       DO UPDATE SET emoji = EXCLUDED.emoji, user_nome = EXCLUDED.user_nome, created_at = EXCLUDED.created_at`,
      [tipo, alvoId, userId, userNome, emoji, agora],
    );
  }

  async remover(tipo: AlvoReacao, alvoId: string, userId: string): Promise<void> {
    await this.db.run('DELETE FROM reacoes WHERE alvo_tipo = $1 AND alvo_id = $2 AND user_id = $3', [tipo, alvoId, userId]);
  }

  async resumos(tipo: AlvoReacao, alvoIds: string[], meuId: string | null): Promise<Map<string, ReacaoResumo[]>> {
    if (alvoIds.length === 0) return new Map();
    const rows = await this.db.all(
      'SELECT alvo_id, user_id, user_nome, emoji FROM reacoes WHERE alvo_tipo = $1 AND alvo_id = ANY($2::text[]) ORDER BY created_at',
      [tipo, alvoIds],
    );
    return resumir(rows.map(toLinha), meuId);
  }

  async apagarDoAlvo(tipo: AlvoReacao, alvoId: string): Promise<void> {
    await this.db.run('DELETE FROM reacoes WHERE alvo_tipo = $1 AND alvo_id = $2', [tipo, alvoId]);
  }

  async limparOrfas(): Promise<void> {
    await this.db.run(
      `DELETE FROM reacoes r WHERE r.alvo_tipo = 'MENSAGEM'
          AND NOT EXISTS (SELECT 1 FROM conversa_mensagens m WHERE m.id::text = r.alvo_id AND m.apagada_em IS NULL)`,
    );
    await this.db.run(
      `DELETE FROM reacoes r WHERE r.alvo_tipo = 'MURAL'
          AND NOT EXISTS (SELECT 1 FROM mural_posts p WHERE p.id = r.alvo_id)`,
    );
  }
}
