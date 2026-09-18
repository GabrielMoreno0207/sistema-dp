import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DesktopSettings } from '../shared/types';

/** Conteúdo de config.json (em %APPDATA%/Comunicação DP) */
interface StoredConfig {
  serverUrl?: string | null;
  autoStart?: boolean;
}

export type LoadedConfig = DesktopSettings;

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

  // O endereço vindo do .env é copiado para o config.json na primeira leitura:
  // assim continua valendo mesmo se uma atualização do app substituir a pasta de instalação.
  if (!savedUrl && envUrl) {
    const next: StoredConfig = { ...saved, serverUrl: envUrl };
    try {
      writeFileSync(configFilePath(), JSON.stringify(next, null, 2), 'utf-8');
      console.log('[config] endereço do .env copiado para config.json');
    } catch (err) {
      console.error('[config] falha ao gravar config.json:', err);
    }
  }

  return {
    serverUrl: savedUrl ?? envUrl,
    autoStart: typeof saved.autoStart === 'boolean' ? saved.autoStart : true,
  };
}

export function saveConfig(settings: DesktopSettings): void {
  const next: StoredConfig = { serverUrl: settings.serverUrl, autoStart: settings.autoStart };
  writeFileSync(configFilePath(), JSON.stringify(next, null, 2), 'utf-8');
}
