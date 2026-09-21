import { ApiError } from './api-client';
import type { ChamadoCompleto, ChamadoResumo, MidiaPublica, MuralPost, StatusChamado } from '../shared/types';

const TIMEOUT_MS = 15_000;

/** Tipo do arquivo pelo nome: o servidor confere a extensão contra o tipo informado. */
const TIPOS_POR_EXTENSAO: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
};

function tipoPeloNome(nome: string): string {
  return TIPOS_POR_EXTENSAO[nome.slice(nome.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
}
const UPLOAD_TIMEOUT_MS = 10 * 60_000;

/** Pessoa do DP ou do TI logada no aplicativo. */
export interface AdminUser {
  id: string;
  username: string;
  name: string;
  superAdmin: boolean;
  mustChangePassword: boolean;
}

/**
 * Chamadas feitas com a conta do DP/TI, separadas das do computador.
 *
 * O aplicativo passa a ter dois tipos de credencial ao mesmo tempo: o token do
 * PC (comunicados, chat, atalhos) e, quando alguém do DP entra, o token dela.
 * Manter os dois clientes separados evita usar um token no lugar do outro.
 */
export class AdminClient {
  private token: string | null = null;
  private usuario: AdminUser | null = null;

  constructor(private readonly baseUrl: string) {}

  get user(): AdminUser | null {
    return this.usuario;
  }

  get autenticado(): boolean {
    return this.token !== null;
  }

  /** Chamada livre para as telas administrativas (a rota é conferida antes, no processo principal). */
  async chamar<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) throw new ApiError('Entre com a conta do DP para usar esta função', 401);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (response.status === 401) {
      // Token vencido ou derrubado: a sessão do DP acaba aqui
      this.token = null;
      this.usuario = null;
    }
    if (!response.ok) throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    return data as T;
  }

  async login(username: string, password: string): Promise<AdminUser> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as { token?: string; user?: AdminUser; message?: string };
    if (!response.ok || !data.token || !data.user) {
      throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    }
    this.token = data.token;
    this.usuario = data.user;
    return data.user;
  }

  async logout(): Promise<void> {
    if (!this.token) return;
    try {
      await this.request('POST', '/api/auth/logout');
    } catch {
      /* servidor fora do ar: encerra localmente do mesmo jeito */
    }
    this.token = null;
    this.usuario = null;
  }

  esquecer(): void {
    this.token = null;
    this.usuario = null;
  }

  // ---- Chamados (fila do TI) ----

  async filaChamados(incluirEncerrados: boolean): Promise<ChamadoResumo[]> {
    const data = await this.request<{ chamados?: ChamadoResumo[] }>(
      'GET',
      `/api/chamados/fila?encerrados=${incluirEncerrados ? 'true' : 'false'}`,
    );
    return data.chamados ?? [];
  }

  async detalheChamado(id: string): Promise<ChamadoCompleto> {
    return this.request<ChamadoCompleto>('GET', `/api/chamados/${encodeURIComponent(id)}`);
  }

  async responderChamado(id: string, conteudo: string): Promise<void> {
    await this.request('POST', `/api/chamados/${encodeURIComponent(id)}/mensagens`, { conteudo });
  }

  async mudarStatusChamado(id: string, status: StatusChamado): Promise<ChamadoCompleto> {
    return this.request<ChamadoCompleto>('PUT', `/api/chamados/${encodeURIComponent(id)}/status`, { status });
  }

  async marcarChamadoLido(id: string): Promise<void> {
    await this.request('POST', `/api/chamados/${encodeURIComponent(id)}/lidas`);
  }

  // ---- Mural ----

  async listarMural(): Promise<MuralPost[]> {
    const data = await this.request<{ posts?: MuralPost[] }>('GET', '/api/mural/todos');
    return data.posts ?? [];
  }

  async publicarMural(dados: { titulo: string; texto: string; midiaId: string | null; ativo: boolean }): Promise<MuralPost> {
    return this.request<MuralPost>('POST', '/api/mural', dados);
  }

  async atualizarMural(
    id: string,
    dados: { titulo: string; texto: string; midiaId: string | null; ativo: boolean },
  ): Promise<MuralPost> {
    return this.request<MuralPost>('PUT', `/api/mural/${encodeURIComponent(id)}`, dados);
  }

  async removerMural(id: string): Promise<void> {
    await this.request('DELETE', `/api/mural/${encodeURIComponent(id)}`);
  }

  /** Anexo de comunicado (imagem ou documento), no formato que a API de anexos espera. */
  async enviarAnexo(conteudo: Buffer, nome: string): Promise<{ id: string; name: string; size: number }> {
    if (!this.token) throw new ApiError('Entre com a conta do DP para enviar arquivos', 401);
    const response = await fetch(`${this.baseUrl}/api/attachments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(nome),
        'X-File-Type': tipoPeloNome(nome),
      },
      body: new Uint8Array(conteudo),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as {
      attachment?: { id: string; name: string; size: number };
      message?: string;
    };
    if (!response.ok || !data.attachment) throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    return data.attachment;
  }

  /** Envia imagem ou vídeo com a credencial do DP. */
  async enviarMidia(conteudo: Buffer, mimeType: string, nome: string): Promise<MidiaPublica> {
    if (!this.token) throw new ApiError('Entre com a conta do DP para enviar arquivos', 401);
    const response = await fetch(`${this.baseUrl}/api/midias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': mimeType, 'X-Nome': encodeURIComponent(nome) },
      body: new Uint8Array(conteudo),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as MidiaPublica & { message?: string };
    if (!response.ok) throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    return data;
  }
}
