import type { Evento, NovoEvento } from './evento.types';

export interface EventoRepository {
  /**
   * Eventos de um período: os GERAIS (de todo mundo) mais os PESSOAIS de quem
   * está pedindo. As datas são AAAA-MM-DD, com as duas pontas incluídas.
   */
  listarPeriodo(deDia: string, ateDia: string, usuarioId: string): Promise<Evento[]>;
  findById(id: string): Promise<Evento | null>;
  /** Quantos eventos pessoais a pessoa já tem naquele dia (limite por dia) */
  contarNoDia(usuarioId: string, dia: string): Promise<number>;
  create(evento: Evento): Promise<Evento>;
  update(id: string, dados: Pick<NovoEvento, 'titulo' | 'descricao' | 'dia' | 'hora' | 'cor'>): Promise<Evento>;
  delete(id: string): Promise<boolean>;
}
