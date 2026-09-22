import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { EventoRepository } from './evento.repository';
import {
  COR_PATTERN,
  HORA_PATTERN,
  LIMITES_EVENTO,
  diaValido,
  gerarIdEvento,
  type EscopoEvento,
  type Evento,
} from './evento.types';

/** Quem está mexendo na agenda: o funcionário do PC ou alguém do DP/TI. */
export interface PessoaDaAgenda {
  id: string;
  nome: string;
  ehDp: boolean;
  ehTi: boolean;
}

export interface DadosEvento {
  titulo: string;
  descricao: string;
  dia: string;
  hora: string | null;
  escopo: EscopoEvento;
  cor: string;
}

const COR_PADRAO = '#17b3a3';

export class EventoService {
  constructor(
    private readonly eventos: EventoRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Eventos do período: os gerais da empresa mais as anotações da pessoa. */
  async listar(quem: PessoaDaAgenda, deDia: string, ateDia: string): Promise<Evento[]> {
    if (!diaValido(deDia) || !diaValido(ateDia)) {
      throw new AppError('Informe as datas no formato AAAA-MM-DD.', 400, 'DATA_INVALIDA');
    }
    if (deDia > ateDia) throw new AppError('A data inicial é depois da final.', 400, 'PERIODO_INVALIDO');
    return this.eventos.listarPeriodo(deDia, ateDia, quem.id);
  }

  async criar(quem: PessoaDaAgenda, dados: DadosEvento): Promise<Evento> {
    const limpos = this.conferir(quem, dados);

    if (limpos.escopo === 'PESSOAL') {
      const noDia = await this.eventos.contarNoDia(quem.id, limpos.dia);
      if (noDia >= LIMITES_EVENTO.porDiaPorPessoa) {
        throw new AppError(`Você já tem ${LIMITES_EVENTO.porDiaPorPessoa} anotações nesse dia.`, 400, 'DIA_CHEIO');
      }
    }

    const evento = await this.eventos.create({
      id: gerarIdEvento(),
      ...limpos,
      criadoPor: quem.id,
      criadoPorNome: quem.nome,
      createdAt: new Date().toISOString(),
    });
    if (evento.escopo === 'GERAL') {
      this.log.info(`Evento geral "${evento.titulo}" em ${evento.dia} publicado por ${quem.nome}`);
    }
    return evento;
  }

  async alterar(quem: PessoaDaAgenda, id: string, dados: DadosEvento): Promise<Evento> {
    const evento = await this.exigirEvento(id);
    this.exigirDono(quem, evento);
    const limpos = this.conferir(quem, { ...dados, escopo: evento.escopo });
    return this.eventos.update(id, {
      titulo: limpos.titulo,
      descricao: limpos.descricao,
      dia: limpos.dia,
      hora: limpos.hora,
      cor: limpos.cor,
    });
  }

  async apagar(quem: PessoaDaAgenda, id: string): Promise<void> {
    const evento = await this.exigirEvento(id);
    this.exigirDono(quem, evento);
    await this.eventos.delete(id);
  }

  private async exigirEvento(id: string): Promise<Evento> {
    const evento = await this.eventos.findById(id);
    if (!evento) throw new NotFoundError('Evento não encontrado');
    return evento;
  }

  /** Cada um mexe no que criou; o TI também pode apagar o que for. */
  private exigirDono(quem: PessoaDaAgenda, evento: Evento): void {
    if (evento.criadoPor === quem.id || quem.ehTi) return;
    throw new AppError('Este evento é de outra pessoa.', 403, 'FORBIDDEN');
  }

  private conferir(quem: PessoaDaAgenda, dados: DadosEvento): DadosEvento {
    const titulo = dados.titulo.trim();
    if (!titulo) throw new AppError('Escreva o título do evento.', 400, 'TITULO_VAZIO');
    if (titulo.length > LIMITES_EVENTO.maxTitulo) {
      throw new AppError(`O título passa de ${LIMITES_EVENTO.maxTitulo} caracteres.`, 400, 'TITULO_LONGO');
    }

    const descricao = dados.descricao.trim();
    if (descricao.length > LIMITES_EVENTO.maxDescricao) {
      throw new AppError(`A descrição passa de ${LIMITES_EVENTO.maxDescricao} caracteres.`, 400, 'DESCRICAO_LONGA');
    }

    if (!diaValido(dados.dia)) throw new AppError('Escolha uma data válida.', 400, 'DATA_INVALIDA');

    const hora = dados.hora?.trim() || null;
    if (hora && !new RegExp(HORA_PATTERN).test(hora)) {
      throw new AppError('Informe a hora como HH:MM.', 400, 'HORA_INVALIDA');
    }

    const cor = dados.cor?.trim() || COR_PADRAO;
    if (!new RegExp(COR_PATTERN).test(cor)) throw new AppError('Cor inválida.', 400, 'COR_INVALIDA');

    // Evento para a empresa toda é publicação: só com a conta do DP ou do TI
    if (dados.escopo === 'GERAL' && !quem.ehDp) {
      throw new AppError('Só o Departamento Pessoal publica evento para todos.', 403, 'FORBIDDEN');
    }

    return { titulo, descricao, dia: dados.dia, hora, escopo: dados.escopo, cor };
  }
}
