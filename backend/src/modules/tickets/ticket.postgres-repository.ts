import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
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

export class PostgresChamadoRepository implements ChamadoRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async create(dados: NovoChamado, agora: string): Promise<Chamado> {
    const id = gerarIdChamado();
    // O número vem da própria coluna de identidade: sem risco de dois iguais
    const row = await this.db.one(
      `INSERT INTO chamados (id, titulo, descricao, categoria, prioridade, status,
         solicitante_id, solicitante_nome, computador_id, responsavel_id, responsavel_nome,
         created_at, updated_at, resolvido_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, NULL) RETURNING *`,
      [
        id,
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
      ],
    );
    return toChamado(row as Row);
  }

  async findById(id: string): Promise<Chamado | null> {
    const row = await this.db.one('SELECT * FROM chamados WHERE id = $1', [id]);
    return row ? toChamado(row) : null;
  }

  async list(filtro: FiltroChamados): Promise<Chamado[]> {
    const condicoes: string[] = [];
    const valores: unknown[] = [];
    if (filtro.solicitanteId) {
      valores.push(filtro.solicitanteId);
      condicoes.push(`solicitante_id = $${valores.length}`);
    }
    if (filtro.status && filtro.status.length > 0) {
      valores.push(filtro.status);
      condicoes.push(`status = ANY($${valores.length}::text[])`);
    }
    valores.push(filtro.limite);
    const onde = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';
    const rows = await this.db.all(
      `SELECT * FROM chamados ${onde} ORDER BY created_at DESC LIMIT $${valores.length}`,
      valores,
    );
    return rows.map(toChamado);
  }

  async update(
    id: string,
    dados: { status: StatusChamado; responsavelId: string | null; responsavelNome: string | null; resolvidoEm: string | null },
    agora: string,
  ): Promise<Chamado> {
    const row = await this.db.one(
      `UPDATE chamados SET status = $1, responsavel_id = $2, responsavel_nome = $3, resolvido_em = $4, updated_at = $5
       WHERE id = $6 RETURNING *`,
      [dados.status, dados.responsavelId, dados.responsavelNome, dados.resolvidoEm, agora, id],
    );
    return toChamado(row as Row);
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM chamados WHERE id = $1', [id])) > 0;
  }

  async addMensagem(dados: NovaMensagem, agora: string): Promise<ChamadoMensagem> {
    return this.db.transaction(async (tx) => {
      const row = await tx.one(
        `INSERT INTO chamado_mensagens (chamado_id, autor_id, autor_nome, autor_tipo, conteudo, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [dados.chamadoId, dados.autorId, dados.autorNome, dados.autorTipo, dados.conteudo, agora],
      );
      // Mensagem nova mexe no chamado: a lista ordena por movimento
      await tx.run('UPDATE chamados SET updated_at = $1 WHERE id = $2', [agora, dados.chamadoId]);
      return toMensagem(row as Row);
    });
  }

  async listMensagens(chamadoId: string): Promise<ChamadoMensagem[]> {
    const rows = await this.db.all('SELECT * FROM chamado_mensagens WHERE chamado_id = $1 ORDER BY id', [chamadoId]);
    return rows.map(toMensagem);
  }

  async marcarLidas(chamadoId: string, de: AutorMensagem, agora: string): Promise<number> {
    return this.db.run(
      'UPDATE chamado_mensagens SET lida_em = $1 WHERE chamado_id = $2 AND autor_tipo = $3 AND lida_em IS NULL',
      [agora, chamadoId, de],
    );
  }

  async contarNaoLidas(chamadoId: string, de: AutorMensagem): Promise<number> {
    const row = await this.db.one(
      'SELECT COUNT(*) AS total FROM chamado_mensagens WHERE chamado_id = $1 AND autor_tipo = $2 AND lida_em IS NULL',
      [chamadoId, de],
    );
    return Number(row?.total ?? 0);
  }

  async contarNaoLidasPorChamado(ids: string[], de: AutorMensagem): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (ids.length === 0) return resultado;
    const rows = await this.db.all(
      `SELECT chamado_id, COUNT(*) AS total FROM chamado_mensagens
       WHERE chamado_id = ANY($1::text[]) AND autor_tipo = $2 AND lida_em IS NULL
       GROUP BY chamado_id`,
      [ids, de],
    );
    for (const row of rows) resultado.set(text(row, 'chamado_id'), Number(row.total));
    return resultado;
  }

  async contarMensagensPorChamado(ids: string[]): Promise<Map<string, number>> {
    const resultado = new Map<string, number>();
    if (ids.length === 0) return resultado;
    const rows = await this.db.all(
      `SELECT chamado_id, COUNT(*) AS total FROM chamado_mensagens
       WHERE chamado_id = ANY($1::text[]) GROUP BY chamado_id`,
      [ids],
    );
    for (const row of rows) resultado.set(text(row, 'chamado_id'), Number(row.total));
    return resultado;
  }

  async anexarMidias(chamadoId: string, midiaIds: string[]): Promise<void> {
    if (midiaIds.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const [indice, midiaId] of midiaIds.entries()) {
        await tx.run(
          'INSERT INTO chamado_midias (chamado_id, midia_id, ordem) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [chamadoId, midiaId, indice],
        );
      }
    });
  }

  async listMidiaIds(chamadoId: string): Promise<string[]> {
    const rows = await this.db.all('SELECT midia_id FROM chamado_midias WHERE chamado_id = $1 ORDER BY ordem', [chamadoId]);
    return rows.map((row) => text(row, 'midia_id'));
  }

  async contarAbertosDoSolicitante(solicitanteId: string): Promise<number> {
    const row = await this.db.one(
      `SELECT COUNT(*) AS total FROM chamados WHERE solicitante_id = $1 AND status IN ('ABERTO', 'EM_ANDAMENTO')`,
      [solicitanteId],
    );
    return Number(row?.total ?? 0);
  }
}
