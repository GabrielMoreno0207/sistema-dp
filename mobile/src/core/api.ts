/** Cliente da API REST do servidor (a mesma usada pelo app do computador) */
import type { ChatContact, ChatMessage, DpMessage, EmployeeProfile } from './types';
import { parseChatContact, parseChatMessage, parseEmployee, parseMessage } from './validation';

const REQUEST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Aparelho bloqueado ou credencial diferente: não adianta insistir sem mudar a configuração */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface DeviceInfoPayload {
  computerId: string;
  hostname: string;
  appVersion: string;
  platform: string;
}

/** "servidor-dp:3000" → "http://servidor-dp:3000" (sem barra no fim) */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new ApiError('O servidor não respondeu a tempo', 0);
    throw new ApiError('Não foi possível conectar ao servidor. Confira o Wi-Fi e o endereço.', 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Confere se o endereço é do servidor do sistema */
export async function testServer(serverUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}/api/health`, { method: 'GET' });
    const data = (await response.json().catch(() => ({}))) as { service?: string };
    if (response.ok && data.service === 'sistema-dp-backend') return { ok: true, message: 'Servidor encontrado.' };
    return { ok: false, message: 'Esse endereço respondeu, mas não é o servidor do sistema.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Falha ao testar.' };
  }
}

export class ApiClient {
  private token: string | null = null;

  constructor(readonly baseUrl: string) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    return data as T;
  }

  async registerDevice(info: DeviceInfoPayload, secret: string): Promise<string> {
    const data = await this.request<{ token?: unknown }>('POST', '/api/computers/register', { ...info, computerSecret: secret });
    if (typeof data.token !== 'string') throw new ApiError('Resposta de registro inválida', 500);
    return data.token;
  }

  async listMessages(): Promise<DpMessage[]> {
    const data = await this.request<{ messages?: unknown[] }>('GET', '/api/messages?limit=500');
    return (data.messages ?? []).map(parseMessage).filter((m): m is DpMessage => m !== null);
  }

  async markRead(messageId: string): Promise<string> {
    const data = await this.request<{ readAt: string }>('PATCH', `/api/messages/${encodeURIComponent(messageId)}/read`);
    return data.readAt;
  }

  async getSession(): Promise<EmployeeProfile | null> {
    const data = await this.request<{ employee?: unknown }>('GET', '/api/session');
    return data.employee ? parseEmployee(data.employee) : null;
  }

  async loginEmployee(registration: string, password: string): Promise<EmployeeProfile> {
    const data = await this.request<{ employee?: unknown }>('POST', '/api/session/login', { registration, password });
    const employee = parseEmployee(data.employee);
    if (!employee) throw new ApiError('Resposta de login inválida', 500);
    return employee;
  }

  async logoutEmployee(): Promise<void> {
    await this.request('POST', '/api/session/logout');
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request('POST', '/api/session/password', { currentPassword, newPassword });
  }

  async getChatContacts(): Promise<ChatContact[]> {
    const data = await this.request<{ contacts?: unknown[] }>('GET', '/api/chat/contacts');
    return (data.contacts ?? []).map(parseChatContact).filter((c): c is ChatContact => c !== null);
  }

  async getChat(dpUserId: string): Promise<ChatMessage[]> {
    const data = await this.request<{ messages?: unknown[] }>('GET', `/api/chat/messages?dpUserId=${encodeURIComponent(dpUserId)}`);
    return (data.messages ?? []).map(parseChatMessage).filter((m): m is ChatMessage => m !== null);
  }

  async sendChat(dpUserId: string, content: string): Promise<ChatMessage> {
    const data = await this.request<{ message?: unknown }>('POST', '/api/chat/messages', { dpUserId, content });
    const message = parseChatMessage(data.message);
    if (!message) throw new ApiError('Resposta de envio inválida', 500);
    return message;
  }

  async markChatRead(dpUserId: string): Promise<void> {
    await this.request('POST', '/api/chat/read', { dpUserId });
  }

  /**
   * Endereço temporário (5 min) para abrir um anexo. O servidor devolve um link com um
   * bilhete de uso curto, porque nem a tag de imagem nem o navegador mandam o token do aparelho.
   */
  async getAttachmentLink(attachmentId: string): Promise<string> {
    const data = await this.request<{ url?: unknown }>('POST', `/api/attachments/${encodeURIComponent(attachmentId)}/link`);
    if (typeof data.url !== 'string') throw new ApiError('Resposta inválida ao abrir o anexo', 500);
    return `${this.baseUrl}${data.url}`;
  }
}
