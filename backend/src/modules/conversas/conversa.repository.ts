import type { Conversa, Membro, MensagemConversa, NovaMensagemConversa, PapelMembro } from './conversa.types';

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
  ultimaMensagemDeVarias(conversaIds: string[]): Promise<Map<string, MensagemConversa>>;
  naoLidasDeVarias(conversaIds: string[], userId: string): Promise<Map<string, number>>;
  apagarMensagem(id: number, agora: string): Promise<boolean>;
  findMensagem(id: number): Promise<MensagemConversa | null>;

  /** Auditoria: registra que o TI abriu uma conversa */
  registrarAcessoTi(conversaId: string, usuarioId: string, usuarioNome: string, agora: string): Promise<void>;
  listarAcessosTi(limite: number): Promise<{ conversaId: string; usuarioNome: string; createdAt: string }[]>;
}
