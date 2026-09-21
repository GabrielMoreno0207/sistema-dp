/**
 * Tipos compartilhados entre o processo main, o preload e a interface (renderer).
 */

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'not-configured'
  /** Registro recusado pelo servidor (ex.: PC bloqueado) */
  | 'unauthorized';

export interface ConnectionState {
  status: ConnectionStatus;
  serverUrl: string | null;
  /** Próxima tentativa de reconexão (ms epoch), quando houver */
  nextRetryAt: number | null;
  lastError: string | null;
}

export interface ComputerInfo {
  computerId: string;
  hostname: string;
  appVersion: string;
  platform: string;
}

export const MESSAGE_TYPES = ['COMUNICADO', 'AVISO', 'INFORMATIVO', 'URGENTE'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Arquivo ou imagem que o DP mandou junto com o comunicado */
export interface DpAttachment {
  id: string;
  /** Nome original do arquivo */
  name: string;
  mimeType: string;
  /** Tamanho em bytes */
  size: number;
  /** IMAGE aparece como miniatura na mensagem; FILE, como arquivo para abrir ou salvar */
  kind: 'IMAGE' | 'FILE';
}

/** Mensagem do ponto de vista deste computador */
export interface DpMessage {
  id: string;
  title: string;
  content: string;
  type: MessageType;
  target: string;
  targetId: string | null;
  sender: string;
  createdAt: string;
  read: boolean;
  readAt: string | null;
  /** Anexos do comunicado (lista vazia quando não há) */
  attachments: DpAttachment[];
}

export interface MessagesState {
  messages: DpMessage[];
  unreadCount: number;
}

/** Funcionário identificado neste computador (login no app) */
export interface EmployeeProfile {
  id: string;
  name: string;
  registration: string;
  sector: string | null;
  shift: string | null;
  /** Senha inicial ou redefinida pelo DP: precisa trocar antes de usar o app */
  mustChangePassword: boolean;
}

export interface EmployeeState {
  employee: EmployeeProfile | null;
  /** Já perguntamos ao servidor quem está logado nesta execução (evita piscar a tela de login) */
  checked: boolean;
}

/** Mensagem do chat: a conversa é o par (funcionário logado, pessoa do DP) */
export interface ChatMessage {
  id: number;
  employeeId: string;
  /** Pessoa do DP desta conversa */
  dpUserId: string;
  senderType: 'DP' | 'EMPLOYEE';
  senderName: string;
  content: string;
  createdAt: string;
  /** Quando o outro lado leu (mensagem do DP: o funcionário; do funcionário: a pessoa do DP) */
  readAt: string | null;
  /** Enviada pela resposta automática da pessoa do DP */
  automatic: boolean;
}

/** Pessoa do DP na lista de contatos do chat */
export interface ChatContact {
  id: string;
  name: string;
  /** Mensagens desta pessoa ainda não lidas pelo funcionário */
  unreadCount: number;
  lastMessage: { content: string; senderType: 'DP' | 'EMPLOYEE'; createdAt: string } | null;
}

export interface ChatState {
  /** Pessoas do DP (conversa mais recente primeiro) */
  contacts: ChatContact[];
  /** Total de mensagens do DP não lidas (soma de todos os contatos) */
  unreadCount: number;
  /** Há funcionário logado (o chat é da pessoa, não do computador) */
  available: boolean;
  /** Conversa aberta na página Mensagens */
  openContactId: string | null;
  /** Mensagens da conversa aberta, em ordem cronológica */
  messages: ChatMessage[];
  loadingConversation: boolean;
}

export const CHAT_MESSAGE_MAX = 2000;

/** Imagem ou vídeo guardado no servidor */
export interface MidiaPublica {
  id: string;
  tipo: 'IMAGEM' | 'VIDEO';
  nome: string;
  mimeType: string;
  tamanho: number;
  /** Caminho no servidor; a tela usa dpmidia://<id> para exibir */
  url: string;
}

/** Recado que a Central do DP deixa fixado na tela inicial */
export interface MuralPost {
  id: string;
  titulo: string;
  texto: string;
  midia: MidiaPublica | null;
  ativo: boolean;
  criadoPor: string;
  createdAt: string;
  updatedAt: string;
}

/** Para onde um atalho leva (só telas do próprio aplicativo) */
export type DestinoAtalho = 'COMUNICADOS' | 'CHAT' | 'PERFIL' | 'CONFIGURACOES' | 'MURAL';

/** Azulejo que o colaborador monta na tela inicial */
export interface Atalho {
  id: string;
  userId: string;
  ordem: number;
  rotulo: string;
  icone: string;
  cor: string;
  destino: DestinoAtalho;
  createdAt: string;
}

export type DadosAtalho = Pick<Atalho, 'rotulo' | 'icone' | 'cor' | 'destino'>;

// ---- Chamados para o TI ----

export type CategoriaChamado = 'COMPUTADOR' | 'IMPRESSORA' | 'SISTEMA' | 'REDE' | 'ACESSO' | 'OUTRO';
export type PrioridadeChamado = 'BAIXA' | 'NORMAL' | 'ALTA';
export type StatusChamado = 'ABERTO' | 'EM_ANDAMENTO' | 'RESOLVIDO' | 'FECHADO';

export interface ChamadoMensagem {
  id: number;
  chamadoId: string;
  autorId: string;
  autorNome: string;
  autorTipo: 'SOLICITANTE' | 'TI';
  conteudo: string;
  createdAt: string;
  lidaEm: string | null;
}

export interface Chamado {
  id: string;
  numero: number;
  titulo: string;
  descricao: string;
  categoria: CategoriaChamado;
  prioridade: PrioridadeChamado;
  status: StatusChamado;
  solicitanteId: string;
  solicitanteNome: string;
  computadorId: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  createdAt: string;
  updatedAt: string;
  resolvidoEm: string | null;
}

export interface ChamadoResumo extends Chamado {
  mensagensNaoLidas: number;
  totalMensagens: number;
}

export interface ChamadoCompleto extends Chamado {
  mensagens: ChamadoMensagem[];
  midias: { id: string; tipo: 'IMAGEM' | 'VIDEO'; nome: string; url: string }[];
  naoLidas: number;
}

export interface NovoChamadoInput {
  titulo: string;
  descricao: string;
  categoria: CategoriaChamado;
  prioridade: PrioridadeChamado;
  midiaIds: string[];
}

/** Pessoa do DP/TI logada no aplicativo (além do funcionário do PC) */
export interface AdminUser {
  id: string;
  username: string;
  name: string;
  /** Conta do TI: fila de chamados e as funções administrativas extras */
  superAdmin: boolean;
  mustChangePassword: boolean;
}

export interface AppState {
  appVersion: string;
  computer: ComputerInfo;
  connection: ConnectionState;
  /** Comunicados do DP (COMUNICADO, AVISO, INFORMATIVO, URGENTE) */
  messages: MessagesState;
  chat: ChatState;
  employee: EmployeeProfile | null;
  employeeChecked: boolean;
  /** Recado em exibição no mural (null = nenhum) */
  mural: MuralPost | null;
  /** Atalhos do funcionário logado */
  atalhos: Atalho[];
  /** Foto de perfil do funcionário logado */
  foto: MidiaPublica | null;
  /** Conta do DP/TI logada neste aplicativo (null = ninguém) */
  admin: AdminUser | null;
}

/** Configurações editáveis na tela Configurações */
export interface DesktopSettings {
  serverUrl: string | null;
  autoStart: boolean;
}

export interface SettingsView extends DesktopSettings {
  /** Início automático só é aplicado no aplicativo instalado */
  autoStartAvailable: boolean;
}

export type SaveSettingsInput = DesktopSettings;

export interface OperationResult {
  ok: boolean;
  message: string;
}

/** Estado do popup de alerta */
export interface PopupState {
  current: DpMessage | null;
  /** Posição da mensagem atual no lote ("2 de 3") */
  position: number;
  total: number;
}

/** API da janela principal, exposta pelo preload em window.dp */
export interface DesktopApi {
  getState(): Promise<AppState>;
  markAsRead(messageId: string): Promise<void>;
  onConnectionChange(listener: (state: ConnectionState) => void): () => void;
  onMessagesChange(listener: (state: MessagesState) => void): () => void;
  /** Pedido para abrir uma mensagem na janela principal (ex.: "Visualizar" no popup) */
  onOpenMessage(listener: (messageId: string) => void): () => void;

  // Anexos dos comunicados (o download é sempre feito pelo processo main)
  /** Abre o anexo no programa padrão do Windows (baixa para uma pasta temporária) */
  openAttachment(attachmentId: string): Promise<OperationResult>;
  /** Pergunta onde salvar e grava o arquivo */
  saveAttachment(attachmentId: string): Promise<OperationResult>;
  /** Imagem do anexo como data URL, para mostrar dentro da mensagem (null se falhar) */
  getAttachmentImage(attachmentId: string): Promise<string | null>;

  // Configurações
  getSettings(): Promise<SettingsView>;
  saveSettings(settings: SaveSettingsInput): Promise<OperationResult>;
  testServer(serverUrl: string): Promise<OperationResult>;

  // Login do funcionário
  employeeLogin(registration: string, password: string): Promise<OperationResult>;
  employeeLogout(): Promise<OperationResult>;
  changePassword(currentPassword: string, newPassword: string): Promise<OperationResult>;
  onEmployeeChange(listener: (state: EmployeeState) => void): () => void;

  // Chat com as pessoas do DP (página Mensagens): uma conversa por pessoa
  /** Abre (e carrega) a conversa com uma pessoa do DP; null fecha */
  chatOpen(dpUserId: string | null): Promise<OperationResult>;
  chatSend(dpUserId: string, content: string): Promise<OperationResult>;
  chatMarkRead(dpUserId: string): Promise<void>;
  onChatChange(listener: (state: ChatState) => void): () => void;

  // ---- Tela inicial: atalhos, mural e foto de perfil ----
  criarAtalho(dados: DadosAtalho): Promise<OperationResult>;
  atualizarAtalho(id: string, dados: DadosAtalho): Promise<OperationResult>;
  removerAtalho(id: string): Promise<OperationResult>;
  reordenarAtalhos(ids: string[]): Promise<OperationResult>;
  onAtalhosChange(listener: (atalhos: Atalho[]) => void): () => void;
  onMuralChange(listener: (mural: MuralPost | null) => void): () => void;
  /** Abre o seletor de arquivo, envia e passa a ser a foto da pessoa */
  enviarFoto(): Promise<OperationResult>;
  removerFoto(): Promise<OperationResult>;
  onFotoChange(listener: (foto: MidiaPublica | null) => void): () => void;

  // ---- Chamados do funcionário ----
  listarChamados(): Promise<{ ok: boolean; chamados: ChamadoResumo[]; message: string }>;
  abrirChamado(dados: NovoChamadoInput): Promise<OperationResult>;
  detalheChamado(id: string): Promise<{ ok: boolean; chamado: ChamadoCompleto | null; message: string }>;
  responderChamado(id: string, conteudo: string): Promise<OperationResult>;
  fecharChamado(id: string): Promise<OperationResult>;
  marcarChamadoLido(id: string): Promise<OperationResult>;
  /** Escolhe uma imagem no disco e envia; devolve o id da mídia */
  enviarImagemChamado(): Promise<{ ok: boolean; midiaId: string | null; nome: string; message: string }>;
  onChamadosChange(listener: () => void): () => void;

  // ---- Conta do DP/TI ----
  adminLogin(username: string, password: string): Promise<OperationResult>;
  adminLogout(): Promise<OperationResult>;
  onAdminChange(listener: (admin: AdminUser | null) => void): () => void;
  adminFila(incluirEncerrados: boolean): Promise<{ ok: boolean; chamados: ChamadoResumo[]; message: string }>;
  adminChamadoDetalhe(id: string): Promise<{ ok: boolean; chamado: ChamadoCompleto | null; message: string }>;
  adminResponderChamado(id: string, conteudo: string): Promise<OperationResult>;
  adminMudarStatus(id: string, status: StatusChamado): Promise<OperationResult>;
  adminListarMural(): Promise<{ ok: boolean; posts: MuralPost[]; message: string }>;
  adminSalvarMural(dados: {
    id: string | null;
    titulo: string;
    texto: string;
    midiaId: string | null;
    ativo: boolean;
  }): Promise<OperationResult>;
  adminRemoverMural(id: string): Promise<OperationResult>;
  /** Escolhe imagem ou vídeo no disco e envia para o mural */
  adminEnviarMidia(): Promise<{ ok: boolean; midia: MidiaPublica | null; message: string }>;
}

/** API do popup de alerta (preload próprio, só o necessário), em window.dpPopup */
export interface PopupApi {
  getPopupState(): Promise<PopupState>;
  onPopupChange(listener: (state: PopupState) => void): () => void;
  popupView(messageId: string): Promise<void>;
  popupDismiss(messageId: string): Promise<void>;
}

export const IpcChannels = {
  GetState: 'app:get-state',
  MarkAsRead: 'messages:mark-read',
  ConnectionChanged: 'connection:changed',
  MessagesChanged: 'messages:changed',
  OpenMessage: 'ui:open-message',
  AttachmentOpen: 'attachment:open',
  AttachmentSave: 'attachment:save',
  AttachmentImage: 'attachment:image',
  GetSettings: 'settings:get',
  SaveSettings: 'settings:save',
  TestServer: 'settings:test-server',
  EmployeeLogin: 'employee:login',
  EmployeeLogout: 'employee:logout',
  EmployeeChangePassword: 'employee:change-password',
  EmployeeChanged: 'employee:changed',
  ChatOpen: 'chat:open',
  ChatSend: 'chat:send',
  ChatMarkRead: 'chat:mark-read',
  ChatChanged: 'chat:changed',
  MuralChanged: 'mural:changed',
  AtalhosChanged: 'atalhos:changed',
  AtalhoCreate: 'atalhos:create',
  AtalhoUpdate: 'atalhos:update',
  AtalhoDelete: 'atalhos:delete',
  AtalhoReorder: 'atalhos:reorder',
  FotoUpload: 'perfil:foto-upload',
  FotoRemove: 'perfil:foto-remove',
  FotoChanged: 'perfil:foto-changed',

  // Chamados do funcionário
  ChamadosList: 'chamados:list',
  ChamadoAbrir: 'chamados:abrir',
  ChamadoDetalhe: 'chamados:detalhe',
  ChamadoResponder: 'chamados:responder',
  ChamadoFechar: 'chamados:fechar',
  ChamadoLidas: 'chamados:lidas',
  ChamadosChanged: 'chamados:changed',
  ChamadoEnviarImagem: 'chamados:enviar-imagem',

  // Conta do DP/TI dentro do aplicativo
  AdminLogin: 'admin:login',
  AdminLogout: 'admin:logout',
  AdminChanged: 'admin:changed',
  AdminFila: 'admin:fila',
  AdminChamadoDetalhe: 'admin:chamado-detalhe',
  AdminChamadoResponder: 'admin:chamado-responder',
  AdminChamadoStatus: 'admin:chamado-status',
  AdminMuralList: 'admin:mural-list',
  AdminMuralSalvar: 'admin:mural-salvar',
  AdminMuralRemover: 'admin:mural-remover',
  AdminMuralMidia: 'admin:mural-midia',
} as const;
// Canais do popup: ver popup-channels.ts
