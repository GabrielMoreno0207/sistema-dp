/**
 * Mural, mídias e atalhos da tela inicial.
 *
 * O arquivo da imagem ou do vídeo fica em disco (data/midias), como já acontece
 * com os anexos dos comunicados; o banco guarda só os dados do arquivo.
 */
import { randomBytes } from 'node:crypto';

export type MidiaTipo = 'IMAGEM' | 'VIDEO';

export interface Midia {
  id: string;
  tipo: MidiaTipo;
  /** Nome original do arquivo enviado */
  nome: string;
  mimeType: string;
  tamanho: number;
  sha256: string;
  /** Nome do arquivo dentro da pasta de mídias */
  storedName: string;
  enviadoPor: string;
  createdAt: string;
}

/** A mídia como o aplicativo enxerga (sem o caminho no servidor). */
export interface MidiaPublica {
  id: string;
  tipo: MidiaTipo;
  nome: string;
  mimeType: string;
  tamanho: number;
  url: string;
}

export interface MuralPost {
  id: string;
  titulo: string;
  texto: string;
  midiaId: string | null;
  ativo: boolean;
  criadoPor: string;
  createdAt: string;
  updatedAt: string;
}

export interface MuralPostCompleto extends Omit<MuralPost, 'midiaId'> {
  midia: MidiaPublica | null;
}

/** Para onde um atalho leva. Só telas do próprio aplicativo. */
export const DESTINOS = ['COMUNICADOS', 'CHAT', 'PERFIL', 'CONFIGURACOES', 'MURAL'] as const;
export type DestinoAtalho = (typeof DESTINOS)[number];

export interface Atalho {
  id: string;
  userId: string;
  ordem: number;
  rotulo: string;
  icone: string;
  cor: string;
  destino: DestinoAtalho;
  createdAt: string;
}

export type NovoAtalho = Omit<Atalho, 'id' | 'createdAt'>;

export const MIDIA_ID_PATTERN = '^MID-[0-9a-f]{24}$';
export const MURAL_ID_PATTERN = '^MUR-[0-9a-f]{24}$';
export const ATALHO_ID_PATTERN = '^ATL-[0-9a-f]{24}$';

export const LIMITES_CONTEUDO = {
  /** Imagem do mural e foto de perfil */
  maxImagemBytes: 10 * 1024 * 1024,
  /** Vídeo do mural */
  maxVideoBytes: 200 * 1024 * 1024,
  maxTitulo: 120,
  maxTexto: 4000,
  maxRotulo: 24,
  /** Quantos atalhos cada pessoa pode ter */
  atalhosPorUsuario: 12,
  maxNomeArquivo: 160,
} as const;

/**
 * O que pode ser enviado. Fora desta lista o upload é recusado: nada de
 * executável entrando no servidor disfarçado de imagem.
 */
export const TIPOS_ACEITOS: Record<string, { tipo: MidiaTipo; extensao: string }> = {
  'image/jpeg': { tipo: 'IMAGEM', extensao: '.jpg' },
  'image/png': { tipo: 'IMAGEM', extensao: '.png' },
  'image/webp': { tipo: 'IMAGEM', extensao: '.webp' },
  'image/gif': { tipo: 'IMAGEM', extensao: '.gif' },
  'video/mp4': { tipo: 'VIDEO', extensao: '.mp4' },
  'video/webm': { tipo: 'VIDEO', extensao: '.webm' },
};

export function tipoAceito(mimeType: string): { tipo: MidiaTipo; extensao: string } | null {
  return TIPOS_ACEITOS[mimeType.toLowerCase()] ?? null;
}

export function limiteDoTipo(tipo: MidiaTipo): number {
  return tipo === 'VIDEO' ? LIMITES_CONTEUDO.maxVideoBytes : LIMITES_CONTEUDO.maxImagemBytes;
}

function novoId(prefixo: string): string {
  return `${prefixo}-${randomBytes(12).toString('hex')}`;
}

export const gerarIdMidia = () => novoId('MID');
export const gerarIdMural = () => novoId('MUR');
export const gerarIdAtalho = () => novoId('ATL');

export function midiaPublica(midia: Midia): MidiaPublica {
  return {
    id: midia.id,
    tipo: midia.tipo,
    nome: midia.nome,
    mimeType: midia.mimeType,
    tamanho: midia.tamanho,
    url: `/api/midias/${midia.id}`,
  };
}
