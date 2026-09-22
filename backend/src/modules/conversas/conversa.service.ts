import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { AutoReplyService } from '../auto-replies/auto-reply.service';
import { renderAutoReply } from '../auto-replies/auto-reply.types';
import type { MidiaRepository } from '../content/content.repository';
import type { UserRepository } from '../users/user.repository';
import type { ConversaRepository } from './conversa.repository';
import {
  LIMITES_CONVERSA,
  gerarIdConversa,
  resumoDaMensagem,
  tituloPara,
  type Conversa,
  type ConversaResumo,
  type MensagemConversa,
  type Participante,
} from './conversa.types';

/** Quem está agindo: um funcionário no PC ou alguém do DP/TI. */
export interface Pessoa {
  id: string;
  nome: string;
  setor: string | null;
  ehDp: boolean;
  ehTi: boolean;
}

/** Avisa os participantes de que a conversa mudou. */
export interface ConversaNotifier {
  conversaAtualizada(userIds: string[], conversaId: string): void;
}

/** A pessoa do DP só responde automaticamente se não escreveu nos últimos minutos */
const ESPERA_RESPOSTA_AUTOMATICA_MIN = 30;

export class ConversaService {
  constructor(
    private readonly conversas: ConversaRepository,
    private readonly users: UserRepository,
    private readonly midias: MidiaRepository,
    private readonly autoReplies: AutoReplyService,
    private readonly realtime: ConversaNotifier,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ---------------------------------------------------------------- pessoas

  /** Com quem dá para conversar: colegas ativos e o pessoal do DP. */
  async contatos(quem: Pessoa): Promise<Participante[]> {
    const [funcionarios, dp] = await Promise.all([this.users.listByRole('EMPLOYEE'), this.users.listByRole('ADMIN')]);
    const lista: Participante[] = [];

    for (const usuario of funcionarios) {
      if (usuario.id === quem.id || usuario.status !== 'ACTIVE') continue;
      lista.push({
        id: usuario.id,
        nome: usuario.name,
        matricula: usuario.registration,
        setor: usuario.sector,
        ehDp: false,
        fotoMidiaId: usuario.fotoMidiaId,
        ativo: true,
      });
    }
    for (const usuario of dp) {
      // chatContact = aparece como contato (contas de serviço ficam de fora)
      if (usuario.id === quem.id || usuario.status !== 'ACTIVE' || !usuario.chatContact) continue;
      lista.push({
        id: usuario.id,
        nome: usuario.name,
        matricula: null,
        setor: null,
        ehDp: true,
        fotoMidiaId: usuario.fotoMidiaId,
        ativo: true,
      });
    }
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  private async participante(userId: string): Promise<Participante> {
    const usuario = await this.users.findById(userId);
    if (!usuario) {
      // Usuário excluído: a conversa continua no histórico
      return {
        id: userId,
        nome: 'Usuário removido',
        matricula: null,
        setor: null,
        ehDp: false,
        fotoMidiaId: null,
        ativo: false,
      };
    }
    return {
      id: usuario.id,
      nome: usuario.name,
      matricula: usuario.registration,
      setor: usuario.sector,
      ehDp: usuario.role === 'ADMIN',
      fotoMidiaId: usuario.fotoMidiaId,
      ativo: usuario.status === 'ACTIVE',
    };
  }

  // ---------------------------------------------------------------- lista de conversas

  async listar(quem: Pessoa): Promise<ConversaResumo[]> {
    const conversas = await this.conversas.listDoUsuario(quem.id, 100);
    return this.montarResumos(conversas, quem.id);
  }

  /** Monta os resumos reaproveitando uma busca por pessoa entre as conversas. */
  private async montarResumos(conversas: Conversa[], meuId: string): Promise<ConversaResumo[]> {
    const ids = conversas.map((c) => c.id);
    const [membros, ultimas, naoLidas] = await Promise.all([
      this.conversas.membrosDeVarias(ids),
      this.conversas.ultimaMensagemDeVarias(ids),
      this.conversas.naoLidasDeVarias(ids, meuId),
    ]);

    const cache = new Map<string, Participante>();
    const resumos: ConversaResumo[] = [];
    for (const conversa of conversas) {
      const ativos = (membros.get(conversa.id) ?? []).filter((m) => m.saiuEm === null);
      const participantes: Participante[] = [];
      for (const membro of ativos) {
        let pessoa = cache.get(membro.userId);
        if (!pessoa) {
          pessoa = await this.participante(membro.userId);
          cache.set(membro.userId, pessoa);
        }
        participantes.push(pessoa);
      }
      const ultima = ultimas.get(conversa.id) ?? null;
      resumos.push({
        ...conversa,
        participantes,
        titulo: tituloPara(conversa, participantes, meuId),
        ultimaMensagem: ultima
          ? {
              conteudo: resumoDaMensagem(ultima),
              autorNome: ultima.autorNome,
              tipo: ultima.tipo,
              createdAt: ultima.createdAt,
            }
          : null,
        naoLidas: naoLidas.get(conversa.id) ?? 0,
        meuPapel: ativos.find((m) => m.userId === meuId)?.papel ?? 'MEMBRO',
      });
    }
    return resumos;
  }

  /** Total de mensagens novas, para o contador do menu. */
  async totalNaoLidas(quem: Pessoa): Promise<number> {
    const conversas = await this.conversas.listDoUsuario(quem.id, 100);
    const naoLidas = await this.conversas.naoLidasDeVarias(
      conversas.map((c) => c.id),
      quem.id,
    );
    return [...naoLidas.values()].reduce((soma, valor) => soma + valor, 0);
  }

  // ---------------------------------------------------------------- criar e abrir

  /** Abre a conversa direta com alguém; se já existir, devolve a mesma. */
  async abrirDireta(quem: Pessoa, outroId: string): Promise<Conversa> {
    if (outroId === quem.id) throw new AppError('Não dá para conversar consigo mesmo.', 400, 'CONVERSA_INVALIDA');
    const outro = await this.users.findById(outroId);
    if (!outro || outro.status !== 'ACTIVE') throw new NotFoundError('Pessoa não encontrada');

    const existente = await this.conversas.findDireta(quem.id, outroId);
    if (existente) return existente;

    const agora = new Date().toISOString();
    return this.conversas.create(
      { id: gerarIdConversa(), tipo: 'DIRETA', nome: null, criadoPor: quem.id, createdAt: agora, updatedAt: agora },
      [
        { userId: quem.id, papel: 'MEMBRO' },
        { userId: outroId, papel: 'MEMBRO' },
      ],
    );
  }

  async criarGrupo(quem: Pessoa, nome: string, membrosIds: string[]): Promise<Conversa> {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) throw new AppError('Dê um nome ao grupo.', 400, 'NOME_OBRIGATORIO');
    if (nomeLimpo.length > LIMITES_CONVERSA.maxNomeGrupo) {
      throw new AppError(`O nome passa de ${LIMITES_CONVERSA.maxNomeGrupo} caracteres.`, 400, 'NOME_LONGO');
    }

    const outros = [...new Set(membrosIds)].filter((id) => id !== quem.id);
    if (outros.length === 0) throw new AppError('Escolha pelo menos uma pessoa para o grupo.', 400, 'GRUPO_VAZIO');
    if (outros.length + 1 > LIMITES_CONVERSA.maxMembrosGrupo) {
      throw new AppError(`Um grupo tem no máximo ${LIMITES_CONVERSA.maxMembrosGrupo} participantes.`, 400, 'GRUPO_GRANDE');
    }
    for (const id of outros) {
      const usuario = await this.users.findById(id);
      if (!usuario || usuario.status !== 'ACTIVE') {
        throw new AppError('Uma das pessoas escolhidas não existe mais.', 400, 'PESSOA_INVALIDA');
      }
    }

    const agora = new Date().toISOString();
    const conversa = await this.conversas.create(
      { id: gerarIdConversa(), tipo: 'GRUPO', nome: nomeLimpo, criadoPor: quem.id, createdAt: agora, updatedAt: agora },
      [{ userId: quem.id, papel: 'ADMIN' }, ...outros.map((id) => ({ userId: id, papel: 'MEMBRO' as const }))],
    );
    await this.mensagemDeSistema(conversa.id, quem, `${quem.nome} criou o grupo`);
    this.log.info(`Grupo criado por ${quem.nome}: ${nomeLimpo} (${outros.length + 1} participantes)`);
    return conversa;
  }

  private async mensagemDeSistema(conversaId: string, quem: Pessoa, texto: string): Promise<void> {
    await this.conversas.addMensagem(
      {
        conversaId,
        autorId: quem.id,
        autorNome: quem.nome,
        tipo: 'SISTEMA',
        conteudo: texto,
        midiaId: null,
        automatica: false,
      },
      new Date().toISOString(),
    );
  }

  // ---------------------------------------------------------------- mensagens

  /** Só quem participa lê a conversa. O TI usa lerComoTi(), que fica registrado. */
  private async exigirMembro(conversaId: string, quem: Pessoa) {
    const conversa = await this.conversas.findById(conversaId);
    if (!conversa) throw new NotFoundError('Conversa não encontrada');
    const membro = await this.conversas.membro(conversaId, quem.id);
    if (!membro || membro.saiuEm !== null) throw new NotFoundError('Conversa não encontrada');
    return { conversa, membro };
  }

  async mensagens(quem: Pessoa, conversaId: string, antesDoId?: number): Promise<MensagemConversa[]> {
    await this.exigirMembro(conversaId, quem);
    return this.conversas.listMensagens(conversaId, LIMITES_CONVERSA.paginaMensagens, antesDoId);
  }

  async enviar(quem: Pessoa, conversaId: string, conteudo: string, midiaId: string | null): Promise<MensagemConversa> {
    const { conversa } = await this.exigirMembro(conversaId, quem);
    const texto = conteudo.trim();
    if (!texto && !midiaId) throw new AppError('Escreva uma mensagem ou anexe um arquivo.', 400, 'MENSAGEM_VAZIA');
    if (texto.length > LIMITES_CONVERSA.maxConteudo) {
      throw new AppError(`A mensagem passa de ${LIMITES_CONVERSA.maxConteudo} caracteres.`, 400, 'MENSAGEM_LONGA');
    }
    if (midiaId) {
      const midia = await this.midias.findById(midiaId);
      if (!midia) throw new AppError('O arquivo anexado não existe mais.', 400, 'MIDIA_INEXISTENTE');
    }

    const agora = new Date().toISOString();
    const mensagem = await this.conversas.addMensagem(
      {
        conversaId,
        autorId: quem.id,
        autorNome: quem.nome,
        tipo: midiaId ? 'MIDIA' : 'TEXTO',
        conteudo: texto,
        midiaId,
        automatica: false,
      },
      agora,
    );

    await this.avisarParticipantes(conversaId);
    // Quem escreve já leu a própria mensagem
    await this.conversas.marcarLeitura(conversaId, quem.id, agora);
    await this.respostaAutomatica(conversa, quem).catch((err) =>
      this.log.error({ err }, 'Falha na resposta automática do DP'),
    );
    return mensagem;
  }

  /**
   * Resposta automática da pessoa do DP, como no chat anterior: vale só em
   * conversa direta entre funcionário e DP, e não dispara se essa pessoa
   * escreveu há pouco tempo.
   */
  private async respostaAutomatica(conversa: Conversa, autor: Pessoa): Promise<void> {
    if (conversa.tipo !== 'DIRETA' || autor.ehDp) return;
    const membros = await this.conversas.membros(conversa.id, false);
    const outroId = membros.find((m) => m.userId !== autor.id)?.userId;
    if (!outroId) return;

    const dp = await this.users.findById(outroId);
    if (!dp || dp.role !== 'ADMIN' || dp.status !== 'ACTIVE') return;

    const regra = await this.autoReplies.ruleFor(dp.id, autor.setor);
    if (!regra) return;

    const ultimas = await this.conversas.listMensagens(conversa.id, 20);
    const ultimaDoDp = [...ultimas].reverse().find((m) => m.autorId === dp.id);
    if (ultimaDoDp && Date.now() - Date.parse(ultimaDoDp.createdAt) < ESPERA_RESPOSTA_AUTOMATICA_MIN * 60_000) return;

    const conteudo = renderAutoReply(regra.content, { employeeName: autor.nome, sector: autor.setor, dpName: dp.name })
      .trim()
      .slice(0, LIMITES_CONVERSA.maxConteudo);
    if (!conteudo) return;

    await this.conversas.addMensagem(
      {
        conversaId: conversa.id,
        autorId: dp.id,
        autorNome: dp.name,
        tipo: 'TEXTO',
        conteudo,
        midiaId: null,
        automatica: true,
      },
      new Date().toISOString(),
    );
    await this.avisarParticipantes(conversa.id);
    this.log.info(`Resposta automática de ${dp.name} para ${autor.nome}`);
  }

  async marcarLidas(quem: Pessoa, conversaId: string): Promise<void> {
    await this.exigirMembro(conversaId, quem);
    await this.conversas.marcarLeitura(conversaId, quem.id, new Date().toISOString());
  }

  /** Apagar a própria mensagem; o TI pode apagar qualquer uma. */
  async apagarMensagem(quem: Pessoa, mensagemId: number): Promise<void> {
    const mensagem = await this.conversas.findMensagem(mensagemId);
    if (!mensagem) throw new NotFoundError('Mensagem não encontrada');
    if (mensagem.autorId !== quem.id && !quem.ehTi) {
      throw new AppError('Você só apaga as suas mensagens.', 403, 'FORBIDDEN');
    }
    await this.conversas.apagarMensagem(mensagemId, new Date().toISOString());
    await this.avisarParticipantes(mensagem.conversaId);
  }

  private async avisarParticipantes(conversaId: string): Promise<void> {
    const membros = await this.conversas.membros(conversaId, false);
    this.realtime.conversaAtualizada(
      membros.map((m) => m.userId),
      conversaId,
    );
  }

  // ---------------------------------------------------------------- participantes do grupo

  /** Só o administrador do grupo mexe nos participantes e no nome. */
  private async exigirAdminDoGrupo(conversaId: string, quem: Pessoa) {
    const { conversa, membro } = await this.exigirMembro(conversaId, quem);
    if (conversa.tipo !== 'GRUPO') throw new AppError('Isso vale só para grupos.', 400, 'NAO_EH_GRUPO');
    if (membro.papel !== 'ADMIN') throw new AppError('Só quem administra o grupo faz isso.', 403, 'FORBIDDEN');
    return conversa;
  }

  async adicionarMembro(quem: Pessoa, conversaId: string, novoId: string): Promise<void> {
    await this.exigirAdminDoGrupo(conversaId, quem);
    const novo = await this.users.findById(novoId);
    if (!novo || novo.status !== 'ACTIVE') throw new NotFoundError('Pessoa não encontrada');

    const atuais = await this.conversas.membros(conversaId, false);
    if (atuais.some((m) => m.userId === novoId)) return;
    if (atuais.length + 1 > LIMITES_CONVERSA.maxMembrosGrupo) {
      throw new AppError(`Um grupo tem no máximo ${LIMITES_CONVERSA.maxMembrosGrupo} participantes.`, 400, 'GRUPO_GRANDE');
    }

    const agora = new Date().toISOString();
    await this.conversas.adicionarMembro(conversaId, novoId, 'MEMBRO', agora);
    await this.mensagemDeSistema(conversaId, quem, `${quem.nome} adicionou ${novo.name}`);
    await this.avisarParticipantes(conversaId);
  }

  async removerMembro(quem: Pessoa, conversaId: string, membroId: string): Promise<void> {
    await this.exigirAdminDoGrupo(conversaId, quem);
    if (membroId === quem.id) throw new AppError('Para sair do grupo, use "sair".', 400, 'USE_SAIR');

    const alvo = await this.participante(membroId);
    const agora = new Date().toISOString();
    await this.conversas.removerMembro(conversaId, membroId, agora);
    await this.mensagemDeSistema(conversaId, quem, `${quem.nome} removeu ${alvo.nome}`);
    await this.avisarParticipantes(conversaId);
  }

  /** Sair do grupo. Se o último administrador sair, o mais antigo assume. */
  async sair(quem: Pessoa, conversaId: string): Promise<void> {
    const { conversa } = await this.exigirMembro(conversaId, quem);
    if (conversa.tipo !== 'GRUPO') throw new AppError('Conversa direta não tem como sair.', 400, 'NAO_EH_GRUPO');

    const agora = new Date().toISOString();
    await this.conversas.removerMembro(conversaId, quem.id, agora);
    await this.mensagemDeSistema(conversaId, quem, `${quem.nome} saiu do grupo`);

    const restantes = await this.conversas.membros(conversaId, false);
    if (restantes.length > 0 && !restantes.some((m) => m.papel === 'ADMIN')) {
      const maisAntigo = restantes[0];
      await this.conversas.adicionarMembro(conversaId, maisAntigo.userId, 'ADMIN', maisAntigo.entrouEm);
      this.log.info(`Grupo ${conversaId}: ${maisAntigo.userId} virou administrador (o anterior saiu)`);
    }
    await this.avisarParticipantes(conversaId);
  }

  async renomearGrupo(quem: Pessoa, conversaId: string, nome: string): Promise<void> {
    await this.exigirAdminDoGrupo(conversaId, quem);
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) throw new AppError('Dê um nome ao grupo.', 400, 'NOME_OBRIGATORIO');
    if (nomeLimpo.length > LIMITES_CONVERSA.maxNomeGrupo) {
      throw new AppError(`O nome passa de ${LIMITES_CONVERSA.maxNomeGrupo} caracteres.`, 400, 'NOME_LONGO');
    }
    await this.conversas.renomear(conversaId, nomeLimpo, new Date().toISOString());
    await this.mensagemDeSistema(conversaId, quem, `${quem.nome} mudou o nome do grupo para "${nomeLimpo}"`);
    await this.avisarParticipantes(conversaId);
  }

