export interface ThrottleRule {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
}

/** Padrão: 5 erros em 15 minutos bloqueiam novas tentativas por 5 minutos */
const DEFAULT_RULE: ThrottleRule = { maxFailures: 5, windowMs: 15 * 60 * 1000, lockMs: 5 * 60 * 1000 };

interface Entry {
  failures: number;
  firstFailureAt: number;
  lockedUntil: number;
}

/** Limita tentativas erradas por chave (ex.: usuário + IP, matrícula + PC). */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly rule: ThrottleRule = DEFAULT_RULE) {}

  /** Milissegundos restantes de bloqueio (0 = liberado) */
  blockedFor(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    if (entry.lockedUntil > now) return entry.lockedUntil - now;
    if (now - entry.firstFailureAt > this.rule.windowMs) this.entries.delete(key);
    return 0;
  }

  registerFailure(key: string, now = Date.now()): void {
    let entry = this.entries.get(key);
    if (!entry || now - entry.firstFailureAt > this.rule.windowMs) {
      entry = { failures: 0, firstFailureAt: now, lockedUntil: 0 };
    }
    entry.failures += 1;
    if (entry.failures >= this.rule.maxFailures) {
      entry.lockedUntil = now + this.rule.lockMs;
      entry.failures = 0;
      entry.firstFailureAt = now;
    }
    this.entries.set(key, entry);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  /** Remove registros vencidos (chamado periodicamente para o mapa não crescer sem limite). */
  prune(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.firstFailureAt > this.rule.windowMs) this.entries.delete(key);
    }
  }
}
