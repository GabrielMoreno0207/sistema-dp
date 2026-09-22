import { nullableText, text, type Row, type SqliteDatabase } from '../../database/sqlite';
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

function marcadores(quantos: number): string {
  return new Array(quantos).fill('?').join(', ');
}

export class SqliteConversaRepository implements ConversaRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async create(conversa: Conversa, membros: { userId: string; papel: PapelMembro }[]): Promise<Conversa> {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO conversas (id, tipo, nome, criado_por, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(conversa.id, conversa.tipo, conversa.nome, conversa.criadoPor, conversa.createdAt, conversa.updatedAt);
      const inserir = this.db.prepare(
        'INSERT INTO conversa_membros (conversa_id, user_id, papel, entrou_em) VALUES (?, ?, ?, ?)',
      );
      for (const membro of membros) inserir.run(conversa.id, membro.userId, membro.papel, conversa.createdAt);
      this.db.exec('COMMIT');
      return conversa;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: string): Promise<Conversa | null> {
    const row = this.db.prepare('SELECT * FROM conversas WHERE id = ?').get(id);
    return row ? toConversa(row as Row) : null;
  }

  async findDireta(userA: string, userB: string): Promise<Conversa | null> {
    const row = this.db
      .prepare(
        `SELECT c.* FROM conversas c
         JOIN conversa_membros a ON a.conversa_id = c.id AND a.user_id = ?
         JOIN conversa_membros b ON b.conversa_id = c.id AND b.user_id = ?
         WHERE c.tipo = 'DIRETA' LIMIT 1`,
      )
      .get(userA, userB);
    return row ? toConversa(row as Row) : null;
  }

