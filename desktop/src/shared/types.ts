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
  /** O DP pede "li e estou ciente" neste comunicado */
  exigeCiencia: boolean;
  /** Quando esta pessoa confirmou a ciência (null = ainda não confirmou) */
  cienteEm: string | null;
  /** Anexos do comunicado (lista vazia quando não há) */
  attachments: DpAttachment[];
}

export interface MessagesState {
  messages: DpMessage[];
  unreadCount: number;
}

/**
 * Acesso administrativo que vem do setor: quem é do Departamento Pessoal ou do
 * TI usa as telas de administração com o próprio login, sem conta à parte.
 */
export type AcessoAdmin = 'NENHUM' | 'DP' | 'TI';

/** Funcionário identificado neste computador (login no app) */
export interface EmployeeProfile {
  id: string;
  name: string;
  registration: string;
  sector: string | null;
  shift: string | null;
  /** Senha inicial ou redefinida pelo DP: precisa trocar antes de usar o app */
  mustChangePassword: boolean;
  /** 'DP' abre as telas do Departamento Pessoal; 'TI' abre também as do TI */
  acessoAdmin: AcessoAdmin;
}

export interface EmployeeState {
  employee: EmployeeProfile | null;
  /** Já perguntamos ao servidor quem está logado nesta execução (evita piscar a tela de login) */
  checked: boolean;
}

/** Imagem ou vídeo guardado no servidor */
export interface MidiaPublica {
  id: string;
  tipo: 'IMAGEM' | 'VIDEO' | 'ARQUIVO' | 'AUDIO';
  nome: string;
  mimeType: string;
  tamanho: number;
  /** Caminho no servidor; a tela usa dpmidia://<id> para exibir */
  url: string;
  /** Mensagem de voz: duração da gravação (servidores antigos não mandam) */
  duracaoMs?: number | null;
}

/** Recado que a Central do DP deixa fixado na tela inicial */
/** Reações de uma mensagem ou recado: uma linha por emoji usado */
export interface ReacaoResumo {
  emoji: string;
  total: number;
  /** Quem está usando o aplicativo reagiu com este emoji */
  minha: boolean;
  nomes: string[];
}

