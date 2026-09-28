import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { ContentService } from '../content/content.service';
import type { MessageService, SendMessageInput } from '../messages/message.service';
import type { AgendamentoRepository } from './agendamento.repository';
import {
  gerarIdAgendamento,
  LIMITES_AGENDAMENTO,
  type Agendamento,
  type DadosMuralAgendado,
  type TipoAgendamento,
} from './agendamento.types';

/** Quem está agendando (DP/TI, pela conta ou pelo setor) */
export interface QuemAgenda {
  userId: string;
  name: string;
}

export class AgendamentoService {
  private timer: NodeJS.Timeout | null = null;
  private rodando = false;

  constructor(
    private readonly repositorio: AgendamentoRepository,
    private readonly mensagens: MessageService,
    private readonly conteudo: ContentService,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ---------------------------------------------------------------- agendar

  async agendarComunicado(dados: SendMessageInput, quando: string, quem: QuemAgenda): Promise<Agendamento> {
    const executarEm = this.validarData(quando);
    await this.exigirVaga();
    // Confere agora (destino, anexos) para o erro aparecer para quem agenda
    await this.mensagens.validarEnvio(dados, quem.userId);
    const limpo: SendMessageInput = {
      title: dados.title.trim(),
      content: dados.content.trim(),
      type: dados.type,
      target: dados.target,
      ...(dados.targetId ? { targetId: dados.targetId.trim() } : {}),
      ...(dados.attachmentIds?.length ? { attachmentIds: [...new Set(dados.attachmentIds)] } : {}),
      exigeCiencia: dados.exigeCiencia === true,
    };
    return this.criar('COMUNICADO', limpo, executarEm, quem);
  }

  async agendarMural(dados: DadosMuralAgendado, quando: string, quem: QuemAgenda): Promise<Agendamento> {
    const executarEm = this.validarData(quando);
    await this.exigirVaga();
    await this.conteudo.validarMural(dados);
    return this.criar('MURAL', { titulo: dados.titulo.trim(), texto: dados.texto.trim(), midiaId: dados.midiaId }, executarEm, quem);
  }

  private async criar(
    tipo: TipoAgendamento,
    dados: SendMessageInput | DadosMuralAgendado,
    executarEm: string,
    quem: QuemAgenda,
  ): Promise<Agendamento> {
    const agendamento: Agendamento = {
      id: gerarIdAgendamento(),
      tipo,
      dados,
      executarEm,
      status: 'PENDENTE',
      criadoPorId: quem.userId,
      criadoPorNome: quem.name,
      resultadoId: null,
      erro: null,
      enviadoEm: null,
      createdAt: new Date().toISOString(),
    };
    await this.repositorio.create(agendamento);
    this.log.info(`${quem.name} agendou ${tipo === 'MURAL' ? 'recado do mural' : 'comunicado'} para ${executarEm} (${agendamento.id})`);
    return agendamento;
  }

  /** Data em ISO, no futuro (com folga) e até um ano. Devolve normalizada em UTC. */
  private validarData(quando: string): string {
    const data = new Date(quando);
    if (Number.isNaN(data.getTime())) throw new AppError('Data e hora do agendamento inválidas.', 400, 'DATA_INVALIDA');
    const falta = data.getTime() - Date.now();
    if (falta < LIMITES_AGENDAMENTO.antecedenciaMinimaMs) {
      throw new AppError('Escolha uma data e hora no futuro (pelo menos 1 minuto à frente).', 400, 'DATA_PASSADA');
    }
    if (falta > LIMITES_AGENDAMENTO.antecedenciaMaximaMs) {
      throw new AppError('Dá para agendar com até um ano de antecedência.', 400, 'DATA_DISTANTE');
    }
    return data.toISOString();
  }

  private async exigirVaga(): Promise<void> {
    if ((await this.repositorio.contarPendentes()) >= LIMITES_AGENDAMENTO.maxPendentes) {
      throw new AppError('Há agendamentos demais esperando. Cancele algum antes de agendar outro.', 400, 'AGENDAMENTOS_DEMAIS');
    }
  }

  // ---------------------------------------------------------------- consultar e cancelar

  listar(tipo: TipoAgendamento | null): Promise<Agendamento[]> {
    return this.repositorio.listar(tipo, 20);
  }

  async cancelar(id: string, quem: QuemAgenda): Promise<void> {
    const agendamento = await this.repositorio.findById(id);
    if (!agendamento) throw new NotFoundError('Agendamento não encontrado');
    if (!(await this.repositorio.mudarStatus(id, 'PENDENTE', 'CANCELADO'))) {
      throw new AppError('Esse agendamento já foi enviado ou cancelado.', 409, 'AGENDAMENTO_RESOLVIDO');
    }
    this.log.info(`${quem.name} cancelou o agendamento ${id}`);
  }

  // ---------------------------------------------------------------- relógio

  /** Liga a conferência periódica (e já envia o que venceu com o servidor desligado). */
  async iniciar(): Promise<void> {
    const recuperados = await this.repositorio.recuperarInterrompidos();
    if (recuperados > 0) this.log.warn(`${recuperados} agendamento(s) interrompido(s) voltaram para a fila`);
    await this.executarVencidos();
    this.timer = setInterval(() => void this.executarVencidos(), LIMITES_AGENDAMENTO.intervaloMs);
    this.timer.unref();
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Envia o que já chegou na hora. Devolve quantos saíram (usado nos testes). */
  async executarVencidos(agora = new Date()): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    let enviados = 0;
    try {
      for (const agendamento of await this.repositorio.vencidos(agora.toISOString())) {
        // Marca antes de enviar: se algo rodar em paralelo, não sai duas vezes
        if (!(await this.repositorio.mudarStatus(agendamento.id, 'PENDENTE', 'ENVIANDO'))) continue;
        if (await this.executar(agendamento)) enviados += 1;
      }
    } catch (err) {
      this.log.error({ err }, 'Falha ao conferir os agendamentos');
    } finally {
      this.rodando = false;
    }
    return enviados;
  }

  private async executar(agendamento: Agendamento): Promise<boolean> {
    const atraso = Date.now() - Date.parse(agendamento.executarEm);
    try {
      let resultadoId: string;
      if (agendamento.tipo === 'COMUNICADO') {
        const { message } = await this.mensagens.send(
          agendamento.dados as SendMessageInput,
          agendamento.criadoPorNome,
          agendamento.criadoPorId,
        );
        resultadoId = message.id;
      } else {
        const post = await this.conteudo.criarMural({ ...(agendamento.dados as DadosMuralAgendado), ativo: true }, agendamento.criadoPorNome);
        resultadoId = post.id;
      }
      await this.repositorio.concluir(agendamento.id, 'ENVIADO', resultadoId, null, new Date().toISOString());
      this.log.info(
        `Agendamento ${agendamento.id} enviado (${resultadoId})${atraso > 5 * 60_000 ? `, ${Math.round(atraso / 60_000)} min atrasado (servidor estava fora)` : ''}`,
      );
      return true;
    } catch (err) {
      const motivo = err instanceof Error ? err.message : 'Falha inesperada';
      await this.repositorio.concluir(agendamento.id, 'FALHOU', null, motivo.slice(0, 500), new Date().toISOString());
      this.log.error({ err }, `Agendamento ${agendamento.id} falhou`);
      return false;
    }
  }
}
