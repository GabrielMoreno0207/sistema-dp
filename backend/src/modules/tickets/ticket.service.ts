import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { ChamadoNotifier } from '../../realtime/socket-server';
import type { MidiaRepository } from '../content/content.repository';
import { midiaPublica } from '../content/content.types';
import type { EmployeeService } from '../employees/employee.service';
import type { ChamadoRepository } from './ticket.repository';
import {
  LIMITES_CHAMADO,
  STATUS_EM_ABERTO,
  type Categoria,
  type Chamado,
  type ChamadoCompleto,
  type ChamadoMensagem,
  type ChamadoResumo,
  type Prioridade,
  type StatusChamado,
} from './ticket.types';

/** Quem está agindo: o funcionário no PC, ou alguém do DP/TI na Central. */
export type Solicitante =
  | { tipo: 'FUNCIONARIO'; id: string; nome: string; computadorId: string }
  | { tipo: 'ADMIN'; id: string; nome: string; ti: boolean };

export interface DadosNovoChamado {
  titulo: string;
  descricao: string;
  categoria: Categoria;
  prioridade: Prioridade;
  midiaIds: string[];
}

function textoObrigatorio(valor: string, campo: string, maximo: number): string {
  const limpo = valor.trim();
  if (!limpo) throw new AppError(`Informe ${campo}.`, 400, 'CAMPO_OBRIGATORIO');
  if (limpo.length > maximo) throw new AppError(`${campo} passa de ${maximo} caracteres.`, 400, 'CAMPO_LONGO');
  return limpo;
}

