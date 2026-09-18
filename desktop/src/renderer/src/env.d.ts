import type { DesktopApi, PopupApi } from '../../shared/types';

declare global {
  interface Window {
    /** Janela principal (preload/index.ts) */
    dp: DesktopApi;
    /** Popup de alerta (preload/popup.ts) */
    dpPopup: PopupApi;
  }
}

export {};
