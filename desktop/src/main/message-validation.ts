import {
  MESSAGE_TYPES,
  type DpAttachment,
  type DpMessage,
  type EmployeeProfile,
  type MessageType,
} from '../shared/types';

export const MESSAGE_ID_REGEX = /^MSG-\d{6,}$/;
export const ATTACHMENT_ID_REGEX = /^ATT-[0-9a-f]{24}$/;
/** IDs das pessoas do DP (contatos do chat) */

function isString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

/** Valida um anexo vindo do servidor. Retorna null se o formato for inesperado. */
export function parseAttachment(input: unknown): DpAttachment | null {
  if (typeof input !== 'object' || input === null) return null;
  const a = input as Record<string, unknown>;
  if (typeof a.id !== 'string' || !ATTACHMENT_ID_REGEX.test(a.id)) return null;
  if (!isString(a.name, 200) || !a.name) return null;
  if (!isString(a.mimeType, 200) || !a.mimeType) return null;
  if (typeof a.size !== 'number' || !Number.isInteger(a.size) || a.size < 0) return null;
  if (a.kind !== 'IMAGE' && a.kind !== 'FILE') return null;
  return { id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, kind: a.kind };
}

/**
 * Valida uma mensagem vinda do servidor (WebSocket ou REST) antes de usá-la.
 * Retorna null se o formato for inesperado.
 */
export function parseMessage(input: unknown): DpMessage | null {
  if (typeof input !== 'object' || input === null) return null;
  const m = input as Record<string, unknown>;

  if (typeof m.id !== 'string' || !MESSAGE_ID_REGEX.test(m.id)) return null;
  if (!isString(m.title, 200) || !isString(m.content, 10_000) || !isString(m.sender, 200)) return null;
  if (typeof m.type !== 'string' || !MESSAGE_TYPES.includes(m.type as MessageType)) return null;
  if (!isString(m.target, 32)) return null;
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) return null;

  const readAt = typeof m.readAt === 'string' ? m.readAt : null;
  return {
    id: m.id,
    title: m.title,
    content: m.content,
    type: m.type as MessageType,
    target: m.target,
    targetId: typeof m.targetId === 'string' ? m.targetId : null,
    sender: m.sender,
    createdAt: m.createdAt,
    read: m.read === true || readAt !== null,
    readAt,
    exigeCiencia: m.exigeCiencia === true,
    cienteEm: typeof m.cienteEm === 'string' ? m.cienteEm : null,
    attachments: Array.isArray(m.attachments)
      ? m.attachments.map(parseAttachment).filter((a): a is DpAttachment => a !== null)
      : [],
  };
}

function optionalString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

/** Valida uma mensagem do chat vinda do servidor (REST ou WebSocket). Retorna null se o formato for inesperado. */
export function parseEmployee(input: unknown): EmployeeProfile | null {
  if (typeof input !== 'object' || input === null) return null;
  const e = input as Record<string, unknown>;
  if (!isString(e.id, 100) || !e.id) return null;
  if (!isString(e.name, 200) || !e.name) return null;
  if (!isString(e.registration, 32) || !e.registration) return null;
  return {
    id: e.id,
    name: e.name,
    registration: e.registration,
    sector: optionalString(e.sector, 100),
    shift: optionalString(e.shift, 100),
    // Só o servidor decide o acesso; valor estranho vale como "nenhum"
    acessoAdmin: e.acessoAdmin === 'TI' ? 'TI' : e.acessoAdmin === 'DP' ? 'DP' : 'NENHUM',
    mustChangePassword: e.mustChangePassword === true,
  };
}
