import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
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
  confirmarCiencia: (messageId) => ipcRenderer.invoke(IpcChannels.ConfirmarCiencia, messageId),
  onConnectionChange: (listener) => subscribe(IpcChannels.ConnectionChanged, listener),
  onMessagesChange: (listener) => subscribe(IpcChannels.MessagesChanged, listener),
  onOpenMessage: (listener) => subscribe(IpcChannels.OpenMessage, listener),
  onOpenConversa: (listener) => subscribe(IpcChannels.OpenConversa, listener),
  conversaEmFoco: (conversaId) => ipcRenderer.send(IpcChannels.ConversaEmFoco, conversaId),

  janelaMinimizar: () => ipcRenderer.send(IpcChannels.JanelaMinimizar),
  janelaMaximizar: () => ipcRenderer.invoke(IpcChannels.JanelaMaximizar),
  janelaEsconder: () => ipcRenderer.send(IpcChannels.JanelaEsconder),
  janelaFechar: (senha) => ipcRenderer.invoke(IpcChannels.JanelaFechar, senha),
  janelaEstaMaximizada: () => ipcRenderer.invoke(IpcChannels.JanelaEstado),
  onPedirSenhaParaFechar: (listener) => subscribe(IpcChannels.PedirSenhaParaFechar, listener),
  onAtualizacaoInstalando: (listener) => subscribe(IpcChannels.AtualizacaoInstalando, listener),

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


  criarAtalho: (dados) => ipcRenderer.invoke(IpcChannels.AtalhoCreate, dados),
  atualizarAtalho: (id, dados) => ipcRenderer.invoke(IpcChannels.AtalhoUpdate, { id, dados }),
  removerAtalho: (id) => ipcRenderer.invoke(IpcChannels.AtalhoDelete, id),
  reordenarAtalhos: (ids) => ipcRenderer.invoke(IpcChannels.AtalhoReorder, ids),
  onAtalhosChange: (listener) => subscribe(IpcChannels.AtalhosChanged, listener),
  onMuralChange: (listener) => subscribe(IpcChannels.MuralChanged, listener),
  muralReagir: (postId, emoji) => ipcRenderer.invoke(IpcChannels.MuralReagir, { postId, emoji }),
  escolherFoto: () => ipcRenderer.invoke(IpcChannels.FotoEscolher),
  fotoAtual: () => ipcRenderer.invoke(IpcChannels.FotoAtual),
  salvarFoto: (jpeg) => ipcRenderer.invoke(IpcChannels.FotoSalvar, jpeg),
  removerFoto: () => ipcRenderer.invoke(IpcChannels.FotoRemove),
  onFotoChange: (listener) => subscribe(IpcChannels.FotoChanged, listener),

  listarChamados: () => ipcRenderer.invoke(IpcChannels.ChamadosList),
  abrirChamado: (dados) => ipcRenderer.invoke(IpcChannels.ChamadoAbrir, dados),
  detalheChamado: (id) => ipcRenderer.invoke(IpcChannels.ChamadoDetalhe, id),
  responderChamado: (id, conteudo) => ipcRenderer.invoke(IpcChannels.ChamadoResponder, { id, conteudo }),
  fecharChamado: (id) => ipcRenderer.invoke(IpcChannels.ChamadoFechar, id),
  marcarChamadoLido: (id) => ipcRenderer.invoke(IpcChannels.ChamadoLidas, id),
  enviarImagemChamado: () => ipcRenderer.invoke(IpcChannels.ChamadoEnviarImagem),
  onChamadosChange: (listener) => subscribe(IpcChannels.ChamadosChanged, listener),

  adminLogin: (username, password) => ipcRenderer.invoke(IpcChannels.AdminLogin, { username, password }),
  adminLogout: () => ipcRenderer.invoke(IpcChannels.AdminLogout),
  onAdminChange: (listener) => subscribe(IpcChannels.AdminChanged, listener),
  adminFila: (incluirEncerrados) => ipcRenderer.invoke(IpcChannels.AdminFila, incluirEncerrados),
  adminChamadoDetalhe: (id) => ipcRenderer.invoke(IpcChannels.AdminChamadoDetalhe, id),
  adminResponderChamado: (id, conteudo) => ipcRenderer.invoke(IpcChannels.AdminChamadoResponder, { id, conteudo }),
  adminMudarStatus: (id, status) => ipcRenderer.invoke(IpcChannels.AdminChamadoStatus, { id, status }),
  adminListarMural: () => ipcRenderer.invoke(IpcChannels.AdminMuralList),
  adminSalvarMural: (dados) => ipcRenderer.invoke(IpcChannels.AdminMuralSalvar, dados),
  adminRemoverMural: (id) => ipcRenderer.invoke(IpcChannels.AdminMuralRemover, id),
  adminEnviarMidia: () => ipcRenderer.invoke(IpcChannels.AdminMuralMidia),
  adminApi: (method, path, body) => ipcRenderer.invoke(IpcChannels.AdminApi, { method, path, body }),
  adminAnexar: () => ipcRenderer.invoke(IpcChannels.AdminAnexo),

  conversasApi: (method, path, body) => ipcRenderer.invoke(IpcChannels.ConversasApi, { method, path, body }),
  // Mesma porta de entrada das conversas: a rota é conferida no processo principal
  agendaApi: (method, path, body) => ipcRenderer.invoke(IpcChannels.ConversasApi, { method, path, body }),
  conversasIdentidade: () => ipcRenderer.invoke(IpcChannels.ConversasIdentidade),
  conversasAnexar: () => ipcRenderer.invoke(IpcChannels.ConversasAnexar),
  conversasSoltarArquivo: (caminho) => ipcRenderer.invoke(IpcChannels.ConversasSoltarArquivo, caminho),
  conversasColarImagem: (dados, mimeType) => ipcRenderer.invoke(IpcChannels.ConversasColarImagem, { dados, mimeType }),
  conversasCopiarImagem: (midiaId) => ipcRenderer.invoke(IpcChannels.ConversasCopiarImagem, midiaId),
  conversasEnviarAudio: (dados, mimeType, duracaoMs) =>
    ipcRenderer.invoke(IpcChannels.ConversasEnviarAudio, { dados, mimeType, duracaoMs }),
  // O objeto File do navegador não traz o caminho do arquivo; no Electron vem daqui
  caminhoDoArquivo: (arquivo) => webUtils.getPathForFile(arquivo),
  conversasAbrirArquivo: (midiaId, nome) => ipcRenderer.invoke(IpcChannels.ConversasAbrirArquivo, { midiaId, nome }),
  onConversasChange: (listener) => subscribe(IpcChannels.ConversasChanged, listener),
  onConversasContador: (listener) => subscribe(IpcChannels.ConversasContador, listener),
  abrirLink: (url) => ipcRenderer.invoke(IpcChannels.AbrirLink, url),
  copiarTexto: (texto) => ipcRenderer.invoke(IpcChannels.CopiarTexto, texto),
};

contextBridge.exposeInMainWorld('dp', api);
