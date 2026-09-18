import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

const MAX_LOG_BYTES = 1024 * 1024;
const CHECK_EVERY_WRITES = 200;

/**
 * Além do console, grava o log do processo principal em
 * %APPDATA%/Comunicação DP/logs/app.log (ajuda a diagnosticar em campo, onde não há console).
 * Rotação simples: acima de 1 MB o arquivo vira app.old.log.
 */
export function setupFileLogging(): void {
  const dir = join(app.getPath('userData'), 'logs');
  const file = join(dir, 'app.log');
  const oldFile = join(dir, 'app.old.log');
  let writes = 0;

  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return; // sem pasta de log, segue só com o console
  }

  function rotateIfNeeded(): void {
    try {
      if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) renameSync(file, oldFile);
    } catch {
      /* rotação é melhor esforço */
    }
  }

  function write(level: string, args: unknown[]): void {
    if (writes++ % CHECK_EVERY_WRITES === 0) rotateIfNeeded();
    const time = new Date().toLocaleString('sv-SE'); // 2026-09-14 10:24:00
    try {
      appendFileSync(file, `[${time}] ${level} ${format(...args)}\n`, 'utf-8');
    } catch {
      /* disco cheio / sem permissão: não derruba o app */
    }
  }

  for (const [method, level] of [
    ['log', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERROR'],
  ] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      write(level, args);
    };
  }
}
