import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { EventoRepository } from './evento.repository';
import type { Evento, EscopoEvento, NovoEvento } from './evento.types';

/** A coluna `dia` é DATE: o driver devolve Date, e a agenda trabalha com AAAA-MM-DD. */
function diaDaLinha(row: Row): string {
  const valor = row.dia;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

function toEvento(row: Row): Evento {
  return {
    id: text(row, 'id'),
    titulo: text(row, 'titulo'),
    descricao: text(row, 'descricao'),
    dia: diaDaLinha(row),
    hora: nullableText(row, 'hora'),
    escopo: text(row, 'escopo') as EscopoEvento,
    cor: text(row, 'cor'),
    criadoPor: text(row, 'criado_por'),
    criadoPorNome: text(row, 'criado_por_nome'),
    createdAt: text(row, 'created_at'),
  };
}

export class PostgresEventoRepository implements EventoRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async listarPeriodo(deDia: string, ateDia: string, usuarioId: string): Promise<Evento[]> {
    const linhas = await this.db.all(
      `SELECT * FROM eventos
        WHERE dia BETWEEN $1::date AND $2::date
          AND (escopo = 'GERAL' OR criado_por = $3)
        ORDER BY dia, COALESCE(hora, '00:00'), created_at`,
      [deDia, ateDia, usuarioId],
    );
    return linhas.map(toEvento);
  }

  async findById(id: string): Promise<Evento | null> {
    const linha = await this.db.one('SELECT * FROM eventos WHERE id = $1', [id]);
    return linha ? toEvento(linha) : null;
  }

  async contarNoDia(usuarioId: string, dia: string): Promise<number> {
    const linha = await this.db.one(
      "SELECT COUNT(*) AS total FROM eventos WHERE criado_por = $1 AND dia = $2::date AND escopo = 'PESSOAL'",
      [usuarioId, dia],
    );
    return Number(linha?.total ?? 0);
  }

  async create(evento: Evento): Promise<Evento> {
    const linha = await this.db.one(
      `INSERT INTO eventos (id, titulo, descricao, dia, hora, escopo, cor, criado_por, criado_por_nome, created_at)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        evento.id,
        evento.titulo,
        evento.descricao,
        evento.dia,
        evento.hora,
        evento.escopo,
        evento.cor,
        evento.criadoPor,
        evento.criadoPorNome,
        evento.createdAt,
      ],
    );
    return toEvento(linha!);
  }

  async update(id: string, dados: Pick<NovoEvento, 'titulo' | 'descricao' | 'dia' | 'hora' | 'cor'>): Promise<Evento> {
    const linha = await this.db.one(
      `UPDATE eventos SET titulo = $2, descricao = $3, dia = $4::date, hora = $5, cor = $6
        WHERE id = $1
        RETURNING *`,
      [id, dados.titulo, dados.descricao, dados.dia, dados.hora, dados.cor],
    );
    return toEvento(linha!);
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM eventos WHERE id = $1', [id])) > 0;
  }
}
