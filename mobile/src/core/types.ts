/** Tipos do app (os mesmos dados que o servidor manda para o app do computador) */

export type ConnectionStatus =
  | 'not-configured'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  /** Registro recusado pelo servidor (ex.: aparelho bloqueado) */
  | 'unauthorized';

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
  /** IMAGE aparece como miniatura no comunicado; FILE, como arquivo para abrir */
  kind: 'IMAGE' | 'FILE';
}

/** Comunicado do DP, do ponto de vista deste aparelho */
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

/** Funcionário logado no app */
export interface EmployeeProfile {
  id: string;
  name: string;
  registration: string;
  sector: string | null;
  shift: string | null;
  mustChangePassword: boolean;
}

/** Mensagem do chat: a conversa é o par (funcionário logado, pessoa do DP) */
export interface ChatMessage {
  id: number;
  employeeId: string;
  dpUserId: string;
  senderType: 'DP' | 'EMPLOYEE';
  senderName: string;
  content: string;
  createdAt: string;
  readAt: string | null;
  automatic: boolean;
}

/** Pessoa do DP na lista de contatos do chat */
export interface ChatContact {
  id: string;
  name: string;
  unreadCount: number;
  lastMessage: { content: string; senderType: 'DP' | 'EMPLOYEE'; createdAt: string } | null;
}

export const CHAT_MESSAGE_MAX = 2000;

/** Guardado cifrado no aparelho (Android Keystore) */
export interface DeviceConfig {
  serverUrl: string | null;
  /** CEL-XXXXXXXXXXXX: identifica o aparelho no servidor (aparece na Central) */
  deviceId: string | null;
  /** Segredo da instalação: só este aparelho consegue se registrar com este ID */
  deviceSecret: string | null;
  /** Maior número de comunicado já avisado (evita avisar de novo ao reabrir/religar) */
  lastAlertedSeq: number;
}

export interface OperationResult {
  ok: boolean;
  message: string;
}

export const TYPE_LABELS: Record<MessageType, string> = {
  COMUNICADO: 'Comunicado',
  AVISO: 'Aviso',
  INFORMATIVO: 'Informativo',
  URGENTE: 'Urgente',
};
