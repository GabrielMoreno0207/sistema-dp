// Ponte entre a tela e o processo principal. A tela não enxerga Node diretamente.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('versionador', {
  lerConfig: () => ipcRenderer.invoke('config:ler'),
  gravarConfig: (config) => ipcRenderer.invoke('config:gravar', config),
  entrar: (dados) => ipcRenderer.invoke('sessao:entrar', dados),
  sair: () => ipcRenderer.invoke('sessao:sair'),
  listar: (dados) => ipcRenderer.invoke('versoes:listar', dados),
  escolherArquivo: (alvo) => ipcRenderer.invoke('arquivo:escolher', alvo),
  publicar: (dados) => ipcRenderer.invoke('versoes:publicar', dados),
  remover: (dados) => ipcRenderer.invoke('versoes:remover', dados),
  aoProgredir: (callback) => ipcRenderer.on('publicacao:progresso', (_evento, valor) => callback(valor)),
});
