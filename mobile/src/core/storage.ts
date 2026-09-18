/** Configuração do aparelho, guardada cifrada pelo Android Keystore (react-native-keychain) */
import * as Keychain from 'react-native-keychain';
import type { DeviceConfig } from './types';

const SERVICE = 'br.com.comunicacaodp.config';

const EMPTY: DeviceConfig = { serverUrl: null, deviceId: null, deviceSecret: null, lastAlertedSeq: 0 };

export async function loadConfig(): Promise<DeviceConfig> {
  try {
    const stored = await Keychain.getGenericPassword({ service: SERVICE });
    if (!stored) return { ...EMPTY };
    return { ...EMPTY, ...(JSON.parse(stored.password) as Partial<DeviceConfig>) };
  } catch (err) {
    console.warn('[config] não foi possível ler a configuração', err);
    return { ...EMPTY };
  }
}

export async function saveConfig(config: DeviceConfig): Promise<void> {
  await Keychain.setGenericPassword('dp', JSON.stringify(config), { service: SERVICE });
}
