/** Aplicativos que recebem atualização pelo servidor. */
export const APPS = ['desktop', 'mobile', 'backend'] as const;
export type AppName = (typeof APPS)[number];

export function isAppName(value: string): value is AppName {
  return (APPS as readonly string[]).includes(value);
}

/** Versão publicada de um aplicativo. */
export interface Release {
  app: AppName;
  /** Formato x.y.z */
  versao: string;
  /** Nome do arquivo dentro da pasta do aplicativo */
  arquivo: string;
  tamanho: number;
  /** SHA-256 do arquivo, para o app conferir o download */
  sha256: string;
  /** O que mudou nesta versão (aparece no aviso de atualização) */
  notas: string;
  /** true = o app não deixa adiar a atualização */
  obrigatoria: boolean;
  publicadoEm: string;
  publicadoPor: string;
}

/** Versão publicada, como o app enxerga (sem o caminho do arquivo no servidor). */
export type ReleasePublico = Omit<Release, 'arquivo'> & { url: string };

/** Resposta da consulta "tem versão nova?" */
export interface CheckResult {
  temAtualizacao: boolean;
  versaoInstalada: string | null;
  release: ReleasePublico | null;
}

export const LIMITES = {
  /** Instaladores do desktop passam de 80 MB; o APK fica bem abaixo disso */
  maxBytes: 300 * 1024 * 1024,
  maxNotas: 4000,
  versaoPattern: '^\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}$',
  arquivoPattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$',
} as const;

const VERSAO = new RegExp(LIMITES.versaoPattern);
const ARQUIVO = new RegExp(LIMITES.arquivoPattern);

export function versaoValida(valor: string): boolean {
  return VERSAO.test(valor);
}

/** Nome de arquivo simples: sem barras, sem "..", para não escapar da pasta. */
export function arquivoValido(valor: string): boolean {
  return ARQUIVO.test(valor) && !valor.includes('..');
}

/**
 * Compara duas versões x.y.z.
 * Retorna > 0 se a primeira for maior, 0 se iguais, < 0 se menor.
 */
export function compararVersoes(a: string, b: string): number {
  const partesA = a.split('.').map(Number);
  const partesB = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diferenca = (partesA[i] ?? 0) - (partesB[i] ?? 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

/** A mais nova primeiro. */
export function ordenarPorVersao(releases: Release[]): Release[] {
  return [...releases].sort((a, b) => compararVersoes(b.versao, a.versao));
}
