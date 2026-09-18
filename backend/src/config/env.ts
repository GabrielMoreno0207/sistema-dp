import { config as loadDotenv } from 'dotenv';
import { isAbsolute, join, resolve } from 'node:path';

/** Pasta backend/ (vale para src/ com tsx e para dist/ compilado) */
export const PROJECT_ROOT = resolve(__dirname, '..', '..');

// Lê o .env da pasta do projeto, não do diretório atual:
// assim funciona também como serviço do Windows (NSSM, Agendador de Tarefas).
loadDotenv({ path: join(PROJECT_ROOT, '.env'), quiet: true });

export type NodeEnv = 'development' | 'production';

export interface Env {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  logLevel: string;
  /** Caminho absoluto do banco (ou :memory:) */
  databasePath: string;
  /** Pasta onde ficam os arquivos e imagens anexados aos comunicados */
  uploadsPath: string;
  /** Primeiro usuário do DP, criado na inicialização se ainda não existir nenhum */
  admin: { username: string; password: string | null; name: string };
  sessionTtlHours: number;
  /** Validade da sessão do funcionário no computador (PCs compartilhados) */
  employeeSessionHours: number;
  /** HTTPS direto no backend (opcional): caminhos do certificado e da chave */
  tls: { certFile: string; keyFile: string } | null;
  /** Atrás de um proxy reverso (IIS, nginx, Caddy): confiar no X-Forwarded-For */
  trustProxy: boolean | string;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
/** Valores de exemplo do .env.example: nunca aceitos, em nenhum ambiente */
const PLACEHOLDER = /troque|exemplo|changeme/i;

function readNodeEnv(): NodeEnv {
  const value = process.env.NODE_ENV ?? 'development';
  if (value !== 'development' && value !== 'production') {
    throw new Error(`NODE_ENV inválido: "${value}". Use "development" ou "production".`);
  }
  return value;
}

function readInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} inválido: "${raw}". Use um número inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function readLogLevel(): string {
  const value = process.env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(value)) {
    throw new Error(`LOG_LEVEL inválido: "${value}". Use um de: ${LOG_LEVELS.join(', ')}.`);
  }
  return value;
}

/** Caminhos relativos no .env são relativos à pasta backend/ */
function projectPath(path: string): string {
  return isAbsolute(path) ? path : resolve(PROJECT_ROOT, path);
}

function readDatabasePath(): string {
  const value = process.env.DATABASE_PATH ?? './data/sistema-dp.db';
  return value === ':memory:' ? value : projectPath(value);
}

/** Pasta dos anexos: ao lado do banco por padrão (entra no mesmo backup) */
function readUploadsPath(): string {
  return projectPath(process.env.UPLOADS_PATH ?? './data/uploads');
}

function readAdmin(): Env['admin'] {
  const password = process.env.ADMIN_PASSWORD || null;
  if (password && password.length < 8) throw new Error('ADMIN_PASSWORD precisa ter pelo menos 8 caracteres.');
  if (password && PLACEHOLDER.test(password)) {
    throw new Error('ADMIN_PASSWORD ainda é o valor de exemplo. Defina uma senha própria.');
  }
  return {
    username: process.env.ADMIN_USERNAME?.trim() || 'admin',
    password,
    name: process.env.ADMIN_NAME?.trim() || 'Departamento Pessoal',
  };
}

function readTls(): Env['tls'] {
  const certFile = process.env.TLS_CERT_FILE?.trim();
  const keyFile = process.env.TLS_KEY_FILE?.trim();
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile) throw new Error('Para HTTPS, defina TLS_CERT_FILE e TLS_KEY_FILE juntos.');
  return { certFile: projectPath(certFile), keyFile: projectPath(keyFile) };
}

function readTrustProxy(): boolean | string {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value || value === 'false') return false;
  return value === 'true' ? true : value; // ex.: "127.0.0.1" ou "10.0.0.5,10.0.0.6"
}

export const env: Env = Object.freeze({
  nodeEnv: readNodeEnv(),
  host: process.env.SERVER_HOST ?? '0.0.0.0',
  port: readInteger('SERVER_PORT', 3000, 1, 65535),
  logLevel: readLogLevel(),
  databasePath: readDatabasePath(),
  uploadsPath: readUploadsPath(),
  admin: readAdmin(),
  sessionTtlHours: readInteger('SESSION_TTL_HOURS', 12, 1, 720),
  employeeSessionHours: readInteger('EMPLOYEE_SESSION_HOURS', 12, 1, 168),
  tls: readTls(),
  trustProxy: readTrustProxy(),
});
