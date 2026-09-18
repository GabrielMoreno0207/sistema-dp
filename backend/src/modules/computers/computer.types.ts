export type ComputerStatus = 'ONLINE' | 'OFFLINE';

/** Dados que o aplicativo desktop informa ao se conectar */
export interface ComputerInfo {
  computerId: string;
  hostname: string;
  appVersion: string;
  platform: string;
}

export interface Computer extends ComputerInfo {
  status: ComputerStatus;
  registeredAt: string;
  lastSeenAt: string;
  /** Funcionário logado neste computador (null = sem identificação) */
  currentUserId: string | null;
  /** Quando esse funcionário entrou (a sessão expira após EMPLOYEE_SESSION_HOURS) */
  currentUserSince: string | null;
}

/** PC- = aplicativo do computador; CEL- = aplicativo do celular (Android). Os dois funcionam igual. */
export const COMPUTER_ID_PATTERN = '^(PC|CEL)-[A-F0-9]{8,32}$';
export const COMPUTER_LIMITS = { hostname: 255, appVersion: 32, platform: 32 } as const;

const computerIdRegex = new RegExp(COMPUTER_ID_PATTERN);

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/**
 * Valida os dados do computador vindos de fora do HTTP (ex.: handshake do WebSocket).
 * Retorna null se forem inválidos.
 */
export function parseComputerInfo(input: unknown): ComputerInfo | null {
  if (typeof input !== 'object' || input === null) return null;
  const data = input as Record<string, unknown>;

  if (typeof data.computerId !== 'string' || !computerIdRegex.test(data.computerId)) return null;
  if (!isBoundedString(data.hostname, COMPUTER_LIMITS.hostname)) return null;
  if (!isBoundedString(data.appVersion, COMPUTER_LIMITS.appVersion)) return null;
  if (!isBoundedString(data.platform, COMPUTER_LIMITS.platform)) return null;

  return {
    computerId: data.computerId,
    hostname: data.hostname.trim(),
    appVersion: data.appVersion.trim(),
    platform: data.platform.trim(),
  };
}