export interface MuralPost {
  id: string;
  titulo: string;
  texto: string;
  midia: MidiaPublica | null;
  /** Servidores antigos não mandam */
  reacoes?: ReacaoResumo[];
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
  midias: { id: string; tipo: 'IMAGEM' | 'VIDEO' | 'ARQUIVO'; nome: string; url: string }[];
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

// ---- Chat: conversas diretas e grupos ----

export type TipoConversa = 'DIRETA' | 'GRUPO';
export type PapelMembro = 'ADMIN' | 'MEMBRO';
export type TipoMensagemConversa = 'TEXTO' | 'MIDIA' | 'SISTEMA';

/** Pessoa que participa de uma conversa (ou está na lista de contatos) */
export interface Participante {
  id: string;
  nome: string;
  matricula: string | null;
  setor: string | null;
  /** true = pessoa do Departamento Pessoal */
  ehDp: boolean;
  fotoMidiaId: string | null;
  /** Conta desativada pelo DP (a pessoa pode voltar) */
  ativo: boolean;
  /** A conta foi apagada: a conversa direta com ela não aparece na lista */
  removido: boolean;
}

export interface MensagemConversa {
  id: number;
  conversaId: string;
  autorId: string;
  autorNome: string;
  tipo: TipoMensagemConversa;
  conteudo: string;
  midiaId: string | null;
  /** Dados do arquivo anexado (o servidor já manda junto) */
  midia: MidiaPublica | null;
  automatica: boolean;
  /** Veio de outra conversa */
  encaminhada: boolean;
  /** Id da mensagem que esta responde (null = mensagem solta) */
  respondeA: number | null;
  /** Pedaço da mensagem citada, para desenhar o bloco da resposta */
  respondida: CitacaoConversa | null;
  /** Reações da mensagem (servidores antigos não mandam) */
  reacoes?: ReacaoResumo[];
  createdAt: string;
  apagadaEm: string | null;
}

/** Resumo da mensagem citada por uma resposta */
export interface CitacaoConversa {
  id: number;
  autorNome: string;
  resumo: string;
  apagada: boolean;
}

/** Evento do calendário da tela inicial */
export interface EventoAgenda {
  id: string;
  titulo: string;
  descricao: string;
  /** Data do calendário, AAAA-MM-DD */
  dia: string;
  /** 'HH:MM', ou null quando é o dia inteiro */
  hora: string | null;
  /** PESSOAL: anotação de quem criou; GERAL: publicado pelo DP para todos */
  escopo: 'PESSOAL' | 'GERAL';
  cor: string;
  criadoPor: string;
  criadoPorNome: string;
  createdAt: string;
}

/** Leitura de uma conversa pelo TI (auditoria) */
export interface AcessoTi {
  conversaId: string;
  usuarioNome: string;
  createdAt: string;
}

export interface ConversaResumo {
  id: string;
  tipo: TipoConversa;
  nome: string | null;
  criadoPor: string;
  createdAt: string;
  updatedAt: string;
  participantes: Participante[];
  /** Nome do grupo, ou da outra pessoa na conversa direta */
  titulo: string;
  ultimaMensagem: { conteudo: string; autorNome: string; tipo: TipoMensagemConversa; createdAt: string } | null;
  /**
   * Até quando todo mundo já leu: serve para marcar "lida" nas mensagens que
   * esta pessoa enviou. null = alguém ainda não abriu a conversa.
   */
  lidaAte: string | null;
  naoLidas: number;
  meuPapel: PapelMembro;
}

/** Com qual identidade o aplicativo está conversando neste computador */
export interface IdentidadeChat {
  id: string;
  nome: string;
  /** true = entrou com a conta do DP/TI; false = funcionário do PC */
  ehDp: boolean;
  ehTi: boolean;
}

export interface AppState {
  appVersion: string;
  computer: ComputerInfo;
  connection: ConnectionState;
  /** Comunicados do DP (COMUNICADO, AVISO, INFORMATIVO, URGENTE) */
  messages: MessagesState;
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
/** Aviso de mensagem nova no chat, para o alerta na tela. */
export interface AvisoMensagem {
  /** Chave do alerta: conversa + número da mensagem */
  id: string;
  conversaId: string;
  autorNome: string;
  /** Nome do grupo, ou null em conversa direta */
  grupo: string | null;
  resumo: string;
  createdAt: string;
}

/**
 * O que está no alerta: um comunicado do DP ou uma mensagem do chat.
 * Os dois usam a mesma janelinha do canto da tela.
 */
export type ItemAlerta =
  | { tipo: 'COMUNICADO'; comunicado: DpMessage }
  | { tipo: 'MENSAGEM'; mensagem: AvisoMensagem };

export interface PopupState {
  current: ItemAlerta | null;
  /** Posição do alerta atual no lote ("2 de 3") */
  position: number;
  total: number;
}

/**
 * Instalação da versão nova em andamento: o aplicativo vai fechar e abrir
 * sozinho. A tela mostra o aviso para ninguém achar que o programa travou.
 */
export interface AtualizacaoEmAndamento {
  versao: string;
  /** Obrigatória instala na hora, mesmo com alguém usando o computador */
  obrigatoria: boolean;
}

/** API da janela principal, exposta pelo preload em window.dp */
export interface DesktopApi {
  getState(): Promise<AppState>;
  markAsRead(messageId: string): Promise<void>;
  /** "Li e estou ciente" de um comunicado que pede confirmação */
  confirmarCiencia(messageId: string): Promise<OperationResult>;
  onConnectionChange(listener: (state: ConnectionState) => void): () => void;
  onMessagesChange(listener: (state: MessagesState) => void): () => void;
  /** Pedido para abrir uma mensagem na janela principal (ex.: "Visualizar" no popup) */
  onOpenMessage(listener: (messageId: string) => void): () => void;
  /** Pedido para abrir uma conversa do chat (alerta de mensagem nova) */
  onOpenConversa(listener: (conversaId: string) => void): () => void;
  /** A tela avisa qual conversa está aberta: enquanto ela estiver à vista, não alerta */
  conversaEmFoco(conversaId: string | null): void;

