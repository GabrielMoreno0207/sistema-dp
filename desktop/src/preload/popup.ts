import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { PopupChannels } from '../shared/popup-channels';
import type { PopupApi, PopupState } from '../shared/types';

/**
 * Ponte do popup de alerta: só o que o popup precisa
 * (sem configurações, sem troca de servidor/chave).
 */
const api: PopupApi = {
  getPopupState: () => ipcRenderer.invoke(PopupChannels.GetState),
  onPopupChange: (listener) => {
    const handler = (_event: IpcRendererEvent, state: PopupState) => listener(state);
    ipcRenderer.on(PopupChannels.Changed, handler);
    return () => ipcRenderer.removeListener(PopupChannels.Changed, handler);
  },
  popupView: (messageId) => ipcRenderer.invoke(PopupChannels.View, messageId),
  popupDismiss: (messageId) => ipcRenderer.invoke(PopupChannels.Dismiss, messageId),
};

contextBridge.exposeInMainWorld('dpPopup', api);
