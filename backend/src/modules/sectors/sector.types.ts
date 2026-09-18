export const SECTOR_NAME_MAX = 60;
export const SECTOR_ID_PATTERN = '^[a-f0-9-]{32,36}$';

export interface Sector {
  id: string;
  name: string;
  /** Funcionários (ativos e inativos) cadastrados no setor */
  employeeCount: number;
  createdAt: string;
}

/** Remove espaços extras; vazio vira null */
export function normalizeName(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed : null;
}

/** Mesmo nome ignorando maiúsculas e acentos ("producao" = "Produção") */
export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) === 0;
}
