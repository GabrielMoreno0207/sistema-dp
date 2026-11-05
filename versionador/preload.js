// Ponte entre a tela e o processo principal. A tela não enxerga Node diretamente.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('versionador', {
  lerConfig: () => ipcRenderer.invoke('config:ler'),
  gravarConfig: (config) => ipcRenderer.invoke('config:gravar', config),
  entrar: (dados) => ipcRenderer.invoke('sessao:entrar', dados),
  sair: () => ipcRenderer.invoke('sessao:sair'),
  listar: (dados) => ipcRenderer.invoke('versoes:listar', dados),
  escolherArquivo: (alvo) => ipcRenderer.invoke('arquivo:escolher', alvo),
  esperarServidor: (dados) => ipcRenderer.invoke('servidor:esperar', dados),
  publicar: (dados) => ipcRenderer.invoke('versoes:publicar', dados),
  remover: (dados) => ipcRenderer.invoke('versoes:remover', dados),
  marcarObrigatoria: (dados) => ipcRenderer.invoke('versoes:obrigatoria', dados),
  instalarEmTodos: (dados) => ipcRenderer.invoke('versoes:instalar-em-todos', dados),
  listarAparelhos: (dados) => ipcRenderer.invoke('aparelhos:listar', dados),
  saude: (dados) => ipcRenderer.invoke('saude:consultar', dados),
  definirTema: (tema) => ipcRenderer.invoke('tema:definir', tema),
  // Arquivo arrastado para a janela: do Electron 32 em diante o caminho não
  // vem mais no objeto File, só por aqui.
  caminhoDoArquivo: (arquivo) => webUtils.getPathForFile(arquivo),
  aoProgredir: (callback) => ipcRenderer.on('publicacao:progresso', (_evento, valor) => callback(valor)),
});
