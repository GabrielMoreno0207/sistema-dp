/// <reference types="vite/client" />
// O tipo acima traz as declarações do Vite, inclusive a de importar imagens
// (import foto from './foto.jpg' devolve a URL do arquivo empacotado).
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
