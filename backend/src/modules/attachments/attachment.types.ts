/**
 * Anexos dos comunicados: arquivos e imagens que o DP manda junto com a mensagem.
 * O conteúdo fica em disco (data/uploads); o banco guarda só os dados do arquivo.
 */

export type AttachmentKind = 'IMAGE' | 'FILE';

export const ATTACHMENT_ID_PATTERN = '^ATT-[0-9a-f]{24}$';
export const ATTACHMENT_ID_REGEX = new RegExp(ATTACHMENT_ID_PATTERN);

export const ATTACHMENT_LIMITS = {
  /** Tamanho máximo de cada arquivo */
  maxBytes: 10 * 1024 * 1024,
  /** Quantos anexos cabem em um comunicado */
  perMessage: 5,
  /** Soma dos anexos de um comunicado */
  totalBytes: 25 * 1024 * 1024,
  /** Tamanho do nome do arquivo */
  nameLength: 160,
} as const;

/** Uploads que nunca viraram comunicado saem do disco depois disso */
export const PENDING_UPLOAD_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Arquivo em disco sem registro no banco (o TI apagou o comunicado) só é removido
 * depois desta folga, para nunca esbarrar em um upload que está acontecendo agora.
 */
export const ORPHAN_FILE_GRACE_MS = 5 * 60 * 1000;

/** Validade do link temporário de download (usado pelo navegador e pelo celular) */
export const DOWNLOAD_TICKET_TTL_MS = 5 * 60 * 1000;

/**
 * O que o DP pode anexar. Fora desta lista o envio é recusado —
 * nada de .exe, .bat, .msi e afins chegando nos computadores da fábrica.
 */
export const ALLOWED_TYPES: Record<string, { kind: AttachmentKind; extensions: string[] }> = {
  'image/jpeg': { kind: 'IMAGE', extensions: ['.jpg', '.jpeg'] },
  'image/png': { kind: 'IMAGE', extensions: ['.png'] },
  'image/gif': { kind: 'IMAGE', extensions: ['.gif'] },
  'image/webp': { kind: 'IMAGE', extensions: ['.webp'] },
  'image/bmp': { kind: 'IMAGE', extensions: ['.bmp'] },
  'application/pdf': { kind: 'FILE', extensions: ['.pdf'] },
  'application/msword': { kind: 'FILE', extensions: ['.doc'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'FILE', extensions: ['.docx'] },
  'application/vnd.ms-excel': { kind: 'FILE', extensions: ['.xls'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'FILE', extensions: ['.xlsx'] },
  'application/vnd.ms-powerpoint': { kind: 'FILE', extensions: ['.ppt'] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'FILE', extensions: ['.pptx'] },
  'text/plain': { kind: 'FILE', extensions: ['.txt'] },
  'text/csv': { kind: 'FILE', extensions: ['.csv'] },
  'application/zip': { kind: 'FILE', extensions: ['.zip'] },
  'application/x-zip-compressed': { kind: 'FILE', extensions: ['.zip'] },
};

/** Extensões aceitas (para o seletor de arquivos da Central e para as mensagens de erro) */
export const ALLOWED_EXTENSIONS = [...new Set(Object.values(ALLOWED_TYPES).flatMap((t) => t.extensions))];

/** Anexo como os clientes veem (o caminho em disco nunca sai do servidor) */
export interface Attachment {
  id: string;
  /** Nome original do arquivo, como o DP escolheu */
  name: string;
  mimeType: string;
  /** Tamanho em bytes */
  size: number;
  /** IMAGE aparece como miniatura; FILE aparece como arquivo para abrir/baixar */
  kind: AttachmentKind;
}

/** Anexo com os dados internos (só o servidor usa) */
export interface StoredAttachment extends Attachment {
  /** Comunicado a que pertence; null = ainda não enviado */
  messageSeq: number | null;
  /** Nome do arquivo dentro da pasta de anexos */
  storedName: string;
  /** Pessoa do DP que subiu o arquivo */
  uploadedBy: string;
  createdAt: string;
}

export type NewAttachment = Omit<StoredAttachment, 'createdAt'>;

export function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_ID_REGEX.test(value);
}

/** "1,4 MB" — usado nas mensagens de erro e no log */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Extensão que o arquivo terá em disco: a do nome original, se combinar com o tipo;
 * senão a primeira do tipo declarado. Evita gravar ".exe" com cara de PDF.
 */
export function safeExtension(name: string, mimeType: string): string {
  const allowed = ALLOWED_TYPES[mimeType];
  if (!allowed) return '';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return allowed.extensions.includes(extension) ? extension : allowed.extensions[0];
}

/** Tira caminho, caracteres proibidos no Windows e nomes gigantes */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  return clean.slice(0, ATTACHMENT_LIMITS.nameLength);
}
