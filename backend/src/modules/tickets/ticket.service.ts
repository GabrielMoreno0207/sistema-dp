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
  type ChamadoNota,
  type ChamadoResumo,
  type Prioridade,
  type StatusChamado,
} from './ticket.types';

/**
 * Caracteres mínimos na descrição de um pedido de relatório.
 *
 * Não é burocracia: "preciso de um relatório" não diz o que mostrar, de qual
 * período nem para quê, e o chamado volta para quem abriu só para perguntar.
 */
const MINIMO_DESCRICAO_RELATORIO = 15;

/** Quem está agindo: o funcionário no PC, ou alguém do DP/TI na Central. */
export type Solicitante =
  | { tipo: 'FUNCIONARIO'; id: string; nome: string; computadorId: string; setor: string | null; ti: boolean }
  | { tipo: 'ADMIN'; id: string; nome: string; setor: string | null; ti: boolean };

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
    if (!employee) throw new AppError('Entre com seu usuário para abrir um chamado', 401, 'NO_EMPLOYEE');
    return {
      tipo: 'FUNCIONARIO',
      id: employee.id,
      nome: employee.name,
      computadorId,
      setor: employee.sector,
      // Quem é do TI é reconhecido pelo setor, igual ao resto do sistema
      ti: employee.acessoAdmin === 'TI',
    };
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

    // Relatório não é defeito, é trabalho a fazer: sem dizer o que o relatório
    // precisa mostrar, não há o que desenvolver. A tela já cobra, e aqui a
    // regra vale para qualquer caminho (Central do DP, celular, script).
    if (dados.categoria === 'RELATORIO' && dados.descricao.trim().length < MINIMO_DESCRICAO_RELATORIO) {
      throw new AppError(
        'Conte como o relatório precisa ser: quais informações, de qual período e para que vai ser usado.',
        400,
        'DESCRICAO_CURTA',
      );
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
        solicitanteSetor: quem.setor,
        // O próprio TI abrindo chamado está testando o fluxo, não pedindo ajuda
        teste: quem.ti,
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
    const ehDoTi = quem.ti;
    if (!ehDoTi && chamado.solicitanteId !== quem.id) throw new NotFoundError('Chamado não encontrado');
    return chamado;
  }

  private async completar(chamado: Chamado, quem: Solicitante): Promise<ChamadoCompleto> {
    const ehDoTi = quem.ti;
    const [mensagens, midiaIds, notas] = await Promise.all([
      this.chamados.listMensagens(chamado.id),
      this.chamados.listMidiaIds(chamado.id),
      // A leitura das notas nem acontece para quem abriu o chamado
      ehDoTi ? this.chamados.listNotas(chamado.id) : Promise.resolve([] as ChamadoNota[]),
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
      notas,
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

    const ehDoTi = quem.ti;
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

  /**
   * Nota interna: recado do TI para o TI dentro do chamado.
   *
   * Serve para o atendimento trocar de mão sem recomeçar — o que já foi
   * tentado, o que descobriu, onde parou. Quem abriu o chamado não vê, e por
   * isso a nota pode dizer o que não cabe na conversa com a pessoa.
   */
  async anotar(id: string, quem: Solicitante, conteudo: string): Promise<ChamadoNota> {
    if (!quem.ti) throw new AppError('Só o TI escreve notas no chamado.', 403, 'FORBIDDEN');
    await this.exigirAcesso(id, quem);
    const nota = await this.chamados.addNota(
      {
        chamadoId: id,
        autorId: quem.id,
        autorNome: quem.nome,
        conteudo: textoObrigatorio(conteudo, 'a nota', LIMITES_CHAMADO.maxNota),
      },
      new Date().toISOString(),
    );
    // Nota não avisa o solicitante: ela não é para ele
    this.log.info(`Nota no chamado ${id} por ${quem.nome}`);
    return nota;
  }

  /**
   * Alguém do TI assume o chamado.
   *
   * A fila é compartilhada: o chamado cai para o time todo e quem puder atender
   * clica em aceitar. A partir daí o nome fica visível para o solicitante e para
   * o resto do TI, que assim não começa o mesmo atendimento em paralelo.
   *
   * Chamado que já tem dono não muda de mão por acidente: quem clica em aceitar
   * recebe o aviso de quem está cuidando. Para assumir mesmo assim — a pessoa
   * saiu de férias, entrou em reunião, trocou de turno — é preciso dizer
   * `assumir`, e a troca fica registrada numa nota interna.
   */
  async aceitar(id: string, quem: Solicitante, assumir = false): Promise<ChamadoCompleto> {
    const chamado = await this.exigirAcesso(id, quem);
    if (!quem.ti) {
      throw new AppError('Só o TI aceita chamados.', 403, 'FORBIDDEN');
    }
    if (chamado.status === 'FECHADO') {
      throw new AppError('Este chamado já foi encerrado.', 409, 'CHAMADO_FECHADO');
    }
    const deOutraPessoa = Boolean(chamado.responsavelId) && chamado.responsavelId !== quem.id;
    if (deOutraPessoa && !assumir) {
      throw new AppError(`${chamado.responsavelNome} já está cuidando deste chamado.`, 409, 'CHAMADO_COM_DONO');
    }

    const agora = new Date().toISOString();
    const atualizado = await this.chamados.update(
      id,
      {
        status: chamado.status === 'ABERTO' ? 'EM_ANDAMENTO' : chamado.status,
        responsavelId: quem.id,
        responsavelNome: quem.nome,
        resolvidoEm: chamado.resolvidoEm,
      },
      agora,
    );
    // A troca de mão fica escrita: quem pegou, de quem e quando
    if (deOutraPessoa) {
      await this.chamados.addNota(
        {
          chamadoId: id,
          autorId: quem.id,
          autorNome: quem.nome,
          conteudo: `${quem.nome} assumiu o chamado, que estava com ${chamado.responsavelNome}.`,
        },
        agora,
      );
    }
    this.realtime.chamadoAtualizado(chamado.solicitanteId, id);
    this.log.info(
      deOutraPessoa
        ? `Chamado ${chamado.numero} assumido por ${quem.nome} (estava com ${chamado.responsavelNome})`
        : `Chamado ${chamado.numero} aceito por ${quem.nome}`,
    );
    return this.completar(atualizado, quem);
  }

  /** Muda o status. Só o TI; quem abriu pode apenas fechar o próprio chamado resolvido. */
  async mudarStatus(id: string, quem: Solicitante, status: StatusChamado): Promise<ChamadoCompleto> {
    const chamado = await this.exigirAcesso(id, quem);
    const ehDoTi = quem.ti;
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
    const ehDoTi = quem.ti;
    return this.chamados.marcarLidas(id, ehDoTi ? 'SOLICITANTE' : 'TI', new Date().toISOString());
  }

  /** Só o TI apaga um chamado (some para todo mundo). */
  async remover(id: string, quem: Solicitante): Promise<void> {
    if (!quem.ti) throw new AppError('Só o TI apaga chamados.', 403, 'FORBIDDEN');
    const removido = await this.chamados.delete(id);
    if (!removido) throw new NotFoundError('Chamado não encontrado');
  }
}
