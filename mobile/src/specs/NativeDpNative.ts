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

  // ---------------------------------------------------------------- arquivos
  // Respostas com vários campos vêm como JSON (texto): o contrato fica simples e estável.

  /** Abre o seletor do Android. JSON {uri, name, mimeType, size}, ou "" se a pessoa cancelou */
  pickFile(mimeTypes: string[]): Promise<string>;
  /** Abre a câmera. JSON {uri, name, mimeType, size}, ou "" se a pessoa cancelou */
  takePhoto(): Promise<string>;
  /** Envia o arquivo como corpo binário. JSON {status, body} */
  uploadFile(url: string, token: string, uri: string, mimeType: string, headersJson: string): Promise<string>;
  /** Baixa para a pasta de cache (folder/fileName). Devolve o caminho do arquivo */
  downloadFile(url: string, token: string, folder: string, fileName: string): Promise<string>;
  /** Abre o arquivo baixado no aplicativo que cuida desse tipo. false = nenhum aplicativo abre */
  openFile(path: string, mimeType: string): Promise<boolean>;
  sha256File(path: string): Promise<string>;
  /** Foto em pé (EXIF aplicado) e reduzida. JSON {uri, width, height} */
  prepareImage(uri: string, maxSide: number): Promise<string>;
  /** Recorta o retângulo (px da imagem preparada) num quadrado outSize. Devolve o uri file:// do JPEG */
  cropImage(uri: string, x: number, y: number, width: number, height: number, outSize: number): Promise<string>;

  /** Copia o texto para a área de transferência do Android */
  copyText(text: string): void;

  // ---------------------------------------------------------------- atualização
  /** O Android permite que este app instale APKs (Android 8+ pede autorização uma vez) */
  canInstallPackages(): Promise<boolean>;
  openInstallPermissionSettings(): void;
  /** Abre a tela de instalação do Android com o APK baixado (a pessoa confirma) */
  installApk(path: string): Promise<boolean>;

  /** Uma notificação foi tocada com o app aberto (chame consumeLaunchPayload) */
  readonly onNotificationOpened: CodegenTypes.EventEmitter<string>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DpNative');
