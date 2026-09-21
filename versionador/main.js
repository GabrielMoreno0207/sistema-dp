// Versionador do Comunicação DP: publica novas versões no servidor.
// App próprio, separado do aplicativo que os funcionários usam.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { statSync } = require('node:fs');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { basename, join } = require('node:path');
const api = require('./servidor-api');

const CONFIG_PADRAO = { servidor: 'http://localhost:3000', usuario: '' };
let janela = null;
let sessao = { token: null, nome: null };

function arquivoConfig() {
  return join(app.getPath('userData'), 'config.json');
}

async function lerConfig() {
  try {
    return { ...CONFIG_PADRAO, ...JSON.parse(await readFile(arquivoConfig(), 'utf-8')) };
  } catch {
    return { ...CONFIG_PADRAO };
  }
}

async function gravarConfig(config) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(arquivoConfig(), JSON.stringify(config, null, 2), 'utf-8');
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 720,
    height: 600,
    minWidth: 640,
    minHeight: 520,
    title: 'Versionador — Comunicação DP',
    backgroundColor: '#0b0e11',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  janela.loadFile(join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  criarJanela();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------- ações vindas da tela

ipcMain.handle('config:ler', async () => lerConfig());

ipcMain.handle('config:gravar', async (_evento, config) => {
  await gravarConfig({ servidor: String(config.servidor || '').trim(), usuario: String(config.usuario || '').trim() });
  return true;
});

ipcMain.handle('sessao:entrar', async (_evento, { servidor, usuario, senha }) => {
  const resultado = await api.entrar(servidor, usuario, senha);
  if (!resultado.ok) return resultado;
  sessao = { token: resultado.token, nome: resultado.nome };
  await gravarConfig({ servidor, usuario });
  return { ok: true, nome: sessao.nome };
});

ipcMain.handle('sessao:sair', async () => {
  sessao = { token: null, nome: null };
  return true;
});

ipcMain.handle('versoes:listar', async (_evento, { servidor, alvo }) => api.listar(servidor, sessao.token, alvo));

ipcMain.handle('arquivo:escolher', async (_evento, alvo) => {
  const filtros = {
    desktop: [{ name: 'Instalador do Windows', extensions: ['exe'] }],
    mobile: [{ name: 'Aplicativo Android', extensions: ['apk'] }],
    backend: [{ name: 'Pacote do servidor', extensions: ['tar', 'gz', 'tgz', 'zip'] }],
  };
  const escolha = await dialog.showOpenDialog(janela, {
    title: 'Escolha o arquivo da nova versão',
    properties: ['openFile'],
    filters: [...(filtros[alvo] ?? []), { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  if (escolha.canceled || escolha.filePaths.length === 0) return null;
  const caminho = escolha.filePaths[0];
  return { caminho, nome: basename(caminho), tamanho: statSync(caminho).size };
});

ipcMain.handle('versoes:publicar', async (evento, { servidor, alvo, caminho, versao, notas, obrigatoria }) =>
  api.publicar(servidor, sessao.token, alvo, { caminho, versao, notas, obrigatoria }, (porcentagem) =>
    evento.sender.send('publicacao:progresso', porcentagem),
  ),
);

ipcMain.handle('versoes:remover', async (_evento, { servidor, alvo, versao }) => {
  const confirmacao = await dialog.showMessageBox(janela, {
    type: 'warning',
    buttons: ['Cancelar', 'Tirar do ar'],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirmar remoção',
    message: `Tirar do ar a versão ${versao} do ${alvo}?`,
    detail: 'O arquivo é apagado do servidor. Quem já instalou continua com ela; quem ainda não atualizou deixa de recebê-la.',
  });
  if (confirmacao.response !== 1) return { ok: false, cancelado: true };

  return api.remover(servidor, sessao.token, alvo, versao);
});
