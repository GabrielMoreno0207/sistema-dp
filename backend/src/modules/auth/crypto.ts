import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

function scryptAsync(secret: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Hash de senha/segredo com scrypt e sal aleatório. Formato: scrypt$N$r$p$sal$hash */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(secret, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Segredo do computador: 256 bits aleatórios gerados pelo app (não é senha de pessoa).
 * Com essa entropia, SHA-256 já basta — e é instantâneo. O scrypt (lento de propósito, e limitado
 * pela memória: ~50 por segundo) fica só para senhas de pessoas. Assim centenas de PCs podem
 * se registrar de novo ao mesmo tempo (ex.: servidor reiniciado) sem fila.
 */
export function hashComputerSecret(secret: string): string {
  return `sha256$${createHash('sha256').update(secret).digest('hex')}`;
}

/** Confere o segredo do PC. `legacy` = estava guardado com scrypt (versões antigas) e deve ser convertido. */
export async function verifyComputerSecret(secret: string, stored: string): Promise<{ ok: boolean; legacy: boolean }> {
  if (stored.startsWith('sha256$')) return { ok: safeEqual(hashComputerSecret(secret), stored), legacy: false };
  return { ok: await verifySecret(secret, stored), legacy: true };
}

/** Hash fixo usado quando o usuário não existe, para o tempo de resposta não revelar isso */
export const DUMMY_SECRET_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

/** Token de acesso aleatório (256 bits), entregue ao cliente uma única vez */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** O banco guarda só o hash do token: um vazamento do banco não entrega sessões válidas */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Comparação em tempo constante para segredos de tamanhos diferentes */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
