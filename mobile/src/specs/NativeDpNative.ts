/**
 * Módulo nativo (Kotlin) do app: serviço em segundo plano, início automático,
 * notificações e atalhos para as configurações do Android.
 * Implementação: android/app/src/main/java/br/com/comunicacaodp/DpModule.kt
 */
import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type DeviceInfo = {
  manufacturer: string;
  model: string;
  androidVersion: string;
  sdkInt: number;
  appVersion: string;
};

export interface Spec extends TurboModule {
  /** Inicia o serviço em primeiro plano que mantém a conexão (notificação fixa) */
  startService(): void;
  stopService(): void;
  isServiceRunning(): Promise<boolean>;
  /** Liga/desliga o início automático do serviço quando o celular é ligado */
  setAutostart(enabled: boolean): void;
  /** Texto da notificação fixa do serviço */
  updateServiceStatus(text: string): void;

  getDeviceInfo(): Promise<DeviceInfo>;
  /** Bytes aleatórios seguros (SecureRandom), em hexadecimal maiúsculo */
  randomHex(bytes: number): Promise<string>;

  areNotificationsEnabled(): Promise<boolean>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): void;
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): void;
  openNotificationSettings(): void;
  openAppSettings(): void;
  /** Abre a tela de "início automático" da marca (Xiaomi, Samsung, Motorola...). false = abriu os detalhes do app */
  openAutostartSettings(): Promise<boolean>;

  /** channel: comunicados | urgentes | chat. payload volta para o app quando a notificação é tocada */
  showNotification(id: number, channel: string, title: string, body: string, fullScreen: boolean, payload: string): Promise<boolean>;
  cancelNotification(id: number): void;
  playAlertSound(): void;
  /** Payload da notificação que abriu o app (uma vez só). "" = nenhum */
  consumeLaunchPayload(): Promise<string>;

  /** Uma notificação foi tocada com o app aberto (chame consumeLaunchPayload) */
  readonly onNotificationOpened: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DpNative');