  // ---- Janela (a barra de título é do próprio sistema) ----
  janelaMinimizar(): void;
  /** Maximiza ou volta ao tamanho anterior; devolve se ficou maximizada */
  janelaMaximizar(): Promise<boolean>;
  /** Esconde na bandeja: o sistema continua recebendo comunicados */
  janelaEsconder(): void;
  /** Fecha o sistema de vez; só com a senha certa */
  janelaFechar(senha: string): Promise<OperationResult>;
  janelaEstaMaximizada(): Promise<boolean>;
  /** O processo principal pede a senha (botão de fechar, bandeja, Alt+F4) */
  onPedirSenhaParaFechar(listener: () => void): () => void;
  /** O aplicativo vai fechar para instalar a versão nova (null tira o aviso) */
  onAtualizacaoInstalando(listener: (info: AtualizacaoEmAndamento | null) => void): () => void;

  /** Calendário da tela inicial (mesma credencial de quem está usando o aplicativo) */
  agendaApi<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; dados: T | null; message: string }>;

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


  // ---- Tela inicial: atalhos, mural e foto de perfil ----
  criarAtalho(dados: DadosAtalho): Promise<OperationResult>;
  atualizarAtalho(id: string, dados: DadosAtalho): Promise<OperationResult>;
  removerAtalho(id: string): Promise<OperationResult>;
  reordenarAtalhos(ids: string[]): Promise<OperationResult>;
  onAtalhosChange(listener: (atalhos: Atalho[]) => void): () => void;
  onMuralChange(listener: (mural: MuralPost | null) => void): () => void;
  /** Reage ao recado do mural (emoji null = tira a reação) */
  muralReagir(postId: string, emoji: string | null): Promise<OperationResult>;
  /** Abre o seletor de arquivo e devolve a imagem para a pessoa enquadrar (não envia ainda) */
  escolherFoto(): Promise<{ ok: boolean; dataUrl: string | null; message: string }>;
  /** A foto atual, para enquadrar de novo sem escolher outra */
  fotoAtual(): Promise<{ ok: boolean; dataUrl: string | null; message: string }>;
  /** Envia a foto já recortada (JPEG quadrado) e passa a ser a foto da pessoa */
  salvarFoto(jpeg: Uint8Array): Promise<OperationResult>;
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
  /** Assume o atendimento de um chamado que ainda está sem dono na fila */
  adminAceitarChamado(id: string): Promise<OperationResult>;
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
  /**
   * Chamada às rotas administrativas com a credencial do DP. O processo
   * principal confere a rota contra uma lista antes de enviar.
   */
  adminApi<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; dados: T | null; message: string }>;
  /** Escolhe arquivos no disco e anexa ao comunicado que está sendo escrito */
  adminAnexar(): Promise<{ ok: boolean; anexos: { id: string; name: string; size: number }[]; message: string }>;