export class TicketService {
  constructor(
    private readonly chamados: ChamadoRepository,
    private readonly midias: MidiaRepository,
    private readonly employees: EmployeeService,
    private readonly realtime: ChamadoNotifier,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Quem está no PC precisa estar logado para abrir chamado (o TI precisa saber quem é). */
  async solicitanteDoPc(computadorId: string): Promise<Solicitante> {
    const employee = await this.employees.getSessionEmployee(computadorId);
    if (!employee) throw new AppError('Entre com sua matrícula para abrir um chamado', 401, 'NO_EMPLOYEE');
    return { tipo: 'FUNCIONARIO', id: employee.id, nome: employee.name, computadorId };
  }

  async abrir(quem: Solicitante, dados: DadosNovoChamado): Promise<ChamadoCompleto> {
    const abertos = await this.chamados.contarAbertosDoSolicitante(quem.id);
    if (abertos >= LIMITES_CHAMADO.maxAbertosPorPessoa) {
      throw new AppError(
        `Você já tem ${abertos} chamados em aberto. Aguarde o atendimento dos atuais antes de abrir outro.`,
        409,
        'MUITOS_CHAMADOS',
      );
    }
    if (dados.midiaIds.length > LIMITES_CHAMADO.maxMidias) {
      throw new AppError(`No máximo ${LIMITES_CHAMADO.maxMidias} imagens por chamado.`, 400, 'MUITAS_IMAGENS');
    }

    // As imagens precisam existir de verdade (e serem imagens, não vídeo)
    for (const midiaId of dados.midiaIds) {
      const midia = await this.midias.findById(midiaId);
      if (!midia) throw new AppError('Uma das imagens anexadas não existe mais.', 400, 'MIDIA_INEXISTENTE');
      if (midia.tipo !== 'IMAGEM') throw new AppError('Anexe imagens, não vídeos.', 400, 'MIDIA_INVALIDA');
    }

    const agora = new Date().toISOString();
    const chamado = await this.chamados.create(
      {
        titulo: textoObrigatorio(dados.titulo, 'o título', LIMITES_CHAMADO.maxTitulo),
        descricao: textoObrigatorio(dados.descricao, 'a descrição', LIMITES_CHAMADO.maxDescricao),
        categoria: dados.categoria,
        prioridade: dados.prioridade,
        status: 'ABERTO',
        solicitanteId: quem.id,
        solicitanteNome: quem.nome,
        computadorId: quem.tipo === 'FUNCIONARIO' ? quem.computadorId : null,
        responsavelId: null,
        responsavelNome: null,
      },
      agora,
    );
    if (dados.midiaIds.length > 0) await this.chamados.anexarMidias(chamado.id, dados.midiaIds);

    this.log.info(`Chamado ${chamado.numero} aberto por ${quem.nome}: ${chamado.titulo}`);
    return this.completar(chamado, quem);
  }

  /** Chamados de quem está perguntando (funcionário vê só os dele). */
  async listarDoSolicitante(quem: Solicitante): Promise<ChamadoResumo[]> {
    const lista = await this.chamados.list({ solicitanteId: quem.id, limite: 50 });
    return this.resumir(lista, 'TI');
  }

  /** Fila do TI: por padrão o que ainda está em aberto. */
  async listarParaTi(incluirEncerrados: boolean): Promise<ChamadoResumo[]> {
    const lista = await this.chamados.list({
      status: incluirEncerrados ? undefined : STATUS_EM_ABERTO,
      limite: 200,
    });
    return this.resumir(lista, 'SOLICITANTE');
  }

  private async resumir(lista: Chamado[], naoLidasDe: 'TI' | 'SOLICITANTE'): Promise<ChamadoResumo[]> {
    const ids = lista.map((c) => c.id);
    const [naoLidas, totais] = await Promise.all([
      this.chamados.contarNaoLidasPorChamado(ids, naoLidasDe),
      this.chamados.contarMensagensPorChamado(ids),
    ]);
    return lista.map((chamado) => ({
      ...chamado,
      mensagensNaoLidas: naoLidas.get(chamado.id) ?? 0,
      totalMensagens: totais.get(chamado.id) ?? 0,
    }));
  }

  /** Quantos chamados esperam o TI (badge da Central) */
  async contarNaFila(): Promise<number> {
    return (await this.chamados.list({ status: STATUS_EM_ABERTO, limite: 500 })).length;
  }

  async detalhe(id: string, quem: Solicitante): Promise<ChamadoCompleto> {
    const chamado = await this.exigirAcesso(id, quem);
    return this.completar(chamado, quem);
  }

  /**
   * Chamado só é visto por quem abriu e pelo TI. O DP comum não enxerga
   * chamado de funcionário: o conteúdo pode ter dado de outra pessoa.
   */
  private async exigirAcesso(id: string, quem: Solicitante): Promise<Chamado> {
    const chamado = await this.chamados.findById(id);
    if (!chamado) throw new NotFoundError('Chamado não encontrado');
    const ehDoTi = quem.tipo === 'ADMIN' && quem.ti;
    if (!ehDoTi && chamado.solicitanteId !== quem.id) throw new NotFoundError('Chamado não encontrado');
    return chamado;
  }

  private async completar(chamado: Chamado, quem: Solicitante): Promise<ChamadoCompleto> {
    const ehDoTi = quem.tipo === 'ADMIN' && quem.ti;
    const [mensagens, midiaIds] = await Promise.all([
      this.chamados.listMensagens(chamado.id),
      this.chamados.listMidiaIds(chamado.id),
    ]);
    const midias = [];
    for (const midiaId of midiaIds) {
      const midia = await this.midias.findById(midiaId);
      if (midia) {
        const publica = midiaPublica(midia);
        midias.push({ id: publica.id, tipo: publica.tipo, nome: publica.nome, url: publica.url });
      }
    }
    return {
      ...chamado,
      mensagens,
      midias,
      naoLidas: mensagens.filter((m) => m.lidaEm === null && m.autorTipo === (ehDoTi ? 'SOLICITANTE' : 'TI')).length,
    };
  }

  /** Responde no chamado. O TI respondendo também assume o atendimento. */
  async responder(id: string, quem: Solicitante, conteudo: string): Promise<ChamadoMensagem> {
    const chamado = await this.exigirAcesso(id, quem);
    if (chamado.status === 'FECHADO') {
      throw new AppError('Este chamado está fechado. Abra um novo para continuar.', 409, 'CHAMADO_FECHADO');
    }

    const ehDoTi = quem.tipo === 'ADMIN' && quem.ti;
    const agora = new Date().toISOString();
    const mensagem = await this.chamados.addMensagem(
      {
        chamadoId: id,
        autorId: quem.id,
        autorNome: quem.nome,
        autorTipo: ehDoTi ? 'TI' : 'SOLICITANTE',
        conteudo: textoObrigatorio(conteudo, 'a mensagem', LIMITES_CHAMADO.maxMensagem),
      },
      agora,
    );

    // TI respondeu: assume o chamado e coloca em andamento, se ainda estava parado
    if (ehDoTi && chamado.status === 'ABERTO') {
      await this.chamados.update(
        id,
        { status: 'EM_ANDAMENTO', responsavelId: quem.id, responsavelNome: quem.nome, resolvidoEm: null },
        agora,
      );
    }
    if (ehDoTi) this.realtime.chamadoAtualizado(chamado.solicitanteId, id);
    return mensagem;
  }

  /** Muda o status. Só o TI; quem abriu pode apenas fechar o próprio chamado resolvido. */
  async mudarStatus(id: string, quem: Solicitante, status: StatusChamado): Promise<ChamadoCompleto> {
    const chamado = await this.exigirAcesso(id, quem);
    const ehDoTi = quem.tipo === 'ADMIN' && quem.ti;
    if (!ehDoTi && !(status === 'FECHADO' && chamado.status === 'RESOLVIDO')) {
      throw new AppError('Só o TI muda o andamento do chamado.', 403, 'FORBIDDEN');
    }

    const agora = new Date().toISOString();
    const atualizado = await this.chamados.update(
      id,
      {
        status,
        responsavelId: ehDoTi ? (chamado.responsavelId ?? quem.id) : chamado.responsavelId,
        responsavelNome: ehDoTi ? (chamado.responsavelNome ?? quem.nome) : chamado.responsavelNome,
        resolvidoEm: status === 'RESOLVIDO' ? agora : status === 'FECHADO' ? chamado.resolvidoEm : null,
      },
      agora,
    );
    if (ehDoTi) this.realtime.chamadoAtualizado(chamado.solicitanteId, id);
    this.log.info(`Chamado ${chamado.numero}: ${chamado.status} -> ${status} por ${quem.nome}`);
    return this.completar(atualizado, quem);
  }

  /** Abriu o chamado na tela: as mensagens do outro lado passam a lidas. */
  async marcarLidas(id: string, quem: Solicitante): Promise<number> {
    await this.exigirAcesso(id, quem);
    const ehDoTi = quem.tipo === 'ADMIN' && quem.ti;
    return this.chamados.marcarLidas(id, ehDoTi ? 'SOLICITANTE' : 'TI', new Date().toISOString());
  }

  /** Só o TI apaga um chamado (some para todo mundo). */
  async remover(id: string, quem: Solicitante): Promise<void> {
    if (!(quem.tipo === 'ADMIN' && quem.ti)) throw new AppError('Só o TI apaga chamados.', 403, 'FORBIDDEN');
    const removido = await this.chamados.delete(id);
    if (!removido) throw new NotFoundError('Chamado não encontrado');
  }
}
