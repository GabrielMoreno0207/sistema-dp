import { safeStorage } from 'electron';

/**
 * Cifra segredos locais (segredo da instalação do PC) com a proteção de dados
 * do Windows (DPAPI): só o mesmo usuário do Windows, nesta máquina, consegue ler.
 */
export function protect(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return `dpapi:${safeStorage.encryptString(value).toString('base64')}`;
  }
  console.warn('[segurança] criptografia do sistema indisponível; segredo guardado sem cifra');
  return `plain:${Buffer.from(value, 'utf-8').toString('base64')}`;
}

export function unprotect(stored: unknown): string | null {
  if (typeof stored !== 'string') return null;
  try {
    if (stored.startsWith('dpapi:')) return safeStorage.decryptString(Buffer.from(stored.slice(6), 'base64'));
    if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf-8');
  } catch (err) {
    console.error('[segurança] não foi possível ler um segredo guardado:', err);
  }
  return null;
}
