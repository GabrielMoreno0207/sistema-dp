import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { AutoReplyService } from '../auto-replies/auto-reply.service';
import { renderAutoReply } from '../auto-replies/auto-reply.types';
import type { MidiaRepository } from '../content/content.repository';
import { emojiValido, type ReacaoRepository, type ReacaoResumo } from '../reacoes/reacao';
import { acessoDoSetor } from '../auth/acesso-por-setor';
import type { UserRepository } from '../users/user.repository';
import type { User } from '../users/user.types';
import { midiaPublica, type MidiaPublica } from '../content/content.types';
import type { AvisoDeMensagem } from '../../realtime/socket-server';
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
/** Pedaço da mensagem citada, para a tela desenhar o bloco da resposta. */
export interface Citacao {
  id: number;
  autorNome: string;
  resumo: string;
  apagada: boolean;
}

/** Mensagem como a tela recebe: com o arquivo anexado e a citação já prontos. */
export interface MensagemComMidia extends MensagemConversa {
  midia: MidiaPublica | null;
  respondida: Citacao | null;
  /** Reações da mensagem, uma linha por emoji (vazio = ninguém reagiu) */
  reacoes: ReacaoResumo[];
}

export interface ConversaNotifier {
  conversaAtualizada(userIds: string[], conversaId: string, mensagem?: AvisoDeMensagem): void;
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
    private readonly reacoes: ReacaoRepository,
  ) {}

  // ---------------------------------------------------------------- DP/TI só entre si

  /** Conta da Central ou funcionário do setor do DP/TI */
  private ehEquipeDpTi(usuario: User): boolean {
    return usuario.role === 'ADMIN' || acessoDoSetor(usuario.sector) !== 'NENHUM';
  }

  private async quemEhEquipeDpTi(quem: Pessoa): Promise<boolean> {
    if (quem.ehDp) return true;
    const usuario = await this.users.findById(quem.id);
    return usuario !== null && this.ehEquipeDpTi(usuario);
  }

  /** A pessoa ligou "só o DP e o TI me mandam mensagem" (vale enquanto ela for do DP/TI) */
  private soAceitaDpTi(usuario: User): boolean {
    return usuario.mensagensSoDpTi && this.ehEquipeDpTi(usuario);
  }

  /** Barra quem não é do DP/TI de escrever para (ou pôr em grupo) quem só aceita o DP/TI. */
  private async exigirQuePodeEscrever(quem: Pessoa, destinos: User[]): Promise<void> {
    const bloqueado = destinos.find((usuario) => this.soAceitaDpTi(usuario));
    if (!bloqueado || (await this.quemEhEquipeDpTi(quem))) return;
    throw new AppError(`${bloqueado.name} só recebe mensagens do DP e do TI.`, 403, 'SO_DP_TI');
  }

  /** Para a tela de ajustes: se a pessoa pode usar a opção e se ela está ligada. */
  async preferencias(quem: Pessoa): Promise<{ podeRestringir: boolean; mensagensSoDpTi: boolean }> {
    const usuario = await this.users.findById(quem.id);
    const podeRestringir = usuario !== null && this.ehEquipeDpTi(usuario);
    return { podeRestringir, mensagensSoDpTi: podeRestringir && usuario!.mensagensSoDpTi };
  }

  async definirMensagensSoDpTi(quem: Pessoa, ativo: boolean): Promise<void> {
    const usuario = await this.users.findById(quem.id);
    if (!usuario || !this.ehEquipeDpTi(usuario)) {
      throw new AppError('Esta opção é só para quem é do DP ou do TI.', 403, 'FORBIDDEN');
    }
    await this.users.updateMensagensSoDpTi(usuario.id, ativo);
    this.log.info(`${usuario.name} ${ativo ? 'passou a receber mensagens só do DP e do TI' : 'voltou a receber mensagens de todos'}`);
  }

  // ---------------------------------------------------------------- pessoas

  /** Com quem dá para conversar: colegas ativos e o pessoal do DP. */
  async contatos(quem: Pessoa): Promise<Participante[]> {
    const [funcionarios, dp, souEquipe] = await Promise.all([
      this.users.listByRole('EMPLOYEE'),
      this.users.listByRole('ADMIN'),
      this.quemEhEquipeDpTi(quem),
    ]);
    const lista: Participante[] = [];

    for (const usuario of funcionarios) {
      if (usuario.id === quem.id || usuario.status !== 'ACTIVE') continue;
      // Quem só aceita o DP/TI nem aparece para os demais
      if (!souEquipe && this.soAceitaDpTi(usuario)) continue;
      lista.push({
        id: usuario.id,
        nome: usuario.name,
        matricula: usuario.registration,
        setor: usuario.sector,
        ehDp: false,
        fotoMidiaId: usuario.fotoMidiaId,
        ativo: true,
        removido: false,
      });
    }
    for (const usuario of dp) {
      // chatContact = aparece como contato (contas de serviço ficam de fora)
      if (usuario.id === quem.id || usuario.status !== 'ACTIVE' || !usuario.chatContact) continue;
      if (!souEquipe && this.soAceitaDpTi(usuario)) continue;
      lista.push({
        id: usuario.id,
        nome: usuario.name,
        matricula: null,
        setor: null,
        ehDp: true,
        fotoMidiaId: usuario.fotoMidiaId,
        ativo: true,
        removido: false,
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
        removido: true,
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
      removido: false,
    };
  }

  // ---------------------------------------------------------------- lista de conversas

  async listar(quem: Pessoa): Promise<ConversaResumo[]> {
    const conversas = await this.conversas.listDoUsuario(quem.id, 100);
    const resumos = await this.montarResumos(conversas, quem.id);
    // Conta apagada não tem conversa: a direta com ela some da lista (o
    // histórico continua no banco e o TI ainda enxerga)
    return resumos.filter(
      (resumo) => resumo.tipo === 'GRUPO' || resumo.participantes.some((p) => p.id !== quem.id && !p.removido),
    );
  }

  /**
   * Tipo da mídia das mensagens sem legenda (só essas precisam, para a prévia
   * mostrar "Mensagem de voz" em vez de "arquivo"). midiaId -> tipo
   */
  private async tiposDasMidias(mensagens: (MensagemConversa | null | undefined)[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        mensagens
          .filter((m): m is MensagemConversa => !!m && m.tipo === 'MIDIA' && !m.conteudo && m.midiaId !== null && !m.apagadaEm)
          .map((m) => m.midiaId as string),
      ),
    ];
    const tipos = new Map<string, string>();
    for (const midia of await Promise.all(ids.map((id) => this.midias.findById(id)))) {
      if (midia) tipos.set(midia.id, midia.tipo);
    }
    return tipos;
  }

  /** Monta os resumos reaproveitando uma busca por pessoa entre as conversas. */
  private async montarResumos(conversas: Conversa[], meuId: string): Promise<ConversaResumo[]> {
    const ids = conversas.map((c) => c.id);
    const [membros, ultimas, naoLidas] = await Promise.all([
      this.conversas.membrosDeVarias(ids),
      this.conversas.ultimaMensagemDeVarias(ids),
      this.conversas.naoLidasDeVarias(ids, meuId),
    ]);
    const tiposDasUltimas = await this.tiposDasMidias([...ultimas.values()]);

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
        // Conta apagada não entra na lista de participantes do grupo
        if (!pessoa.removido || conversa.tipo === 'DIRETA') participantes.push(pessoa);
      }
      const ultima = ultimas.get(conversa.id) ?? null;
      // Leitura mais atrasada entre os outros: se alguém nunca abriu, fica null
      const leiturasDosOutros = ativos.filter((m) => m.userId !== meuId).map((m) => m.ultimaLeitura);
      const lidaAte =
        leiturasDosOutros.length > 0 && leiturasDosOutros.every((quando): quando is string => quando !== null)
          ? leiturasDosOutros.reduce((menor, quando) => (quando < menor ? quando : menor))
          : null;

      resumos.push({
        ...conversa,
        participantes,
        lidaAte,
        titulo: tituloPara(conversa, participantes, meuId),
        ultimaMensagem: ultima
          ? {
              conteudo: resumoDaMensagem(ultima, ultima.midiaId ? tiposDasUltimas.get(ultima.midiaId) : null),
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
    await this.exigirQuePodeEscrever(quem, [outro]);

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
    const escolhidos: User[] = [];
    for (const id of outros) {
      const usuario = await this.users.findById(id);
      if (!usuario || usuario.status !== 'ACTIVE') {
        throw new AppError('Uma das pessoas escolhidas não existe mais.', 400, 'PESSOA_INVALIDA');
      }
      escolhidos.push(usuario);
    }
    await this.exigirQuePodeEscrever(quem, escolhidos);

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
        encaminhada: false,
        respondeA: null,
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

  async mensagens(quem: Pessoa, conversaId: string, antesDoId?: number): Promise<MensagemComMidia[]> {
    await this.exigirMembro(conversaId, quem);
    const mensagens = await this.conversas.listMensagens(conversaId, LIMITES_CONVERSA.paginaMensagens, antesDoId);
    return this.comMidias(mensagens, quem.id);
  }

  /**
   * Junta os dados do arquivo a cada mensagem: a tela precisa do nome e do
   * tipo para decidir entre mostrar a imagem, tocar o vídeo ou oferecer o
   * download.
   */
  private async comMidias(mensagens: MensagemConversa[], meuId: string | null): Promise<MensagemComMidia[]> {
    const idsDeMidia = [...new Set(mensagens.map((m) => m.midiaId).filter((id): id is string => id !== null))];
    const idsCitados = [...new Set(mensagens.map((m) => m.respondeA).filter((id): id is number => id !== null))];

    const [encontradas, citadas] = await Promise.all([
      Promise.all(idsDeMidia.map((id) => this.midias.findById(id))),
      this.conversas.findMensagens(idsCitados),
    ]);

    const porId = new Map<string, MidiaPublica>();
    for (const midia of encontradas) if (midia) porId.set(midia.id, midiaPublica(midia));
    const tiposCitados = await this.tiposDasMidias([...citadas.values()]);
    const reacoes = await this.reacoes.resumos(
      'MENSAGEM',
      mensagens.map((m) => String(m.id)),
      meuId,
    );

    return mensagens.map((m) => {
      const citada = m.respondeA === null ? null : citadas.get(m.respondeA);
      return {
        ...m,
        reacoes: m.apagadaEm ? [] : (reacoes.get(String(m.id)) ?? []),
        midia: m.midiaId ? (porId.get(m.midiaId) ?? null) : null,
        respondida: citada
          ? {
              id: citada.id,
              autorNome: citada.autorNome,
              resumo: citada.apagadaEm
                ? 'mensagem apagada'
                : resumoDaMensagem(citada, citada.midiaId ? tiposCitados.get(citada.midiaId) : null),
              apagada: citada.apagadaEm !== null,
            }
          : null,
      };
    });
  }

  /**
   * Procura uma mensagem dentro da conversa. Devolve as mais recentes que
   * combinam, para a tela listar e pular até ela.
   */
  async buscar(quem: Pessoa, conversaId: string, termo: string): Promise<MensagemComMidia[]> {
    await this.exigirMembro(conversaId, quem);
    const procurado = termo.trim();
    if (procurado.length < 2) throw new AppError('Escreva pelo menos 2 letras para procurar.', 400, 'TERMO_CURTO');
    return this.comMidias(await this.conversas.buscarMensagens(conversaId, procurado, LIMITES_CONVERSA.buscaMaxima), quem.id);
  }

  async enviar(
    quem: Pessoa,
    conversaId: string,
    conteudo: string,
    midiaId: string | null,
    /** true quando a mensagem está sendo repassada de outra conversa */
    encaminhada = false,
    /** Id da mensagem que esta responde (tem de ser da mesma conversa) */
    respondeA: number | null = null,
  ): Promise<MensagemComMidia> {
    const { conversa } = await this.exigirMembro(conversaId, quem);
    // Em grupo vale quem já está lá; na conversa direta, a outra pessoa pode ter fechado
    if (conversa.tipo === 'DIRETA') {
      const outroId = (await this.conversas.membros(conversaId, false)).find((m) => m.userId !== quem.id)?.userId;
      const outro = outroId ? await this.users.findById(outroId) : null;
      if (outro) await this.exigirQuePodeEscrever(quem, [outro]);
    }
    const texto = conteudo.trim();
    if (!texto && !midiaId) throw new AppError('Escreva uma mensagem ou anexe um arquivo.', 400, 'MENSAGEM_VAZIA');
    if (texto.length > LIMITES_CONVERSA.maxConteudo) {
      throw new AppError(`A mensagem passa de ${LIMITES_CONVERSA.maxConteudo} caracteres.`, 400, 'MENSAGEM_LONGA');
    }
    let midia: MidiaPublica | null = null;
    if (midiaId) {
      const encontrada = await this.midias.findById(midiaId);
      if (!encontrada) throw new AppError('O arquivo anexado não existe mais.', 400, 'MIDIA_INEXISTENTE');
      midia = midiaPublica(encontrada);
    }

    let citacao: Citacao | null = null;
    if (respondeA !== null) {
      const citada = await this.conversas.findMensagem(respondeA);
      // Responder mensagem de outra conversa vazaria conteúdo entre conversas
      if (!citada || citada.conversaId !== conversaId) {
        throw new AppError('A mensagem respondida não é desta conversa.', 400, 'CITACAO_INVALIDA');
      }
      citacao = {
        id: citada.id,
        autorNome: citada.autorNome,
        resumo: citada.apagadaEm
          ? 'mensagem apagada'
          : resumoDaMensagem(citada, citada.midiaId ? (await this.tiposDasMidias([citada])).get(citada.midiaId) : null),
        apagada: citada.apagadaEm !== null,
      };
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
        encaminhada,
        respondeA,
      },
      agora,
    );

    await this.avisarParticipantes(conversaId, this.avisoDaMensagem(conversa, mensagem));
    // Quem escreve já leu a própria mensagem
    await this.conversas.marcarLeitura(conversaId, quem.id, agora);
    await this.respostaAutomatica(conversa, quem).catch((err) =>
      this.log.error({ err }, 'Falha na resposta automática do DP'),
    );
    return { ...mensagem, midia, respondida: citacao, reacoes: [] };
  }

  /**
   * Reage a uma mensagem (emoji null = tira a reação). Só quem participa da
   * conversa; cada pessoa tem uma reação por mensagem. Devolve como ficou.
   */
  async reagir(quem: Pessoa, mensagemId: number, emoji: string | null): Promise<ReacaoResumo[]> {
    const mensagem = await this.conversas.findMensagem(mensagemId);
    if (!mensagem || mensagem.apagadaEm) throw new NotFoundError('Mensagem não encontrada');
    await this.exigirMembro(mensagem.conversaId, quem);
    if (mensagem.tipo === 'SISTEMA') throw new AppError('Não dá para reagir a esse aviso.', 400, 'REACAO_INVALIDA');

    const alvo = String(mensagemId);
    if (emoji === null) await this.reacoes.remover('MENSAGEM', alvo, quem.id);
    else {
      if (!emojiValido(emoji)) throw new AppError('Reação não disponível.', 400, 'REACAO_INVALIDA');
      await this.reacoes.definir('MENSAGEM', alvo, quem.id, quem.nome, emoji, new Date().toISOString());
    }
    // Os outros participantes veem na hora (sem alerta: não é mensagem nova)
    await this.avisarParticipantes(mensagem.conversaId);
    return (await this.reacoes.resumos('MENSAGEM', [alvo], quem.id)).get(alvo) ?? [];
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

    // O DP pode ser a conta da Central ou o funcionário do setor do DP/TI;
    // entre duas pessoas da equipe não há resposta automática
    const dp = await this.users.findById(outroId);
    if (!dp || !this.ehEquipeDpTi(dp) || dp.status !== 'ACTIVE') return;
    if (await this.quemEhEquipeDpTi(autor)) return;

    const regra = await this.autoReplies.ruleFor(dp.id, autor.setor);
    if (!regra) return;

    const ultimas = await this.conversas.listMensagens(conversa.id, 20);
    const ultimaDoDp = [...ultimas].reverse().find((m) => m.autorId === dp.id);
    if (ultimaDoDp && Date.now() - Date.parse(ultimaDoDp.createdAt) < ESPERA_RESPOSTA_AUTOMATICA_MIN * 60_000) return;

    const conteudo = renderAutoReply(regra.content, { employeeName: autor.nome, sector: autor.setor, dpName: dp.name })
      .trim()
      .slice(0, LIMITES_CONVERSA.maxConteudo);
    if (!conteudo) return;

    const resposta = await this.conversas.addMensagem(
      {
        conversaId: conversa.id,
        autorId: dp.id,
        autorNome: dp.name,
        tipo: 'TEXTO',
        conteudo,
        midiaId: null,
        automatica: true,
        encaminhada: false,
        respondeA: null,
      },
      new Date().toISOString(),
    );
    await this.avisarParticipantes(conversa.id, this.avisoDaMensagem(conversa, resposta));
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
    await this.reacoes.apagarDoAlvo('MENSAGEM', String(mensagemId));
    await this.avisarParticipantes(mensagem.conversaId);
  }

  private async avisarParticipantes(conversaId: string, aviso?: AvisoDeMensagem): Promise<void> {
    const membros = await this.conversas.membros(conversaId, false);
    this.realtime.conversaAtualizada(
      membros.map((m) => m.userId),
      conversaId,
      aviso,
    );
  }

  /** Resumo que vai no aviso, para o aplicativo montar o alerta na tela. */
  private avisoDaMensagem(conversa: Conversa, mensagem: MensagemConversa): AvisoDeMensagem {
    return {
      mensagemId: mensagem.id,
      autorId: mensagem.autorId,
      autorNome: mensagem.autorNome,
      resumo: mensagem.tipo === 'MIDIA' ? mensagem.conteudo || 'enviou um arquivo' : mensagem.conteudo,
      createdAt: mensagem.createdAt,
      grupo: conversa.tipo === 'GRUPO' ? (conversa.nome ?? 'Grupo') : null,
    };
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
    await this.exigirQuePodeEscrever(quem, [novo]);

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

  async lerComoTi(quem: Pessoa, conversaId: string, antesDoId?: number): Promise<MensagemComMidia[]> {
    this.exigirTi(quem);
    const conversa = await this.conversas.findById(conversaId);
    if (!conversa) throw new NotFoundError('Conversa não encontrada');

    await this.conversas.registrarAcessoTi(conversaId, quem.id, quem.nome, new Date().toISOString());
    this.log.warn(`Auditoria: ${quem.nome} (TI) abriu a conversa ${conversaId}`);
    return this.comMidias(await this.conversas.listMensagens(conversaId, LIMITES_CONVERSA.paginaMensagens, antesDoId), null);
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
