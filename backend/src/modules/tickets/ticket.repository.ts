import type { Chamado, ChamadoMensagem, NovaMensagem, NovoChamado, StatusChamado } from './ticket.types';

export interface FiltroChamados {
  /** Só os chamados desta pessoa (o funcionário vê apenas os dele) */
  solicitanteId?: string;
  status?: StatusChamado[];
  limite: number;
}

export interface ChamadoRepository {
  /** Cria o chamado já com o próximo número */
  create(dados: NovoChamado, agora: string): Promise<Chamado>;
  findById(id: string): Promise<Chamado | null>;
  list(filtro: FiltroChamados): Promise<Chamado[]>;
  /** Muda status e, quando o TI assume, grava o responsável */
  update(
    id: string,
    dados: { status: StatusChamado; responsavelId: string | null; responsavelNome: string | null; resolvidoEm: string | null },
    agora: string,
  ): Promise<Chamado>;
  delete(id: string): Promise<boolean>;

  addMensagem(dados: NovaMensagem, agora: string): Promise<ChamadoMensagem>;
  listMensagens(chamadoId: string): Promise<ChamadoMensagem[]>;
  /** Marca como lidas as mensagens que o outro lado escreveu; devolve quantas */
  marcarLidas(chamadoId: string, de: ChamadoMensagem['autorTipo'], agora: string): Promise<number>;
  contarNaoLidas(chamadoId: string, de: ChamadoMensagem['autorTipo']): Promise<number>;
  /** Não lidas por chamado, para montar a lista sem uma consulta por linha */
  contarNaoLidasPorChamado(ids: string[], de: ChamadoMensagem['autorTipo']): Promise<Map<string, number>>;
  contarMensagensPorChamado(ids: string[]): Promise<Map<string, number>>;

  anexarMidias(chamadoId: string, midiaIds: string[]): Promise<void>;
  listMidiaIds(chamadoId: string): Promise<string[]>;
  /** Quantos chamados em aberto essa pessoa já tem */
  contarAbertosDoSolicitante(solicitanteId: string): Promise<number>;
}