  // ---- Conversas (chat entre funcionários, grupos e arquivos) ----
  /**
   * Chamada às rotas de conversa com a credencial certa: o token do PC quando
   * há funcionário logado, ou o da pessoa do DP/TI. A rota é conferida por uma
   * lista no processo principal.
   */
  conversasApi<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; dados: T | null; message: string }>;
  /** Quem está conversando neste computador (para saber de quem é cada mensagem) */
  conversasIdentidade(): Promise<IdentidadeChat | null>;
  /** Escolhe um arquivo no disco e envia; devolve a mídia para anexar à mensagem */
  conversasAnexar(): Promise<{ ok: boolean; midia: MidiaPublica | null; message: string }>;
  /** Arquivo arrastado para dentro da conversa: envia pelo caminho no disco */
  conversasSoltarArquivo(caminho: string): Promise<{ ok: boolean; midia: MidiaPublica | null; message: string }>;
  /** Imagem colada no campo (Ctrl+V): sobe como anexo, igual ao clipe */
  conversasColarImagem(dados: ArrayBuffer, mimeType: string): Promise<{ ok: boolean; midia: MidiaPublica | null; message: string }>;
  /** Copia a imagem de uma mensagem para a área de transferência do Windows (Ctrl+C) */
  conversasCopiarImagem(midiaId: string): Promise<OperationResult>;
  /** Mensagem de voz gravada na tela: sobe para o servidor como mídia de áudio */
  conversasEnviarAudio(
    dados: ArrayBuffer,
    mimeType: string,
    duracaoMs: number,
  ): Promise<{ ok: boolean; midia: MidiaPublica | null; message: string }>;
  /** Caminho no disco de um arquivo arrastado (o objeto File do navegador não traz) */
  caminhoDoArquivo(arquivo: File): string;
  /** Baixa o arquivo de uma mensagem e abre no programa padrão do Windows */
  conversasAbrirArquivo(midiaId: string, nome: string): Promise<OperationResult>;
  /** conversaId que mudou; "*" = o TI apagou conversas (a tela troca tudo pelo que está no servidor) */
  onConversasChange(listener: (conversaId: string) => void): () => void;
  /** As não lidas mudaram (a pessoa abriu uma conversa): só o contador */
  onConversasContador(listener: () => void): () => void;
  /** Abre um link (http/https) no navegador padrão do Windows */
  abrirLink(url: string): Promise<OperationResult>;
  /** Copia um texto para a área de transferência (usado no bloco de código) */
  copiarTexto(texto: string): Promise<OperationResult>;
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
  ConfirmarCiencia: 'messages:ciencia',
  ConnectionChanged: 'connection:changed',
  MessagesChanged: 'messages:changed',
  OpenMessage: 'ui:open-message',
  OpenConversa: 'ui:open-conversa',
  ConversaEmFoco: 'conversas:em-foco',
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
  MuralChanged: 'mural:changed',
  MuralReagir: 'mural:reagir',
  AtalhosChanged: 'atalhos:changed',
  AtalhoCreate: 'atalhos:create',
  AtalhoUpdate: 'atalhos:update',
  AtalhoDelete: 'atalhos:delete',
  AtalhoReorder: 'atalhos:reorder',
  FotoEscolher: 'perfil:foto-escolher',
  FotoAtual: 'perfil:foto-atual',
  FotoSalvar: 'perfil:foto-salvar',
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
  AdminChamadoAceitar: 'admin:chamado-aceitar',
  AdminMuralList: 'admin:mural-list',
  AdminMuralSalvar: 'admin:mural-salvar',
  AdminMuralRemover: 'admin:mural-remover',
  AdminMuralMidia: 'admin:mural-midia',
  /** Canal único das telas administrativas; a rota é conferida por uma lista */
  AdminApi: 'admin:api',
  AdminAnexo: 'admin:anexo',

  // Conversas do chat
  /** Canal único da tela de mensagens; a rota é conferida por uma lista */
  ConversasApi: 'conversas:api',
  ConversasIdentidade: 'conversas:identidade',
  ConversasAnexar: 'conversas:anexar',
  ConversasSoltarArquivo: 'conversas:soltar-arquivo',
  ConversasEnviarAudio: 'conversas:enviar-audio',
  ConversasColarImagem: 'conversas:colar-imagem',
  ConversasCopiarImagem: 'conversas:copiar-imagem',
  ConversasAbrirArquivo: 'conversas:abrir-arquivo',
  ConversasChanged: 'conversas:changed',
  ConversasContador: 'conversas:contador',
  AbrirLink: 'ui:abrir-link',
  CopiarTexto: 'ui:copiar-texto',

  // Janela: a barra de título é do próprio sistema
  JanelaMinimizar: 'janela:minimizar',
  JanelaMaximizar: 'janela:maximizar',
  JanelaEsconder: 'janela:esconder',
  JanelaFechar: 'janela:fechar',
  JanelaEstado: 'janela:estado',
  /** Pedido para abrir a janelinha da senha (botão de fechar, bandeja, Alt+F4) */
  PedirSenhaParaFechar: 'janela:pedir-senha',
  /** Avisa a tela de que o aplicativo vai fechar para instalar a versão nova */
  AtualizacaoInstalando: 'atualizacao:instalando',
} as const;
// Canais do popup: ver popup-channels.ts
