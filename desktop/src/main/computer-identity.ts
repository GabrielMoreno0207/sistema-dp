import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { ComputerInfo } from '../shared/types';
import { protect, unprotect } from './secure-storage';

const ID_PATTERN = /^PC-[A-F0-9]{8,32}$/;

interface IdentityFile {
  computerId?: string;
  /** Segredo da instalação, cifrado (ver secure-storage.ts) */
  secret?: string;
  createdAt?: string;
}

export interface ComputerIdentity {
  info: ComputerInfo;
  /** Prova de que esta é a mesma instalação que se registrou antes */
  secret: string;
}

/**
 * Identidade desta instalação, gerada na primeira execução
 * e guardada em %APPDATA%/Comunicação DP/identity.json.
 * Não usa o hostname como identificador (hostnames se repetem e mudam).
 */
export function getComputerIdentity(): ComputerIdentity {
  const file = join(app.getPath('userData'), 'identity.json');
  let data: IdentityFile = {};

  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf-8')) as IdentityFile;
    } catch (err) {
      console.error('[identidade] identity.json inválido, gerando novo:', err);
    }
  }

  let changed = false;
  let computerId = data.computerId;
  if (!computerId || !ID_PATTERN.test(computerId)) {
    computerId = `PC-${randomBytes(6).toString('hex').toUpperCase()}`;
    changed = true;
  }
  let secret = unprotect(data.secret);
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    changed = true;
  }
  if (changed) {
    const updated: IdentityFile = { computerId, secret: protect(secret), createdAt: data.createdAt ?? new Date().toISOString() };
    writeFileSync(file, JSON.stringify(updated, null, 2), 'utf-8');
  }

  return {
    info: { computerId, hostname: hostname(), appVersion: app.getVersion(), platform: process.platform },
    secret,
  };
}
