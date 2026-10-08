import type {
  Conversa,
  Membro,
  MensagemAuditoria,
  MensagemConversa,
  NovaMensagemConversa,
  PapelMembro,
} from './conversa.types';

export interface ConversaRepository {
  create(conversa: Conversa, membros: { userId: string; papel: PapelMembro }[]): Promise<Conversa>;
  findById(id: string): Promise<Conversa | null>;
  /** Conversa direta já existente entre duas pessoas (não cria duas) */
  findDireta(userA: string, userB: string): Promise<Conversa | null>;
  /** Conversas de uma pessoa, da mais movimentada para a mais antiga */
  listDoUsuario(userId: string, limite: number): Promise<Conversa[]>;
  /** Todas as conversas (só o TI, para auditoria e limpeza) */
  listTodas(limite: number): Promise<Conversa[]>;
  renomear(id: string, nome: string, agora: string): Promise<void>;
  tocar(id: string, agora: string): Promise<void>;
  delete(id: string): Promise<boolean>;

  membros(conversaId: string, incluirQuemSaiu: boolean): Promise<Membro[]>;
  membrosDeVarias(conversaIds: string[]): Promise<Map<string, Membro[]>>;
  membro(conversaId: string, userId: string): Promise<Membro | null>;
  adicionarMembro(conversaId: string, userId: string, papel: PapelMembro, agora: string): Promise<void>;
  removerMembro(conversaId: string, userId: string, agora: string): Promise<void>;
  marcarLeitura(conversaId: string, userId: string, agora: string): Promise<void>;

  addMensagem(dados: NovaMensagemConversa, agora: string): Promise<MensagemConversa>;
  /** Página de mensagens; antesDoId permite rolar para cima */
  listMensagens(conversaId: string, limite: number, antesDoId?: number): Promise<MensagemConversa[]>;
  /** Procura no texto das mensagens da conversa (as mais novas primeiro) */
  buscarMensagens(conversaId: string, termo: string, limite: number): Promise<MensagemConversa[]>;
  ultimaMensagemDeVarias(conversaIds: string[]): Promise<Map<string, MensagemConversa>>;
  naoLidasDeVarias(conversaIds: string[], userId: string): Promise<Map<string, number>>;
  /**
   * Apagar esconde a mensagem de quem participa e, no mesmo instante, guarda o
   * texto em conteudo_apagado para a auditoria do TI.
   */
  apagarMensagem(id: number, agora: string, porId: string, porNome: string): Promise<boolean>;
  findMensagem(id: number): Promise<MensagemConversa | null>;
  /** Busca várias de uma vez (usado para montar a citação da resposta) */
  findMensagens(ids: number[]): Promise<Map<number, MensagemConversa>>;

  /** Quantas mensagens cada conversa tem (números do painel do TI) */
  contarMensagensPorConversa(conversaIds: string[]): Promise<Map<string, number>>;
  /** Limpeza do TI: apaga mensagens das conversas indicadas, opcionalmente só as antigas */
  apagarMensagens(conversaIds: string[], antesDe: string | null): Promise<number>;
  /** Apaga as conversas inteiras (membros e mensagens vão junto). Devolve quantas mensagens saíram */
  apagarConversas(conversaIds: string[]): Promise<number>;
  /** Tira da lista as conversas diretas que ficaram sem nenhuma mensagem */
  apagarDiretasVazias(conversaIds: string[]): Promise<void>;

  /** Auditoria: registra que o TI abriu uma conversa */
  registrarAcessoTi(conversaId: string, usuarioId: string, usuarioNome: string, agora: string): Promise<void>;
  listarAcessosTi(limite: number): Promise<{ conversaId: string; usuarioNome: string; createdAt: string }[]>;

  /**
   * Auditoria do TI: a conversa inteira, da mais antiga para a mais nova, com o
   * texto das apagadas. Sem paginação — serve para gerar o arquivo da conversa.
   */
  listMensagensAuditoria(conversaId: string, limite: number): Promise<MensagemAuditoria[]>;
  /** Auditoria do TI: as mensagens apagadas, as mais recentes primeiro */
  listApagadas(limite: number): Promise<MensagemAuditoria[]>;
}