  async listDoUsuario(userId: string, limite: number): Promise<Conversa[]> {
    return this.db
      .prepare(
        `SELECT c.* FROM conversas c
         JOIN conversa_membros m ON m.conversa_id = c.id
         WHERE m.user_id = ? AND m.saiu_em IS NULL
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(userId, limite)
      .map((row) => toConversa(row as Row));
  }

  async listTodas(limite: number): Promise<Conversa[]> {
    return this.db
      .prepare('SELECT * FROM conversas ORDER BY updated_at DESC LIMIT ?')
      .all(limite)
      .map((row) => toConversa(row as Row));
  }

  async renomear(id: string, nome: string, agora: string): Promise<void> {
    this.db.prepare('UPDATE conversas SET nome = ?, updated_at = ? WHERE id = ?').run(nome, agora, id);
  }

  async tocar(id: string, agora: string): Promise<void> {
    this.db.prepare('UPDATE conversas SET updated_at = ? WHERE id = ?').run(agora, id);
  }

  async delete(id: string): Promise<boolean> {
    return Number(this.db.prepare('DELETE FROM conversas WHERE id = ?').run(id).changes) > 0;
  }

  async membros(conversaId: string, incluirQuemSaiu: boolean): Promise<Membro[]> {
    const condicao = incluirQuemSaiu ? '' : ' AND saiu_em IS NULL';
    return this.db
      .prepare(`SELECT * FROM conversa_membros WHERE conversa_id = ?${condicao} ORDER BY entrou_em`)
      .all(conversaId)
      .map((row) => toMembro(row as Row));
  }

  async membrosDeVarias(conversaIds: string[]): Promise<Map<string, Membro[]>> {
    const resultado = new Map<string, Membro[]>();
    if (conversaIds.length === 0) return resultado;
    const linhas = this.db
      .prepare(`SELECT * FROM conversa_membros WHERE conversa_id IN (${marcadores(conversaIds.length)})`)
      .all(...conversaIds);
    for (const linha of linhas) {
      const membro = toMembro(linha as Row);
      const lista = resultado.get(membro.conversaId) ?? [];
      lista.push(membro);
      resultado.set(membro.conversaId, lista);
    }
    return resultado;
  }

  async membro(conversaId: string, userId: string): Promise<Membro | null> {
    const row = this.db.prepare('SELECT * FROM conversa_membros WHERE conversa_id = ? AND user_id = ?').get(conversaId, userId);
    return row ? toMembro(row as Row) : null;
  }

  async adicionarMembro(conversaId: string, userId: string, papel: PapelMembro, agora: string): Promise<void> {
    // Quem já saiu e volta: entra de novo, sem duplicar a linha
    this.db
      .prepare(
        `INSERT INTO conversa_membros (conversa_id, user_id, papel, entrou_em)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (conversa_id, user_id) DO UPDATE SET saiu_em = NULL, papel = excluded.papel, entrou_em = excluded.entrou_em`,
      )
      .run(conversaId, userId, papel, agora);
  }

  async removerMembro(conversaId: string, userId: string, agora: string): Promise<void> {
    this.db
      .prepare('UPDATE conversa_membros SET saiu_em = ? WHERE conversa_id = ? AND user_id = ?')
      .run(agora, conversaId, userId);
  }

  async marcarLeitura(conversaId: string, userId: string, agora: string): Promise<void> {
    this.db
      .prepare('UPDATE conversa_membros SET ultima_leitura = ? WHERE conversa_id = ? AND user_id = ?')
      .run(agora, conversaId, userId);
  }

  async addMensagem(dados: NovaMensagemConversa, agora: string): Promise<MensagemConversa> {
    this.db.exec('BEGIN');
    try {
      const row = this.db
        .prepare(
          `INSERT INTO conversa_mensagens (conversa_id, autor_id, autor_nome, tipo, conteudo, midia_id, automatica, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .get(
          dados.conversaId,
          dados.autorId,
          dados.autorNome,
          dados.tipo,
          dados.conteudo,
          dados.midiaId,
          dados.automatica ? 1 : 0,
          agora,
        );
      this.db.prepare('UPDATE conversas SET updated_at = ? WHERE id = ?').run(agora, dados.conversaId);
      this.db.exec('COMMIT');
      return toMensagem(row as Row);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async listMensagens(conversaId: string, limite: number, antesDoId?: number): Promise<MensagemConversa[]> {
    // As mais recentes primeiro na consulta, depois em ordem cronológica na tela
    const linhas = antesDoId
      ? this.db
          .prepare('SELECT * FROM conversa_mensagens WHERE conversa_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
          .all(conversaId, antesDoId, limite)
      : this.db
          .prepare('SELECT * FROM conversa_mensagens WHERE conversa_id = ? ORDER BY id DESC LIMIT ?')
          .all(conversaId, limite);
    return linhas.map((row) => toMensagem(row as Row)).reverse();
  }

  async ultimaMensagemDeVarias(conversaIds: string[]): Promise<Map<string, MensagemConversa>> {
    const resultado = new Map<string, MensagemConversa>();
    if (conversaIds.length === 0) return resultado;
    const linhas = this.db
      .prepare(
        `SELECT m.* FROM conversa_mensagens m
         JOIN (SELECT conversa_id, MAX(id) AS ultima FROM conversa_mensagens
               WHERE conversa_id IN (${marcadores(conversaIds.length)}) GROUP BY conversa_id) u
           ON u.ultima = m.id`,
      )
      .all(...conversaIds);
    for (const linha of linhas) {
      const mensagem = toMensagem(linha as Row);
      resultado.set(mensagem.conversaId, mensagem);
    }
    return resultado;
  }

  async naoLidasDeVarias(conversaIds: string[], userId: string): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (conversaIds.length === 0) return resultado;
    // Não lida = mensagem de outra pessoa depois da última leitura desta pessoa
    const linhas = this.db
      .prepare(
        `SELECT m.conversa_id, COUNT(*) AS total
         FROM conversa_mensagens m
         JOIN conversa_membros mb ON mb.conversa_id = m.conversa_id AND mb.user_id = ?
         WHERE m.conversa_id IN (${marcadores(conversaIds.length)})
           AND m.autor_id <> ?
           AND m.apagada_em IS NULL
           AND m.tipo <> 'SISTEMA'
           AND (mb.ultima_leitura IS NULL OR m.created_at > mb.ultima_leitura)
         GROUP BY m.conversa_id`,
      )
      .all(userId, ...conversaIds, userId);
    for (const linha of linhas) resultado.set(text(linha as Row, 'conversa_id'), Number((linha as Row).total));
    return resultado;
  }

  async apagarMensagem(id: number, agora: string): Promise<boolean> {
    return (
      Number(
        this.db
          .prepare("UPDATE conversa_mensagens SET apagada_em = ?, conteudo = '' WHERE id = ? AND apagada_em IS NULL")
          .run(agora, id).changes,
      ) > 0
    );
  }

  async findMensagem(id: number): Promise<MensagemConversa | null> {
    const row = this.db.prepare('SELECT * FROM conversa_mensagens WHERE id = ?').get(id);
    return row ? toMensagem(row as Row) : null;
  }

  async contarMensagensPorConversa(conversaIds: string[]): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (conversaIds.length === 0) return resultado;
    const linhas = this.db
      .prepare(
        `SELECT conversa_id, COUNT(*) AS total FROM conversa_mensagens
         WHERE conversa_id IN (${marcadores(conversaIds.length)}) AND tipo <> 'SISTEMA'
         GROUP BY conversa_id`,
      )
      .all(...conversaIds);
    for (const linha of linhas) resultado.set(text(linha as Row, 'conversa_id'), Number((linha as Row).total));
    return resultado;
  }

  async apagarMensagens(conversaIds: string[], antesDe: string | null): Promise<number> {
    if (conversaIds.length === 0) return 0;
    const filtro = antesDe ? ' AND created_at < ?' : '';
    const valores: (string | number)[] = [...conversaIds];
    if (antesDe) valores.push(antesDe);
    return Number(
      this.db
        .prepare(`DELETE FROM conversa_mensagens WHERE conversa_id IN (${marcadores(conversaIds.length)})${filtro}`)
        .run(...valores).changes,
    );
  }

  async registrarAcessoTi(conversaId: string, usuarioId: string, usuarioNome: string, agora: string): Promise<void> {
    this.db
      .prepare('INSERT INTO conversa_acessos_ti (conversa_id, usuario_id, usuario_nome, created_at) VALUES (?, ?, ?, ?)')
      .run(conversaId, usuarioId, usuarioNome, agora);
  }

  async listarAcessosTi(limite: number): Promise<{ conversaId: string; usuarioNome: string; createdAt: string }[]> {
    return this.db
      .prepare('SELECT * FROM conversa_acessos_ti ORDER BY id DESC LIMIT ?')
      .all(limite)
      .map((row) => ({
        conversaId: text(row as Row, 'conversa_id'),
        usuarioNome: text(row as Row, 'usuario_nome'),
        createdAt: text(row as Row, 'created_at'),
      }));
  }
}
