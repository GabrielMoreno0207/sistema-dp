/** Cliente da API REST do servidor (a mesma usada pelo app do computador) */
import DpNative from '../specs/NativeDpNative';
import type { ArquivoLocal, DpMessage, EmployeeProfile, VersaoDisponivel } from './types';
import { parseEmployee, parseMessage } from './validation';

const REQUEST_TIMEOUT_MS = 15_000;

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

export type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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
  } catch {
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

  /** Cabeçalho para a tag de imagem buscar mídias protegidas (fotos, mural, chat) */
  get authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  /** Endereço completo de uma mídia (/api/midias/:id) */
  midiaUrl(midiaId: string): string {
    return `${this.baseUrl}/api/midias/${encodeURIComponent(midiaId)}`;
  }

  /** Chamada genérica: devolve o JSON da resposta (ou {} quando o servidor responde 204) */
  async request<T>(method: Metodo, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
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

  /**
   * Envia um arquivo do celular como corpo binário (o que /api/midias e
   * /api/attachments esperam). O envio é feito pelo Android, em partes,
   * direto do arquivo: vídeos grandes não passam pela memória do JavaScript.
   */
  async upload<T>(path: string, arquivo: ArquivoLocal, headers: Record<string, string>): Promise<T> {
    let resposta: { status: number; body: string };
    try {
      resposta = JSON.parse(
        await DpNative.uploadFile(`${this.baseUrl}${path}`, this.token ?? '', arquivo.uri, arquivo.mimeType, JSON.stringify(headers)),
      ) as { status: number; body: string };
    } catch (err) {
      throw new ApiError(err instanceof Error && err.message ? `Falha no envio: ${err.message}` : 'Falha no envio do arquivo', 0);
    }
    let data: { message?: string } = {};
    try {
      data = resposta.body ? (JSON.parse(resposta.body) as { message?: string }) : {};
    } catch {
      /* resposta sem JSON */
    }
    if (resposta.status < 200 || resposta.status > 299) {
      throw new ApiError(data.message ?? `Erro HTTP ${resposta.status}`, resposta.status);
    }
    return data as T;
  }

  /** Baixa para a pasta de cache do app e devolve o caminho do arquivo */
  async download(path: string, pasta: string, nome: string): Promise<string> {
    try {
      return await DpNative.downloadFile(`${this.baseUrl}${path}`, this.token ?? '', pasta, nome);
    } catch (err) {
      throw new ApiError(err instanceof Error && err.message ? err.message : 'Falha ao baixar o arquivo', 0);
    }
  }

  // ---------------------------------------------------------------- aparelho e sessão

  async registerDevice(info: DeviceInfoPayload, secret: string): Promise<string> {
    const data = await this.request<{ token?: unknown }>('POST', '/api/computers/register', { ...info, computerSecret: secret });
    if (typeof data.token !== 'string') throw new ApiError('Resposta de registro inválida', 500);
    return data.token;
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

  // ---------------------------------------------------------------- comunicados

  async listMessages(): Promise<DpMessage[]> {
    const data = await this.request<{ messages?: unknown[] }>('GET', '/api/messages?limit=500');
    return (data.messages ?? []).map(parseMessage).filter((m): m is DpMessage => m !== null);
  }

  async markRead(messageId: string): Promise<string> {
    const data = await this.request<{ readAt: string }>('PATCH', `/api/messages/${encodeURIComponent(messageId)}/read`);
    return data.readAt;
  }

  async confirmarCiencia(messageId: string): Promise<string> {
    const data = await this.request<{ cienteEm?: string }>('POST', `/api/messages/${encodeURIComponent(messageId)}/ciencia`);
    return data.cienteEm ?? new Date().toISOString();
  }

  /**
   * Endereço temporário (5 min) para abrir um anexo de comunicado. O servidor
   * devolve um link com um bilhete de uso curto, porque a tag de imagem não manda o token.
   */
  async getAttachmentLink(attachmentId: string): Promise<string> {
    const data = await this.request<{ url?: unknown }>('POST', `/api/attachments/${encodeURIComponent(attachmentId)}/link`);
    if (typeof data.url !== 'string') throw new ApiError('Resposta inválida ao abrir o anexo', 500);
    return `${this.baseUrl}${data.url}`;
  }

  // ---------------------------------------------------------------- atualização do app

  /** app: "mobile" = APK; "mobile-ota" = atualização rápida (só o JavaScript) */
  async verificarAtualizacao(versaoAtual: string, app: 'mobile' | 'mobile-ota' = 'mobile'): Promise<VersaoDisponivel | null> {
    const data = await this.request<{ temAtualizacao?: boolean; release?: unknown }>(
      'GET',
      `/api/atualizacoes/${app}/verificar?versao=${encodeURIComponent(versaoAtual)}`,
    );
    if (!data.temAtualizacao || !data.release) return null;
    const release = data.release as Partial<VersaoDisponivel>;
    if (typeof release.versao !== 'string' || typeof release.url !== 'string' || typeof release.sha256 !== 'string') {
      throw new ApiError('Resposta de atualização inválida', 500);
    }
    return {
      versao: release.versao,
      url: release.url,
      sha256: release.sha256.toLowerCase(),
      tamanho: Number(release.tamanho ?? 0),
      notas: String(release.notas ?? ''),
      obrigatoria: release.obrigatoria === true,
    };
  }
}
