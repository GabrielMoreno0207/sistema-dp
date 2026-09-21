import { nullableText, text, type Row, type SqliteDatabase } from '../../database/sqlite';
import type { ChamadoRepository, FiltroChamados } from './ticket.repository';
import {
  gerarIdChamado,
  type AutorMensagem,
  type Categoria,
  type Chamado,
  type ChamadoMensagem,
  type NovaMensagem,
  type NovoChamado,
  type Prioridade,
  type StatusChamado,
} from './ticket.types';

function toChamado(row: Row): Chamado {
  return {
    id: text(row, 'id'),
    numero: Number(row.numero),
    titulo: text(row, 'titulo'),
    descricao: text(row, 'descricao'),
    categoria: text(row, 'categoria') as Categoria,
    prioridade: text(row, 'prioridade') as Prioridade,
    status: text(row, 'status') as StatusChamado,
    solicitanteId: text(row, 'solicitante_id'),
    solicitanteNome: text(row, 'solicitante_nome'),
    computadorId: nullableText(row, 'computador_id'),
    responsavelId: nullableText(row, 'responsavel_id'),
    responsavelNome: nullableText(row, 'responsavel_nome'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    resolvidoEm: nullableText(row, 'resolvido_em'),
  };
}

function toMensagem(row: Row): ChamadoMensagem {
  return {
    id: Number(row.id),
    chamadoId: text(row, 'chamado_id'),
    autorId: text(row, 'autor_id'),
    autorNome: text(row, 'autor_nome'),
    autorTipo: text(row, 'autor_tipo') as AutorMensagem,
    conteudo: text(row, 'conteudo'),
    createdAt: text(row, 'created_at'),
    lidaEm: nullableText(row, 'lida_em'),
  };
}

/** Lista de "?" para um IN (...) com quantidade variável */
function marcadores(quantos: number): string {
  return new Array(quantos).fill('?').join(', ');
}

export class SqliteChamadoRepository implements ChamadoRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async create(dados: NovoChamado, agora: string): Promise<Chamado> {
    const id = gerarIdChamado();
    // Número sequencial e inserção na mesma transação: dois chamados ao mesmo
    // tempo não recebem o mesmo número.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const atual = this.db.prepare('SELECT COALESCE(MAX(numero), 0) AS ultimo FROM chamados').get() as Row;
      const numero = Number(atual.ultimo) + 1;
      this.db
        .prepare(
          `INSERT INTO chamados (id, numero, titulo, descricao, categoria, prioridade, status,
             solicitante_id, solicitante_nome, computador_id, responsavel_id, responsavel_nome,
             created_at, updated_at, resolvido_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          numero,
          dados.titulo,
          dados.descricao,
          dados.categoria,
          dados.prioridade,
          dados.status,
          dados.solicitanteId,
          dados.solicitanteNome,
          dados.computadorId,
          dados.responsavelId,
          dados.responsavelNome,
          agora,
          agora,
        );
      this.db.exec('COMMIT');
      return { ...dados, id, numero, createdAt: agora, updatedAt: agora, resolvidoEm: null };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: string): Promise<Chamado | null> {
    const row = this.db.prepare('SELECT * FROM chamados WHERE id = ?').get(id);
    return row ? toChamado(row as Row) : null;
  }

  async list(filtro: FiltroChamados): Promise<Chamado[]> {
    const condicoes: string[] = [];
    const valores: (string | number)[] = [];
    if (filtro.solicitanteId) {
      condicoes.push('solicitante_id = ?');
      valores.push(filtro.solicitanteId);
    }
    if (filtro.status && filtro.status.length > 0) {
      condicoes.push(`status IN (${marcadores(filtro.status.length)})`);
      valores.push(...filtro.status);
    }
    const onde = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
    return this.db
      .prepare(`SELECT * FROM chamados ${onde} ORDER BY created_at DESC LIMIT ?`)
      .all(...valores, filtro.limite)
      .map((row) => toChamado(row as Row));
  }

  async update(
    id: string,
    dados: { status: StatusChamado; responsavelId: string | null; responsavelNome: string | null; resolvidoEm: string | null },
    agora: string,
  ): Promise<Chamado> {
    const row = this.db
      .prepare(
        `UPDATE chamados SET status = ?, responsavel_id = ?, responsavel_nome = ?, resolvido_em = ?, updated_at = ?
         WHERE id = ? RETURNING *`,
      )
      .get(dados.status, dados.responsavelId, dados.responsavelNome, dados.resolvidoEm, agora, id);
    return toChamado(row as Row);
  }

  async delete(id: string): Promise<boolean> {
    return Number(this.db.prepare('DELETE FROM chamados WHERE id = ?').run(id).changes) > 0;
  }

  async addMensagem(dados: NovaMensagem, agora: string): Promise<ChamadoMensagem> {
    const row = this.db
      .prepare(
        `INSERT INTO chamado_mensagens (chamado_id, autor_id, autor_nome, autor_tipo, conteudo, created_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(dados.chamadoId, dados.autorId, dados.autorNome, dados.autorTipo, dados.conteudo, agora);
    // Mensagem nova mexe no chamado: a lista ordena por movimento
    this.db.prepare('UPDATE chamados SET updated_at = ? WHERE id = ?').run(agora, dados.chamadoId);
    return toMensagem(row as Row);
  }

  async listMensagens(chamadoId: string): Promise<ChamadoMensagem[]> {
    return this.db
      .prepare('SELECT * FROM chamado_mensagens WHERE chamado_id = ? ORDER BY id')
      .all(chamadoId)
      .map((row) => toMensagem(row as Row));
  }

  async marcarLidas(chamadoId: string, de: AutorMensagem, agora: string): Promise<number> {
    return Number(
      this.db
        .prepare('UPDATE chamado_mensagens SET lida_em = ? WHERE chamado_id = ? AND autor_tipo = ? AND lida_em IS NULL')
        .run(agora, chamadoId, de).changes,
    );
  }

  async contarNaoLidas(chamadoId: string, de: AutorMensagem): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM chamado_mensagens WHERE chamado_id = ? AND autor_tipo = ? AND lida_em IS NULL')
      .get(chamadoId, de) as Row;
    return Number(row.total);
  }

  async contarNaoLidasPorChamado(ids: string[], de: AutorMensagem): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (ids.length === 0) return resultado;
    const linhas = this.db
      .prepare(
        `SELECT chamado_id, COUNT(*) AS total FROM chamado_mensagens
         WHERE chamado_id IN (${marcadores(ids.length)}) AND autor_tipo = ? AND lida_em IS NULL
         GROUP BY chamado_id`,
      )
      .all(...ids, de);
    for (const linha of linhas) resultado.set(text(linha as Row, 'chamado_id'), Number((linha as Row).total));
    return resultado;
  }

  async contarMensagensPorChamado(ids: string[]): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (ids.length === 0) return resultado;
    const linhas = this.db
      .prepare(
        `SELECT chamado_id, COUNT(*) AS total FROM chamado_mensagens
         WHERE chamado_id IN (${marcadores(ids.length)}) GROUP BY chamado_id`,
      )
      .all(...ids);
    for (const linha of linhas) resultado.set(text(linha as Row, 'chamado_id'), Number((linha as Row).total));
    return resultado;
  }

  async anexarMidias(chamadoId: string, midiaIds: string[]): Promise<void> {
    const inserir = this.db.prepare('INSERT OR IGNORE INTO chamado_midias (chamado_id, midia_id, ordem) VALUES (?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      midiaIds.forEach((midiaId, indice) => inserir.run(chamadoId, midiaId, indice));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async listMidiaIds(chamadoId: string): Promise<string[]> {
    return this.db
      .prepare('SELECT midia_id FROM chamado_midias WHERE chamado_id = ? ORDER BY ordem')
      .all(chamadoId)
      .map((row) => text(row as Row, 'midia_id'));
  }

  async contarAbertosDoSolicitante(solicitanteId: string): Promise<number> {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM chamados WHERE solicitante_id = ? AND status IN ('ABERTO', 'EM_ANDAMENTO')`)
      .get(solicitanteId) as Row;
    return Number(row.total);
  }
}
