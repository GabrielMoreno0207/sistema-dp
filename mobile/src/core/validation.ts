/** Confere os dados vindos do servidor antes de usar (mesmas regras do app do computador) */
import {
  MESSAGE_TYPES,
  type ChatContact,
  type ChatMessage,
  type DpAttachment,
  type DpMessage,
  type EmployeeProfile,
  type MessageType,
} from './types';

export const MESSAGE_ID_REGEX = /^MSG-\d{6,}$/;
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ATTACHMENT_ID_REGEX = /^ATT-[0-9a-f]{24}$/;

function isString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function optionalString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

/** Número do comunicado (MSG-000123 → 123) */
export function messageSeq(id: string): number {
  return Number(id.slice(4)) || 0;
}

/** Confere um anexo vindo do servidor. Retorna null se o formato for inesperado. */
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
    attachments: Array.isArray(m.attachments)
      ? m.attachments.map(parseAttachment).filter((a): a is DpAttachment => a !== null)
      : [],
  };
}

export function parseChatMessage(input: unknown): ChatMessage | null {
  if (typeof input !== 'object' || input === null) return null;
  const c = input as Record<string, unknown>;
  if (typeof c.id !== 'number' || !Number.isInteger(c.id) || c.id <= 0) return null;
  if (!isString(c.employeeId, 100) || !c.employeeId) return null;
  if (!isString(c.dpUserId, 100) || !c.dpUserId) return null;
  if (c.senderType !== 'DP' && c.senderType !== 'EMPLOYEE') return null;
  if (!isString(c.senderName, 200) || !isString(c.content, 10_000)) return null;
  if (typeof c.createdAt !== 'string' || Number.isNaN(Date.parse(c.createdAt))) return null;
  return {
    id: c.id,
    employeeId: c.employeeId,
    dpUserId: c.dpUserId,
    senderType: c.senderType,
    senderName: c.senderName,
    content: c.content,
    createdAt: c.createdAt,
    readAt: typeof c.readAt === 'string' ? c.readAt : null,
    automatic: c.automatic === true,
  };
}

export function parseChatContact(input: unknown): ChatContact | null {
  if (typeof input !== 'object' || input === null) return null;
  const c = input as Record<string, unknown>;
  if (typeof c.id !== 'string' || !UUID_REGEX.test(c.id)) return null;
  if (!isString(c.name, 200) || !c.name) return null;
  const unreadCount =
    typeof c.unreadCount === 'number' && Number.isInteger(c.unreadCount) && c.unreadCount >= 0 ? c.unreadCount : 0;
  let lastMessage: ChatContact['lastMessage'] = null;
  if (typeof c.lastMessage === 'object' && c.lastMessage !== null) {
    const l = c.lastMessage as Record<string, unknown>;
    if (
      isString(l.content, 10_000) &&
      (l.senderType === 'DP' || l.senderType === 'EMPLOYEE') &&
      typeof l.createdAt === 'string' &&
      !Number.isNaN(Date.parse(l.createdAt))
    ) {
      lastMessage = { content: l.content, senderType: l.senderType, createdAt: l.createdAt };
    }
  }
  return { id: c.id, name: c.name, unreadCount, lastMessage };
}

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
    mustChangePassword: e.mustChangePassword === true,
  };
}
