import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  Atalho,
  ChatContact,
  ChatMessage,
  ComputerInfo,
  DadosAtalho,
  DpMessage,
  EmployeeProfile,
  MidiaPublica,
  MuralPost,
} from '../shared/types';
import { parseChatContact, parseChatMessage, parseEmployee, parseMessage } from './message-validation';

const REQUEST_TIMEOUT_MS = 10_000;
/** Anexo pode ter alguns MB: mais folga que uma chamada comum */
const ATTACHMENT_TIMEOUT_MS = 60_000;
/** Foto de perfil e mídia do mural: alguns MB, mais folga que uma chamada comum */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** Instalador passa de 80 MB e pode vir por rede lenta */
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;

/** Versão nova anunciada pelo servidor. */
export interface VersaoDisponivel {
  versao: string;
  url: string;
  sha256: string;
  tamanho: number;
  notas: string;
  obrigatoria: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** PC bloqueado ou credencial diferente: não adianta insistir sem mudar a configuração */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Cliente da API REST do backend. Só o processo main conversa com o servidor. */
export class ApiClient {
  /** Token do computador, obtido no registro (fica só em memória) */
  private token: string | null = null;

  constructor(private readonly baseUrl: string) {}

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    }
    return data as T;
  }

  /**
   * Registra o computador e devolve o token recebido.
   * Não grava o token aqui: quem chama (ServerConnection) só o adota se a tentativa ainda for a atual.
   */
  async registerComputer(info: ComputerInfo, computerSecret: string): Promise<string> {
    const data = await this.request<{ token?: unknown }>('POST', '/api/computers/register', { ...info, computerSecret });
    if (typeof data.token !== 'string') throw new ApiError('Resposta de registro inválida', 500);
    return data.token;
  }

  /** Token do computador usado nas próximas chamadas (null = nenhum) */
  setToken(token: string | null): void {
    this.token = token;
  }

  async listMessages(): Promise<DpMessage[]> {
    const data = await this.request<{ messages?: unknown[] }>('GET', '/api/messages?limit=500');
    return (data.messages ?? []).map(parseMessage).filter((m): m is DpMessage => m !== null);
  }

  async markRead(messageId: string): Promise<string> {
    const data = await this.request<{ readAt: string }>('PATCH', `/api/messages/${encodeURIComponent(messageId)}/read`);
    return data.readAt;
  }

  /**
   * Baixa o conteúdo de um anexo. Só o processo main faz isso: a interface
   * recebe o arquivo já salvo (ou a imagem em data URL).
   */
  async downloadAttachment(attachmentId: string): Promise<Buffer> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}/api/attachments/${encodeURIComponent(attachmentId)}`, {
      headers,
      signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS),
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  // ---- Funcionário logado neste computador (o vínculo fica no servidor) ----

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

  async changeEmployeePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.request('POST', '/api/session/password', { currentPassword, newPassword });
  }

  // ---- Chat do funcionário logado com as pessoas do DP (uma conversa por pessoa) ----

  async getChatContacts(): Promise<ChatContact[]> {
    const data = await this.request<{ contacts?: unknown[] }>('GET', '/api/chat/contacts');
    return (data.contacts ?? []).map(parseChatContact).filter((c): c is ChatContact => c !== null);
  }

  async getChat(dpUserId: string): Promise<ChatMessage[]> {
    const data = await this.request<{ messages?: unknown[] }>(
      'GET',
      `/api/chat/messages?dpUserId=${encodeURIComponent(dpUserId)}`,
    );
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

  // ---- Atualização do aplicativo ----

  /** Pergunta ao servidor se existe versão mais nova que a instalada. */
  async verificarAtualizacao(versaoAtual: string): Promise<VersaoDisponivel | null> {
    const data = await this.request<{ temAtualizacao?: boolean; release?: unknown }>(
      'GET',
      `/api/atualizacoes/desktop/verificar?versao=${encodeURIComponent(versaoAtual)}`,
    );
    if (!data.temAtualizacao || !data.release) return null;
    const release = data.release as Partial<VersaoDisponivel>;
    if (typeof release.versao !== 'string' || typeof release.url !== 'string' || typeof release.sha256 !== 'string') {
      throw new ApiError('Resposta de atualização inválida', 500);
    }
    return {
      versao: release.versao,
      url: release.url,
      sha256: release.sha256,
      tamanho: Number(release.tamanho ?? 0),
      notas: String(release.notas ?? ''),
      obrigatoria: release.obrigatoria === true,
    };
  }

  /**
   * Baixa o instalador gravando direto em disco (são dezenas de MB) e confere
   * o SHA-256 no caminho. Devolve false se o arquivo chegou corrompido.
   */
  async baixarAtualizacao(versao: VersaoDisponivel, destino: string): Promise<boolean> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}${versao.url}`, {
      headers,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      throw new ApiError(`Erro HTTP ${response.status} ao baixar a atualização`, response.status);
    }

    const hash = createHash('sha256');
    const arquivo = createWriteStream(destino);
    const leitura = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    leitura.on('data', (parte: Buffer) => hash.update(parte));
    await pipeline(leitura, arquivo);

    return hash.digest('hex') === versao.sha256;
  }

  // ---- Mural, atalhos e foto de perfil ----

  async obterMural(): Promise<MuralPost | null> {
    const data = await this.request<{ post?: MuralPost | null }>('GET', '/api/mural');
    return data.post ?? null;
  }

  async listarAtalhos(): Promise<Atalho[]> {
    const data = await this.request<{ atalhos?: Atalho[] }>('GET', '/api/atalhos');
    return data.atalhos ?? [];
  }

  async criarAtalho(dados: DadosAtalho): Promise<Atalho> {
    return this.request<Atalho>('POST', '/api/atalhos', dados);
  }

  async atualizarAtalho(id: string, dados: DadosAtalho): Promise<Atalho> {
    return this.request<Atalho>('PUT', `/api/atalhos/${encodeURIComponent(id)}`, dados);
  }

  async removerAtalho(id: string): Promise<void> {
    await this.request('DELETE', `/api/atalhos/${encodeURIComponent(id)}`);
  }

  async reordenarAtalhos(ids: string[]): Promise<Atalho[]> {
    const data = await this.request<{ atalhos?: Atalho[] }>('PUT', '/api/atalhos/ordem', { ids });
    return data.atalhos ?? [];
  }

  /** Envia uma imagem ou vídeo; o arquivo vai como corpo binário, com o tipo real. */
  async enviarMidia(conteudo: Buffer, mimeType: string, nome: string): Promise<MidiaPublica> {
    const headers: Record<string, string> = { 'Content-Type': mimeType, 'X-Nome': encodeURIComponent(nome) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`${this.baseUrl}/api/midias`, {
      method: 'POST',
      headers,
      body: new Uint8Array(conteudo),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => ({}))) as MidiaPublica & { message?: string };
    if (!response.ok) throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    return data;
  }

  async obterFoto(): Promise<MidiaPublica | null> {
    const data = await this.request<{ foto?: MidiaPublica | null }>('GET', '/api/perfil/foto');
    return data.foto ?? null;
  }

  async definirFoto(midiaId: string): Promise<MidiaPublica> {
    const data = await this.request<{ foto: MidiaPublica }>('PUT', '/api/perfil/foto', { midiaId });
    return data.foto;
  }

  async removerFoto(): Promise<void> {
    await this.request('DELETE', '/api/perfil/foto');
  }

  /** Busca a mídia no servidor repassando o cabeçalho Range (usado pelo protocolo dpmidia://). */
  async buscarMidia(midiaId: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (range) headers.Range = range;
    return fetch(`${this.baseUrl}/api/midias/${encodeURIComponent(midiaId)}`, { headers });
  }
}
