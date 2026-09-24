import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DesktopSettings } from '../shared/types';

/** Conteúdo de config.json (em %APPDATA%/Comunicação DP) */
interface StoredConfig {
  serverUrl?: string | null;
  autoStart?: boolean;
  /** "HH:MM" da verificação diária de atualização (veio do HORARIO_ATUALIZACAO do .env) */
  horarioAtualizacao?: string | null;
}

export type LoadedConfig = DesktopSettings;

/** Endereço do servidor quando nada foi configurado (nem na tela, nem no .env) */
export const SERVIDOR_PADRAO = 'https://comunica.trinys.com.br';

function configFilePath(): string {
  return join(app.getPath('userData'), 'config.json');
}

let envLoaded = false;

/**
 * Carrega o .env (sem sobrescrever variáveis já definidas no sistema):
 * - aplicativo instalado: arquivo .env ao lado do executável (colocado pela TI)
 * - desenvolvimento: arquivo .env da pasta do projeto
 */
function loadEnvFile(): void {
  if (envLoaded) return;
  envLoaded = true;
  const file = app.isPackaged ? join(dirname(app.getPath('exe')), '.env') : join(process.cwd(), '.env');
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (err) {
    console.error(`[config] Falha ao ler ${file}:`, err);
  }
}

export function normalizeServerUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function readSavedConfig(): StoredConfig {
  const file = configFilePath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as StoredConfig;
  } catch (err) {
    console.error('[config] config.json inválido, ignorando:', err);
    return {};
  }
}

/**
 * Prioridade: valor salvo na tela Configurações (config.json) > .env / variáveis de ambiente.
 * - SERVER_URL: endereço do backend
 */
export function loadConfig(): LoadedConfig {
  loadEnvFile();
  const saved = readSavedConfig();
  const savedUrl = normalizeServerUrl(saved.serverUrl);
  const envUrl = normalizeServerUrl(process.env.SERVER_URL);

  const envHorario = process.env.HORARIO_ATUALIZACAO?.trim() || null;

  // O endereço e o horário vindos do .env são copiados para o config.json na primeira
  // leitura: assim continuam valendo depois que uma atualização do app substitui a
  // pasta de instalação (e o .env que estava ao lado do executável some).
  const faltaUrl = !savedUrl && envUrl;
  const faltaHorario = !saved.horarioAtualizacao && envHorario;
  if (faltaUrl || faltaHorario) {
    const next: StoredConfig = {
      ...saved,
      ...(faltaUrl ? { serverUrl: envUrl } : {}),
      ...(faltaHorario ? { horarioAtualizacao: envHorario } : {}),
    };
    try {
      writeFileSync(configFilePath(), JSON.stringify(next, null, 2), 'utf-8');
      console.log('[config] valores do .env copiados para config.json');
    } catch (err) {
      console.error('[config] falha ao gravar config.json:', err);
    }
  }

  return {
    serverUrl: savedUrl ?? envUrl ?? SERVIDOR_PADRAO,
    autoStart: typeof saved.autoStart === 'boolean' ? saved.autoStart : true,
  };
}

export function saveConfig(settings: DesktopSettings): void {
  // Mantém o que a tela não edita (ex.: horário de atualização)
  const next: StoredConfig = { ...readSavedConfig(), serverUrl: settings.serverUrl, autoStart: settings.autoStart };
  writeFileSync(configFilePath(), JSON.stringify(next, null, 2), 'utf-8');
}

/** Horário da verificação diária de atualização: config.json, depois o .env (null = padrão 03:00) */
export function horarioAtualizacao(): string | null {
  loadEnvFile();
  return readSavedConfig().horarioAtualizacao ?? (process.env.HORARIO_ATUALIZACAO?.trim() || null);
}
