/** Leitura de colunas de uma linha, igual para SQLite e PostgreSQL. */

export type Row = Record<string, unknown>;

/** Lê uma coluna de texto obrigatória. */
export function text(row: Row, column: string): string {
  return String(row[column]);
}

/** Lê uma coluna de texto que pode ser nula. */
export function nullableText(row: Row, column: string): string | null {
  const value = row[column];
  return value === null || value === undefined ? null : String(value);
}
