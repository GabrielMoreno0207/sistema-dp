import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { Agendamento, DadosAgendamento, StatusAgendamento, TipoAgendamento } from './agendamento.types';

export interface AgendamentoRepository {
  create(agendamento: Agendamento): Promise<void>;
  findById(id: string): Promise<Agendamento | null>;
  /** Pendentes (mais próximos primeiro) e os últimos já resolvidos */
  listar(tipo: TipoAgendamento | null, recentes: number): Promise<Agendamento[]>;
  contarPendentes(): Promise<number>;
  /** Pendentes cuja hora já chegou */
  vencidos(agora: string): Promise<Agendamento[]>;
  /** Troca de status só se ainda estiver no esperado (true = trocou) */
  mudarStatus(id: string, de: StatusAgendamento, para: StatusAgendamento): Promise<boolean>;
  concluir(id: string, status: 'ENVIADO' | 'FALHOU', resultadoId: string | null, erro: string | null, agora: string): Promise<void>;
  /** Servidor reiniciou no meio de um envio: o que ficou "enviando" volta a pendente */
  recuperarInterrompidos(): Promise<number>;
}

function toAgendamento(row: Row): Agendamento {
  const dados = typeof row.dados === 'string' ? (JSON.parse(row.dados) as DadosAgendamento) : (row.dados as DadosAgendamento);
  return {
    id: text(row, 'id'),
    tipo: text(row, 'tipo') as TipoAgendamento,
    dados,
    executarEm: text(row, 'executar_em'),
    status: text(row, 'status') as StatusAgendamento,
    criadoPorId: text(row, 'criado_por_id'),
    criadoPorNome: text(row, 'criado_por_nome'),
    resultadoId: nullableText(row, 'resultado_id'),
    erro: nullableText(row, 'erro'),
    enviadoEm: nullableText(row, 'enviado_em'),
    createdAt: text(row, 'created_at'),
  };
}

export class PostgresAgendamentoRepository implements AgendamentoRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async create(a: Agendamento): Promise<void> {
    await this.db.run(
      `INSERT INTO agendamentos
         (id, tipo, dados, executar_em, status, criado_por_id, criado_por_nome, resultado_id, erro, enviado_em, created_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [a.id, a.tipo, JSON.stringify(a.dados), a.executarEm, a.status, a.criadoPorId, a.criadoPorNome, a.resultadoId, a.erro, a.enviadoEm, a.createdAt],
    );
  }

  async findById(id: string): Promise<Agendamento | null> {
    const row = await this.db.one('SELECT * FROM agendamentos WHERE id = $1', [id]);
    return row ? toAgendamento(row) : null;
  }

  async listar(tipo: TipoAgendamento | null, recentes: number): Promise<Agendamento[]> {
    const pendentes = await this.db.all(
      `SELECT * FROM agendamentos
        WHERE status IN ('PENDENTE', 'ENVIANDO') AND ($1::text IS NULL OR tipo = $1)
        ORDER BY executar_em`,
      [tipo],
    );
    const resolvidos = await this.db.all(
      `SELECT * FROM agendamentos
        WHERE status NOT IN ('PENDENTE', 'ENVIANDO') AND ($1::text IS NULL OR tipo = $1)
        ORDER BY COALESCE(enviado_em, executar_em) DESC
        LIMIT $2`,
      [tipo, recentes],
    );
    return [...pendentes, ...resolvidos].map(toAgendamento);
  }

  async contarPendentes(): Promise<number> {
    const row = await this.db.one("SELECT COUNT(*) AS total FROM agendamentos WHERE status = 'PENDENTE'");
    return Number(row?.total ?? 0);
  }

  async vencidos(agora: string): Promise<Agendamento[]> {
    const rows = await this.db.all(
      "SELECT * FROM agendamentos WHERE status = 'PENDENTE' AND executar_em <= $1 ORDER BY executar_em LIMIT 50",
      [agora],
    );
    return rows.map(toAgendamento);
  }

  async mudarStatus(id: string, de: StatusAgendamento, para: StatusAgendamento): Promise<boolean> {
    return (await this.db.run('UPDATE agendamentos SET status = $1 WHERE id = $2 AND status = $3', [para, id, de])) > 0;
  }

  async concluir(id: string, status: 'ENVIADO' | 'FALHOU', resultadoId: string | null, erro: string | null, agora: string): Promise<void> {
    await this.db.run('UPDATE agendamentos SET status = $1, resultado_id = $2, erro = $3, enviado_em = $4 WHERE id = $5', [
      status,
      resultadoId,
      erro,
      agora,
      id,
    ]);
  }

  async recuperarInterrompidos(): Promise<number> {
    return this.db.run("UPDATE agendamentos SET status = 'PENDENTE' WHERE status = 'ENVIANDO'");
  }
}