  /** Dados de uma conversa para a tela (participantes e papel de quem pede). */
  async detalhe(quem: Pessoa, conversaId: string): Promise<ConversaResumo> {
    const { conversa } = await this.exigirMembro(conversaId, quem);
    const [resumo] = await this.montarResumos([conversa], quem.id);
    return resumo;
  }

  // ---------------------------------------------------------------- auditoria do TI

  /**
   * O TI enxerga todas as conversas. Cada leitura de conteúdo fica registrada,
   * com quem abriu e quando — foi a condição combinada para liberar o acesso.
   */
  async listarComoTi(quem: Pessoa): Promise<ConversaResumo[]> {
    this.exigirTi(quem);
    const conversas = await this.conversas.listTodas(200);
    return this.montarResumos(conversas, quem.id);
  }

  async lerComoTi(quem: Pessoa, conversaId: string, antesDoId?: number): Promise<MensagemConversa[]> {
    this.exigirTi(quem);
    const conversa = await this.conversas.findById(conversaId);
    if (!conversa) throw new NotFoundError('Conversa não encontrada');

    await this.conversas.registrarAcessoTi(conversaId, quem.id, quem.nome, new Date().toISOString());
    this.log.warn(`Auditoria: ${quem.nome} (TI) abriu a conversa ${conversaId}`);
    return this.conversas.listMensagens(conversaId, LIMITES_CONVERSA.paginaMensagens, antesDoId);
  }

  async acessosDoTi(quem: Pessoa): Promise<{ conversaId: string; usuarioNome: string; createdAt: string }[]> {
    this.exigirTi(quem);
    return this.conversas.listarAcessosTi(200);
  }

  /** Apagar a conversa inteira é só do TI (limpeza). */
  async apagarConversa(quem: Pessoa, conversaId: string): Promise<void> {
    this.exigirTi(quem);
    const removida = await this.conversas.delete(conversaId);
    if (!removida) throw new NotFoundError('Conversa não encontrada');
    this.log.warn(`Conversa ${conversaId} apagada por ${quem.nome} (TI)`);
  }

  private exigirTi(quem: Pessoa): void {
    if (!quem.ehTi) throw new AppError('Acesso permitido apenas ao TI', 403, 'FORBIDDEN');
  }
}
