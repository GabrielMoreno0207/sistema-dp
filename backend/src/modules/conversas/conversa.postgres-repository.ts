import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { ConversaRepository } from './conversa.repository';
import type {
  Conversa,
  Membro,
  MensagemConversa,
  NovaMensagemConversa,
  PapelMembro,
  TipoConversa,
  TipoMensagem,
} from './conversa.types';

function toConversa(row: Row): Conversa {
  return {
    id: text(row, 'id'),
    tipo: text(row, 'tipo') as TipoConversa,
    nome: nullableText(row, 'nome'),
    criadoPor: text(row, 'criado_por'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function toMembro(row: Row): Membro {
  return {
    conversaId: text(row, 'conversa_id'),
    userId: text(row, 'user_id'),
    papel: text(row, 'papel') as PapelMembro,
    entrouEm: text(row, 'entrou_em'),
    ultimaLeitura: nullableText(row, 'ultima_leitura'),
    saiuEm: nullableText(row, 'saiu_em'),
  };
}

function toMensagem(row: Row): MensagemConversa {
  return {
    id: Number(row.id),
    conversaId: text(row, 'conversa_id'),
    autorId: text(row, 'autor_id'),
    autorNome: text(row, 'autor_nome'),
    tipo: text(row, 'tipo') as TipoMensagem,
    conteudo: text(row, 'conteudo'),
    midiaId: nullableText(row, 'midia_id'),
    automatica: Number(row.automatica ?? 0) === 1,
    createdAt: text(row, 'created_at'),
    apagadaEm: nullableText(row, 'apagada_em'),
  };
}

export class PostgresConversaRepository implements ConversaRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async create(conversa: Conversa, membros: { userId: string; papel: PapelMembro }[]): Promise<Conversa> {
    await this.db.transaction(async (tx) => {
      await tx.run('INSERT INTO conversas (id, tipo, nome, criado_por, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        conversa.id,
        conversa.tipo,
        conversa.nome,
        conversa.criadoPor,
        conversa.createdAt,
        conversa.updatedAt,
      ]);
      for (const membro of membros) {
        await tx.run('INSERT INTO conversa_membros (conversa_id, user_id, papel, entrou_em) VALUES ($1, $2, $3, $4)', [
          conversa.id,
          membro.userId,
          membro.papel,
          conversa.createdAt,
        ]);
      }
    });
    return conversa;
  }

  async findById(id: string): Promise<Conversa | null> {
    const row = await this.db.one('SELECT * FROM conversas WHERE id = $1', [id]);
    return row ? toConversa(row) : null;
  }

  async findDireta(userA: string, userB: string): Promise<Conversa | null> {
    const row = await this.db.one(
      `SELECT c.* FROM conversas c
       JOIN conversa_membros a ON a.conversa_id = c.id AND a.user_id = $1
       JOIN conversa_membros b ON b.conversa_id = c.id AND b.user_id = $2
       WHERE c.tipo = 'DIRETA' LIMIT 1`,
      [userA, userB],
    );
    return row ? toConversa(row) : null;
  }

  async listDoUsuario(userId: string, limite: number): Promise<Conversa[]> {
    const rows = await this.db.all(
      `SELECT c.* FROM conversas c
       JOIN conversa_membros m ON m.conversa_id = c.id
       WHERE m.user_id = $1 AND m.saiu_em IS NULL
       ORDER BY c.updated_at DESC LIMIT $2`,
      [userId, limite],
    );
    return rows.map(toConversa);
  }

  async listTodas(limite: number): Promise<Conversa[]> {
    return (await this.db.all('SELECT * FROM conversas ORDER BY updated_at DESC LIMIT $1', [limite])).map(toConversa);
  }

  async renomear(id: string, nome: string, agora: string): Promise<void> {
    await this.db.run('UPDATE conversas SET nome = $1, updated_at = $2 WHERE id = $3', [nome, agora, id]);
  }

  async tocar(id: string, agora: string): Promise<void> {
    await this.db.run('UPDATE conversas SET updated_at = $1 WHERE id = $2', [agora, id]);
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM conversas WHERE id = $1', [id])) > 0;
  }

  async membros(conversaId: string, incluirQuemSaiu: boolean): Promise<Membro[]> {
    const condicao = incluirQuemSaiu ? '' : ' AND saiu_em IS NULL';
    const rows = await this.db.all(
      `SELECT * FROM conversa_membros WHERE conversa_id = $1${condicao} ORDER BY entrou_em`,
      [conversaId],
    );
    return rows.map(toMembro);
  }

  async membrosDeVarias(conversaIds: string[]): Promise<Map<string, Membro[]>> {
    const resultado = new Map<string, Membro[]>();
    if (conversaIds.length === 0) return resultado;
    const rows = await this.db.all('SELECT * FROM conversa_membros WHERE conversa_id = ANY($1::text[])', [conversaIds]);
    for (const row of rows) {
      const membro = toMembro(row);
      const lista = resultado.get(membro.conversaId) ?? [];
      lista.push(membro);
      resultado.set(membro.conversaId, lista);
    }
    return resultado;
  }

  async membro(conversaId: string, userId: string): Promise<Membro | null> {
    const row = await this.db.one('SELECT * FROM conversa_membros WHERE conversa_id = $1 AND user_id = $2', [
      conversaId,
      userId,
    ]);
    return row ? toMembro(row) : null;
  }

  async adicionarMembro(conversaId: string, userId: string, papel: PapelMembro, agora: string): Promise<void> {
    // Quem já saiu e volta: entra de novo, sem duplicar a linha
    await this.db.run(
      `INSERT INTO conversa_membros (conversa_id, user_id, papel, entrou_em)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversa_id, user_id) DO UPDATE SET saiu_em = NULL, papel = EXCLUDED.papel, entrou_em = EXCLUDED.entrou_em`,
      [conversaId, userId, papel, agora],
    );
  }

  async removerMembro(conversaId: string, userId: string, agora: string): Promise<void> {
    await this.db.run('UPDATE conversa_membros SET saiu_em = $1 WHERE conversa_id = $2 AND user_id = $3', [
      agora,
      conversaId,
      userId,
    ]);
  }

  async marcarLeitura(conversaId: string, userId: string, agora: string): Promise<void> {
    await this.db.run('UPDATE conversa_membros SET ultima_leitura = $1 WHERE conversa_id = $2 AND user_id = $3', [
      agora,
      conversaId,
      userId,
    ]);
  }

  async addMensagem(dados: NovaMensagemConversa, agora: string): Promise<MensagemConversa> {
    return this.db.transaction(async (tx) => {
      const row = await tx.one(
        `INSERT INTO conversa_mensagens (conversa_id, autor_id, autor_nome, tipo, conteudo, midia_id, automatica, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          dados.conversaId,
          dados.autorId,
          dados.autorNome,
          dados.tipo,
          dados.conteudo,
          dados.midiaId,
          dados.automatica ? 1 : 0,
          agora,
        ],
      );
      await tx.run('UPDATE conversas SET updated_at = $1 WHERE id = $2', [agora, dados.conversaId]);
      return toMensagem(row as Row);
    });
  }

  async listMensagens(conversaId: string, limite: number, antesDoId?: number): Promise<MensagemConversa[]> {
    const rows = antesDoId
      ? await this.db.all('SELECT * FROM conversa_mensagens WHERE conversa_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3', [
          conversaId,
          antesDoId,
          limite,
        ])
      : await this.db.all('SELECT * FROM conversa_mensagens WHERE conversa_id = $1 ORDER BY id DESC LIMIT $2', [
          conversaId,
          limite,
        ]);
    return rows.map(toMensagem).reverse();
  }

  async ultimaMensagemDeVarias(conversaIds: string[]): Promise<Map<string, MensagemConversa>> {
    const resultado = new Map<string, MensagemConversa>();
    if (conversaIds.length === 0) return resultado;
    const rows = await this.db.all(
      `SELECT DISTINCT ON (conversa_id) * FROM conversa_mensagens
       WHERE conversa_id = ANY($1::text[])
       ORDER BY conversa_id, id DESC`,
      [conversaIds],
    );
    for (const row of rows) {
      const mensagem = toMensagem(row);
      resultado.set(mensagem.conversaId, mensagem);
    }
    return resultado;
  }

  async naoLidasDeVarias(conversaIds: string[], userId: string): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (conversaIds.length === 0) return resultado;
    const rows = await this.db.all(
      `SELECT m.conversa_id, COUNT(*) AS total
       FROM conversa_mensagens m
       JOIN conversa_membros mb ON mb.conversa_id = m.conversa_id AND mb.user_id = $1
       WHERE m.conversa_id = ANY($2::text[])
         AND m.autor_id <> $1
         AND m.apagada_em IS NULL
         AND m.tipo <> 'SISTEMA'
         AND (mb.ultima_leitura IS NULL OR m.created_at > mb.ultima_leitura)
       GROUP BY m.conversa_id`,
      [userId, conversaIds],
    );
    for (const row of rows) resultado.set(text(row, 'conversa_id'), Number(row.total));
    return resultado;
  }

  async apagarMensagem(id: number, agora: string): Promise<boolean> {
    return (
      (await this.db.run("UPDATE conversa_mensagens SET apagada_em = $1, conteudo = '' WHERE id = $2 AND apagada_em IS NULL", [
        agora,
        id,
      ])) > 0
    );
  }

  async findMensagem(id: number): Promise<MensagemConversa | null> {
    const row = await this.db.one('SELECT * FROM conversa_mensagens WHERE id = $1', [id]);
    return row ? toMensagem(row) : null;
  }

  async contarMensagensPorConversa(conversaIds: string[]): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (conversaIds.length === 0) return resultado;
    const rows = await this.db.all(
      `SELECT conversa_id, COUNT(*) AS total FROM conversa_mensagens
       WHERE conversa_id = ANY($1::text[]) AND tipo <> 'SISTEMA'
       GROUP BY conversa_id`,
      [conversaIds],
    );
    for (const row of rows) resultado.set(text(row, 'conversa_id'), Number(row.total));
    return resultado;
  }

  async apagarMensagens(conversaIds: string[], antesDe: string | null): Promise<number> {
    if (conversaIds.length === 0) return 0;
    return antesDe
      ? this.db.run('DELETE FROM conversa_mensagens WHERE conversa_id = ANY($1::text[]) AND created_at < $2', [
          conversaIds,
          antesDe,
        ])
      : this.db.run('DELETE FROM conversa_mensagens WHERE conversa_id = ANY($1::text[])', [conversaIds]);
  }

  async registrarAcessoTi(conversaId: string, usuarioId: string, usuarioNome: string, agora: string): Promise<void> {
    await this.db.run(
      'INSERT INTO conversa_acessos_ti (conversa_id, usuario_id, usuario_nome, created_at) VALUES ($1, $2, $3, $4)',
      [conversaId, usuarioId, usuarioNome, agora],
    );
  }

  async listarAcessosTi(limite: number): Promise<{ conversaId: string; usuarioNome: string; createdAt: string }[]> {
    const rows = await this.db.all('SELECT * FROM conversa_acessos_ti ORDER BY id DESC LIMIT $1', [limite]);
    return rows.map((row) => ({
      conversaId: text(row, 'conversa_id'),
      usuarioNome: text(row, 'usuario_nome'),
      createdAt: text(row, 'created_at'),
    }));
  }
}
