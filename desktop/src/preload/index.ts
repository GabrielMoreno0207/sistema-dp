import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, type DesktopApi } from '../shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/**
 * Ponte entre a janela principal e o processo main.
 * A interface não tem acesso ao Node, à rede nem ao disco.
 */
const api: DesktopApi = {
  getState: () => ipcRenderer.invoke(IpcChannels.GetState),
  markAsRead: (messageId) => ipcRenderer.invoke(IpcChannels.MarkAsRead, messageId),
  onConnectionChange: (listener) => subscribe(IpcChannels.ConnectionChanged, listener),
  onMessagesChange: (listener) => subscribe(IpcChannels.MessagesChanged, listener),
  onOpenMessage: (listener) => subscribe(IpcChannels.OpenMessage, listener),

  openAttachment: (attachmentId) => ipcRenderer.invoke(IpcChannels.AttachmentOpen, attachmentId),
  saveAttachment: (attachmentId) => ipcRenderer.invoke(IpcChannels.AttachmentSave, attachmentId),
  getAttachmentImage: (attachmentId) => ipcRenderer.invoke(IpcChannels.AttachmentImage, attachmentId),

  getSettings: () => ipcRenderer.invoke(IpcChannels.GetSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IpcChannels.SaveSettings, settings),
  testServer: (serverUrl) => ipcRenderer.invoke(IpcChannels.TestServer, serverUrl),

  employeeLogin: (registration, password) => ipcRenderer.invoke(IpcChannels.EmployeeLogin, registration, password),
  employeeLogout: () => ipcRenderer.invoke(IpcChannels.EmployeeLogout),
  changePassword: (currentPassword, newPassword) =>
    ipcRenderer.invoke(IpcChannels.EmployeeChangePassword, currentPassword, newPassword),
  onEmployeeChange: (listener) => subscribe(IpcChannels.EmployeeChanged, listener),

  chatOpen: (dpUserId) => ipcRenderer.invoke(IpcChannels.ChatOpen, dpUserId),
  chatSend: (dpUserId, content) => ipcRenderer.invoke(IpcChannels.ChatSend, dpUserId, content),
  chatMarkRead: (dpUserId) => ipcRenderer.invoke(IpcChannels.ChatMarkRead, dpUserId),
  onChatChange: (listener) => subscribe(IpcChannels.ChatChanged, listener),

  criarAtalho: (dados) => ipcRenderer.invoke(IpcChannels.AtalhoCreate, dados),
  atualizarAtalho: (id, dados) => ipcRenderer.invoke(IpcChannels.AtalhoUpdate, { id, dados }),
  removerAtalho: (id) => ipcRenderer.invoke(IpcChannels.AtalhoDelete, id),
  reordenarAtalhos: (ids) => ipcRenderer.invoke(IpcChannels.AtalhoReorder, ids),
  onAtalhosChange: (listener) => subscribe(IpcChannels.AtalhosChanged, listener),
  onMuralChange: (listener) => subscribe(IpcChannels.MuralChanged, listener),
  enviarFoto: () => ipcRenderer.invoke(IpcChannels.FotoUpload),
  removerFoto: () => ipcRenderer.invoke(IpcChannels.FotoRemove),
  onFotoChange: (listener) => subscribe(IpcChannels.FotoChanged, listener),
};

contextBridge.exposeInMainWorld('dp', api);
