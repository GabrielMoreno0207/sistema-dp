import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  Atalho,
  ComputerInfo,
  DadosAtalho,
  DpMessage,
  EmployeeProfile,
  ChamadoCompleto,
  ChamadoResumo,
  MidiaPublica,
  MuralPost,
  NovoChamadoInput,
  StatusChamado,
} from '../shared/types';
import { parseEmployee, parseMessage } from './message-validation';

const REQUEST_TIMEOUT_MS = 10_000;
/** Anexo pode ter alguns MB: mais folga que uma chamada comum */
const ATTACHMENT_TIMEOUT_MS = 60_000;
/** Foto de perfil e mídia do mural: alguns MB, mais folga que uma chamada comum */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** Instalador passa de 80 MB e pode vir por rede lenta */
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;

/** Tipo (MIME) de um anexo de comunicado pelo fim do nome do arquivo */
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

export function tipoDeAnexo(nome: string): string {
  return TIPOS_POR_EXTENSAO[nome.slice(nome.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
}
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


/**
 * Corpo de um envio grande: o arquivo é lido do disco em partes, então uma
 * imagem ou um vídeo de qualquer tamanho não precisa caber na memória.
 */
export function corpoDoArquivo(caminho: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(caminho)) as ReadableStream<Uint8Array>;
}

/**
 * Tempo limite proporcional ao tamanho: 2 minutos de folga e mais 1 minuto a
 * cada 5 MB, para um vídeo grande não ser cortado no meio em rede lenta.
 */
export function tempoDeEnvio(bytes: number): number {
  return 2 * 60_000 + Math.ceil(bytes / (5 * 1024 * 1024)) * 60_000;
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

  /** Chamada livre com o token do PC (a rota é conferida antes, no processo principal). */
  async chamar<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(method, path, body);
  }

  /** Token do computador usado nas próximas chamadas (null = nenhum) */
  setToken(token: string | null): void {
    this.token = token;
  }

  async listMessages(): Promise<DpMessage[]> {
    const data = await this.request<{ messages?: unknown[] }>('GET', '/api/messages?limit=500');
    return (data.messages ?? []).map(parseMessage).filter((m): m is DpMessage => m !== null);
  }

  /** Confirma "li e estou ciente" (só vale com funcionário logado). */
  async confirmarCiencia(messageId: string): Promise<string> {
    const data = await this.request<{ cienteEm: string }>(
      'POST',
      `/api/messages/${encodeURIComponent(messageId)}/ciencia`,
    );
    return data.cienteEm;
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

  /**
   * Envia uma imagem ou vídeo direto do disco, em partes. Não há limite de
   * tamanho: o arquivo nunca é carregado inteiro nem aqui nem no servidor.
   */
  /** duracaoMs: só na mensagem de voz (o WEBM gravado não traz a duração no arquivo) */
  async enviarMidia(caminho: string, mimeType: string, nome: string, duracaoMs?: number): Promise<MidiaPublica> {
    const headers: Record<string, string> = { 'Content-Type': mimeType, 'X-Nome': encodeURIComponent(nome) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (duracaoMs) headers['X-Duracao'] = String(Math.round(duracaoMs));
    const { size } = await stat(caminho);

    const response = await fetch(`${this.baseUrl}/api/midias`, {
      method: 'POST',
      headers,
      body: corpoDoArquivo(caminho),
      duplex: 'half',
      signal: AbortSignal.timeout(tempoDeEnvio(size)),
    } as RequestInit & { duplex: 'half' });
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

  /** Baixa a mídia inteira (arquivo anexado a uma conversa, para abrir no Windows). */
  async baixarMidia(midiaId: string): Promise<Buffer> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}/api/midias/${encodeURIComponent(midiaId)}`, {
      headers,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new ApiError(`Erro HTTP ${response.status} ao baixar o arquivo`, response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  /** Busca a mídia no servidor repassando o cabeçalho Range (usado pelo protocolo dpmidia://). */
  async buscarMidia(midiaId: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (range) headers.Range = range;
    return fetch(`${this.baseUrl}/api/midias/${encodeURIComponent(midiaId)}`, { headers });
  }

  // ---- Chamados do funcionário (token do PC) ----

  // ---- Telas do DP/TI com o token do computador ----
  //
  // Quem é do setor do DP ou do TI usa o próprio login do aplicativo: o servidor
  // reconhece o acesso pelo setor, então estas chamadas são as mesmas da conta
  // da Central, só que com a credencial do computador.

  async filaChamados(incluirEncerrados: boolean): Promise<ChamadoResumo[]> {
    const data = await this.request<{ chamados?: ChamadoResumo[] }>(
      'GET',
      `/api/chamados/fila?encerrados=${incluirEncerrados ? 'true' : 'false'}`,
    );
    return data.chamados ?? [];
  }

  async mudarStatusChamado(id: string, status: StatusChamado): Promise<ChamadoCompleto> {
    return this.request<ChamadoCompleto>('PUT', `/api/chamados/${encodeURIComponent(id)}/status`, { status });
  }

  /**
   * Assume o atendimento. Existe aqui para o processo principal poder chamar
   * com qualquer um dos dois clientes; quem não é do TI leva 403 do servidor.
   */
  async aceitarChamado(id: string): Promise<ChamadoCompleto> {
    return this.request<ChamadoCompleto>('POST', `/api/chamados/${encodeURIComponent(id)}/aceitar`);
  }

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

  /** Anexo de comunicado (imagem ou documento), do disco e em partes. */
  async enviarAnexo(caminho: string, nome: string): Promise<{ id: string; name: string; size: number }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(nome),
      'X-File-Type': tipoDeAnexo(nome),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const { size } = await stat(caminho);

    const response = await fetch(`${this.baseUrl}/api/attachments`, {
      method: 'POST',
      headers,
      body: corpoDoArquivo(caminho),
      duplex: 'half',
      signal: AbortSignal.timeout(tempoDeEnvio(size)),
    } as RequestInit & { duplex: 'half' });
    const data = (await response.json().catch(() => ({}))) as {
      attachment?: { id: string; name: string; size: number };
      message?: string;
    };
    if (!response.ok || !data.attachment) throw new ApiError(data.message ?? `Erro HTTP ${response.status}`, response.status);
    return data.attachment;
  }

  async listarChamados(): Promise<ChamadoResumo[]> {
    const data = await this.request<{ chamados?: ChamadoResumo[] }>('GET', '/api/chamados');
    return data.chamados ?? [];
  }

  async abrirChamado(dados: NovoChamadoInput): Promise<ChamadoCompleto> {
    return this.request<ChamadoCompleto>('POST', '/api/chamados', dados);
  }

  async detalheChamado(id: string): Promise<ChamadoCompleto> {
    return this.request<ChamadoCompleto>('GET', `/api/chamados/${encodeURIComponent(id)}`);
  }

  async responderChamado(id: string, conteudo: string): Promise<void> {
    await this.request('POST', `/api/chamados/${encodeURIComponent(id)}/mensagens`, { conteudo });
  }

  async fecharChamado(id: string): Promise<ChamadoCompleto> {
    return this.request<ChamadoCompleto>('PUT', `/api/chamados/${encodeURIComponent(id)}/status`, { status: 'FECHADO' });
  }

  async marcarChamadoLido(id: string): Promise<void> {
    await this.request('POST', `/api/chamados/${encodeURIComponent(id)}/lidas`);
  }
}
