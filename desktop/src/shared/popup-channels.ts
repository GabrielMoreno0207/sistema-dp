/**
 * Canais IPC do popup de alerta. Ficam separados de IpcChannels (types.ts) para que
 * os dois preloads não importem nenhum módulo em comum: com sandbox, cada preload
 * precisa ser um arquivo único, sem chunks compartilhados.
 */
export const PopupChannels = {
  GetState: 'popup:get-state',
  Changed: 'popup:changed',
  View: 'popup:view',
  Dismiss: 'popup:dismiss',
} as const;
