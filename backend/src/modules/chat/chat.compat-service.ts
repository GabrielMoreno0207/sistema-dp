import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { ConversaRepository } from '../conversas/conversa.repository';
import type { ConversaService, Pessoa } from '../conversas/conversa.service';
import type { EmployeeService } from '../employees/employee.service';
import type { UserRepository } from '../users/user.repository';
import type { ChatContact, ChatConversation, ChatMessage } from './chat.types';

/**
 * Mantém as rotas antigas de chat (/api/chats e /api/chat) funcionando sobre o
 * modelo novo de conversas.
 *
 * A Central na web e a versão atual do aplicativo ainda falam por aqui. Quando
 * as duas estiverem na tela nova de mensagens, este arquivo e o módulo chat
 * antigo podem sair.
 */
export class ChatCompatService {
  constructor(
    private readonly conversas: ConversaService,
    private readonly repository: ConversaRepository,
    private readonly employees: EmployeeService,
    private readonly users: UserRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  private async pessoaDoDp(dpUserId: string): Promise<Pessoa> {
    const usuario = await this.users.findById(dpUserId);
    if (!usuario || usuario.role !== 'ADMIN' || usuario.status !== 'ACTIVE') {
      throw new NotFoundError('Pessoa do DP não encontrada');
    }
    return { id: usuario.id, nome: usuario.name, setor: null, ehDp: true, ehTi: usuario.superAdmin };
  }

  private async pessoaDoPc(computerId: string): Promise<Pessoa> {
    const employee = await this.employees.getSessionEmployee(computerId);
    if (!employee) throw new AppError('Entre com sua matrícula para usar as mensagens', 401, 'NO_EMPLOYEE');
    const completo = await this.users.findById(employee.id);
    return { id: employee.id, nome: employee.name, setor: completo?.sector ?? null, ehDp: false, ehTi: false };
  }

  /** Converte a mensagem do modelo novo para o formato que as telas antigas esperam. */
  private paraFormatoAntigo(
    mensagem: { id: number; autorId: string; autorNome: string; conteudo: string; createdAt: string; automatica: boolean },
    employeeId: string,
    dpUserId: string,
    leituraDoOutro: string | null,
  ): ChatMessage {
    const doDp = mensagem.autorId === dpUserId;
    return {
      id: mensagem.id,
      employeeId,
      dpUserId,
      senderType: doDp ? 'DP' : 'EMPLOYEE',
      senderName: mensagem.autorNome,
      content: mensagem.conteudo,
      createdAt: mensagem.createdAt,
      // O modelo novo guarda a última leitura por pessoa, não por mensagem
      readAt: leituraDoOutro && leituraDoOutro >= mensagem.createdAt ? leituraDoOutro : null,
      automatic: mensagem.automatica,
    };
  }

  /** Conversa direta entre um funcionário e uma pessoa do DP (cria se não existir). */
  private async conversaDireta(quem: Pessoa, outroId: string): Promise<string> {
    const conversa = await this.conversas.abrirDireta(quem, outroId);
    return conversa.id;
  }

  // ---------------------------------------------------------------- lado do DP (Central)

  async listConversations(dpUserId: string): Promise<ChatConversation[]> {
    const quem = await this.pessoaDoDp(dpUserId);
    const resumos = await this.conversas.listar(quem);
    const conversas: ChatConversation[] = [];

    for (const resumo of resumos) {
      if (resumo.tipo !== 'DIRETA') continue;
      const outro = resumo.participantes.find((p) => p.id !== dpUserId);
      // A Central só mostra conversas com funcionários
      if (!outro || outro.ehDp) continue;
      conversas.push({
        employee: {
          id: outro.id,
          name: outro.nome,
          registration: outro.matricula,
          sector: outro.setor,
          status: outro.ativo ? 'ACTIVE' : 'INACTIVE',
        },
        lastMessage: {
          content: resumo.ultimaMensagem?.conteudo ?? '',
          senderType: resumo.ultimaMensagem?.autorNome === quem.nome ? 'DP' : 'EMPLOYEE',
          createdAt: resumo.ultimaMensagem?.createdAt ?? resumo.updatedAt,
        },
        unreadCount: resumo.naoLidas,
      });
    }
    return conversas;
  }

  async threadForDp(dpUserId: string, employeeId: string): Promise<{ messages: ChatMessage[] }> {
    const quem = await this.pessoaDoDp(dpUserId);
    const conversaId = await this.conversaDireta(quem, employeeId);
    const [mensagens, membros] = await Promise.all([
      this.repository.listMensagens(conversaId, 300),
      this.repository.membros(conversaId, true),
    ]);
    const leituraDoFuncionario = membros.find((m) => m.userId === employeeId)?.ultimaLeitura ?? null;
    return {
      messages: mensagens
        .filter((m) => m.tipo !== 'SISTEMA')
        .map((m) => this.paraFormatoAntigo(m, employeeId, dpUserId, leituraDoFuncionario)),
    };
  }

  async sendFromDp(
    dpUserId: string,
    _dpName: string,
    employeeId: string,
    content: string,
  ): Promise<{ message: ChatMessage; deliveredTo: number }> {
    const quem = await this.pessoaDoDp(dpUserId);
    // Só funcionário ativo, como antes
    await this.employees.getActive(employeeId);
    const conversaId = await this.conversaDireta(quem, employeeId);
    const mensagem = await this.conversas.enviar(quem, conversaId, content, null);
    this.log.info(`Chat (Central): ${quem.nome} → funcionário ${employeeId}`);
    // deliveredTo era a contagem de PCs que receberam; o aviso agora vai por sala
    return { message: this.paraFormatoAntigo(mensagem, employeeId, dpUserId, null), deliveredTo: 0 };
  }

  async markReadByDp(dpUserId: string, employeeId: string): Promise<void> {
    const quem = await this.pessoaDoDp(dpUserId);
    const conversaId = await this.conversaDireta(quem, employeeId);
    await this.conversas.marcarLidas(quem, conversaId);
  }

  // ---------------------------------------------------------------- lado do funcionário (app atual)

  async contactsForEmployee(computerId: string): Promise<{ contacts: ChatContact[]; unreadCount: number }> {
    const quem = await this.pessoaDoPc(computerId);
    const [contatos, resumos] = await Promise.all([this.conversas.contatos(quem), this.conversas.listar(quem)]);

    // Quem está na lista de contatos, mais quem já conversou com esta pessoa:
    // uma conta do DP fora da lista que escreveu precisa aparecer para responder
    const doDp = new Map(contatos.filter((c) => c.ehDp).map((c) => [c.id, c]));
    for (const resumo of resumos) {
      if (resumo.tipo !== 'DIRETA') continue;
      for (const participante of resumo.participantes) {
        if (participante.id !== quem.id && participante.ehDp && !doDp.has(participante.id)) {
          doDp.set(participante.id, participante);
        }
      }
    }

    const contacts: ChatContact[] = [];
    for (const contato of doDp.values()) {
      const conversa = resumos.find(
        (r) => r.tipo === 'DIRETA' && r.participantes.some((p) => p.id === contato.id),
      );
      contacts.push({
        id: contato.id,
        name: contato.nome,
        unreadCount: conversa?.naoLidas ?? 0,
        lastMessage: conversa?.ultimaMensagem
          ? {
              content: conversa.ultimaMensagem.conteudo,
              senderType: conversa.ultimaMensagem.autorNome === quem.nome ? 'EMPLOYEE' : 'DP',
              createdAt: conversa.ultimaMensagem.createdAt,
            }
          : null,
      });
    }
    // Quem já tem conversa aparece primeiro, como antes
    contacts.sort((a, b) => {
      const dataA = a.lastMessage?.createdAt ?? '';
      const dataB = b.lastMessage?.createdAt ?? '';
      if (dataA === dataB) return a.name.localeCompare(b.name, 'pt-BR');
      return dataB.localeCompare(dataA);
    });
    return { contacts, unreadCount: contacts.reduce((soma, c) => soma + c.unreadCount, 0) };
  }

  async threadForEmployee(computerId: string, dpUserId: string): Promise<{ messages: ChatMessage[]; unreadCount: number }> {
    const quem = await this.pessoaDoPc(computerId);
    await this.pessoaDoDp(dpUserId);
    const conversaId = await this.conversaDireta(quem, dpUserId);
    const [mensagens, naoLidas] = await Promise.all([
      this.repository.listMensagens(conversaId, 300),
      this.repository.naoLidasDeVarias([conversaId], quem.id),
    ]);
    const membros = await this.repository.membros(conversaId, true);
    const leituraDoDp = membros.find((m) => m.userId === dpUserId)?.ultimaLeitura ?? null;
    return {
      messages: mensagens
        .filter((m) => m.tipo !== 'SISTEMA')
        .map((m) => this.paraFormatoAntigo(m, quem.id, dpUserId, leituraDoDp)),
      unreadCount: naoLidas.get(conversaId) ?? 0,
    };
  }

  async sendFromEmployee(computerId: string, dpUserId: string, content: string): Promise<ChatMessage> {
    const quem = await this.pessoaDoPc(computerId);
    await this.pessoaDoDp(dpUserId);
    const conversaId = await this.conversaDireta(quem, dpUserId);
    const mensagem = await this.conversas.enviar(quem, conversaId, content, null);
    return this.paraFormatoAntigo(mensagem, quem.id, dpUserId, null);
  }

  async markReadByEmployee(computerId: string, dpUserId: string): Promise<void> {
    const quem = await this.pessoaDoPc(computerId);
    await this.pessoaDoDp(dpUserId);
    const conversaId = await this.conversaDireta(quem, dpUserId);
    await this.conversas.marcarLidas(quem, conversaId);
  }

  // ---------------------------------------------------------------- números e limpeza do TI

  /**
   * Conversas e mensagens por pessoa do DP, sem nenhum conteúdo: é o que a
   * seção do TI mostra para decidir o que limpar.
   */
  async summaryByDpUser(): Promise<{ dpUserId: string; conversations: number; messages: number; lastAt: string | null }[]> {
    const conversas = await this.repository.listTodas(500);
    const ids = conversas.map((c) => c.id);
    const [membros, totais, ultimas] = await Promise.all([
      this.repository.membrosDeVarias(ids),
      this.repository.contarMensagensPorConversa(ids),
      this.repository.ultimaMensagemDeVarias(ids),
    ]);

    const porDp = new Map<string, { conversations: number; messages: number; lastAt: string | null }>();
    for (const conversa of conversas) {
      const quantidade = totais.get(conversa.id) ?? 0;
      if (quantidade === 0) continue;
      for (const membro of membros.get(conversa.id) ?? []) {
        const usuario = await this.users.findById(membro.userId);
        if (!usuario || usuario.role !== 'ADMIN') continue;
        const atual = porDp.get(usuario.id) ?? { conversations: 0, messages: 0, lastAt: null };
        const ultima = ultimas.get(conversa.id)?.createdAt ?? null;
        porDp.set(usuario.id, {
          conversations: atual.conversations + 1,
          messages: atual.messages + quantidade,
          lastAt: !atual.lastAt || (ultima && ultima > atual.lastAt) ? ultima : atual.lastAt,
        });
      }
    }
    return [...porDp.entries()].map(([dpUserId, dados]) => ({ dpUserId, ...dados }));
  }

  /** Apaga as mensagens da conversa entre uma pessoa do DP e um funcionário. */
  async deleteConversation(dpUserId: string, employeeId: string): Promise<number> {
    const conversa = await this.repository.findDireta(dpUserId, employeeId);
    if (!conversa) return 0;
    return this.repository.apagarMensagens([conversa.id], null);
  }

  /** dpUserId null = todas as pessoas do DP; antes null = tudo. */
  async deleteMessages(dpUserId: string | null, antes: Date | null): Promise<number> {
    const conversas = await this.repository.listTodas(500);
    const ids: string[] = [];

    for (const conversa of conversas) {
      const membros = await this.repository.membros(conversa.id, true);
      let temDp = false;
      for (const membro of membros) {
        const usuario = await this.users.findById(membro.userId);
        if (!usuario || usuario.role !== 'ADMIN') continue;
        if (!dpUserId || usuario.id === dpUserId) temDp = true;
      }
      if (temDp) ids.push(conversa.id);
    }
    return this.repository.apagarMensagens(ids, antes ? antes.toISOString() : null);
  }
}
