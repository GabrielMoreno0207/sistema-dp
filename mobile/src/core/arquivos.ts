/**
 * Arquivos no celular: escolher (seletor ou câmera), enviar ao servidor e
 * abrir o que chegou (mídias do chat, do mural e dos chamados).
 */
import DpNative from '../specs/NativeDpNative';
import { friendly, getApi } from './connection';
import type { ArquivoLocal, MidiaPublica, OperationResult } from './types';

/** O que o servidor aceita em /api/midias (content.types) */
export const TIPOS_MIDIA_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const TIPOS_MIDIA_VIDEO = ['video/mp4', 'video/webm'];
export const TIPOS_MIDIA_ARQUIVO = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
];

/** O que o servidor aceita nos anexos de comunicado (/api/attachments) */
export const TIPOS_ANEXO_COMUNICADO = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  ...TIPOS_MIDIA_ARQUIVO.filter((t) => t !== 'application/zip'),
  'application/zip',
];

function lerEscolha(json: string): ArquivoLocal | null {
  if (!json) return null;
  const dados = JSON.parse(json) as ArquivoLocal;
  return { uri: dados.uri, name: dados.name || 'arquivo', mimeType: dados.mimeType || 'application/octet-stream', size: Number(dados.size) };
}

/** Abre o seletor do Android. null = a pessoa cancelou */
export async function escolherArquivo(tipos: string[]): Promise<{ arquivo: ArquivoLocal | null; erro?: string }> {
  try {
    const arquivo = lerEscolha(await DpNative.pickFile(tipos));
    if (arquivo && !tipos.includes(arquivo.mimeType)) {
      return { arquivo: null, erro: 'Esse tipo de arquivo não é aceito. Use imagem, vídeo MP4, PDF ou documento do Office.' };
    }
    return { arquivo };
  } catch (err) {
    return { arquivo: null, erro: err instanceof Error ? err.message : 'Não foi possível escolher o arquivo.' };
  }
}

/** Abre a câmera. null = a pessoa cancelou */
export async function tirarFoto(): Promise<{ arquivo: ArquivoLocal | null; erro?: string }> {
  try {
    return { arquivo: lerEscolha(await DpNative.takePhoto()) };
  } catch (err) {
    return { arquivo: null, erro: err instanceof Error ? err.message : 'Não foi possível usar a câmera.' };
  }
}

/** Envia imagem, vídeo ou documento para /api/midias (chat, mural, chamados, foto) */
export async function enviarMidia(
  arquivo: ArquivoLocal,
  /** Só na mensagem de voz */
  duracaoMs?: number,
): Promise<{ midia: MidiaPublica | null; message: string }> {
  const api = getApi();
  if (!api) return { midia: null, message: 'Sem conexão com o servidor.' };
  try {
    const headers: Record<string, string> = { 'X-Nome': encodeURIComponent(arquivo.name) };
    if (duracaoMs) headers['X-Duracao'] = String(Math.round(duracaoMs));
    const midia = await api.upload<MidiaPublica>('/api/midias', arquivo, headers);
    return { midia, message: '' };
  } catch (err) {
    return { midia: null, message: friendly(err, 'Não foi possível enviar o arquivo.') };
  }
}

/** Envia um anexo de comunicado (/api/attachments, só o DP) */
export async function enviarAnexoComunicado(
  arquivo: ArquivoLocal,
): Promise<{ anexo: { id: string; name: string; size: number } | null; message: string }> {
  const api = getApi();
  if (!api) return { anexo: null, message: 'Sem conexão com o servidor.' };
  try {
    const { attachment } = await api.upload<{ attachment: { id: string; name: string; size: number } }>(
      '/api/attachments',
      { ...arquivo, mimeType: 'application/octet-stream' },
      { 'X-File-Name': encodeURIComponent(arquivo.name), 'X-File-Type': arquivo.mimeType },
    );
    return { anexo: attachment, message: '' };
  } catch (err) {
    return { anexo: null, message: friendly(err, 'Não foi possível enviar o anexo.') };
  }
}

/** Baixa a mídia e abre no aplicativo do celular (galeria, player, leitor de PDF) */
export async function abrirMidia(midia: Pick<MidiaPublica, 'id' | 'nome' | 'mimeType'>): Promise<OperationResult> {
  const api = getApi();
  if (!api) return { ok: false, message: 'Sem conexão com o servidor.' };
  try {
    const caminho = await api.download(`/api/midias/${encodeURIComponent(midia.id)}`, 'midias', `${midia.id}-${midia.nome}`);
    const abriu = await DpNative.openFile(caminho, midia.mimeType);
    return abriu ? { ok: true, message: '' } : { ok: false, message: 'Nenhum aplicativo neste celular abre esse arquivo.' };
  } catch (err) {
    return { ok: false, message: friendly(err, 'Não foi possível abrir o arquivo.') };
  }
}

export function tamanhoLegivel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
