// Versionador do Comunicação DP: publica novas versões no servidor.
// App próprio, separado do aplicativo que os funcionários usam.
const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require('electron');
const { statSync } = require('node:fs');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { basename, join } = require('node:path');
const api = require('./servidor-api');

// tema vazio = segue o Windows; "claro"/"escuro" = escolha de quem usa
const CONFIG_PADRAO = { servidor: 'http://localhost:3000', usuario: '', tema: '' };
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

/** Grava só o que mudou: o resto do arquivo (o tema, por exemplo) fica de pé. */
async function gravarConfig(mudancas) {
  const atual = await lerConfig();
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(arquivoConfig(), JSON.stringify({ ...atual, ...mudancas }, null, 2), 'utf-8');
}

function aplicarTema(tema) {
  nativeTheme.themeSource = tema === 'escuro' ? 'dark' : tema === 'claro' ? 'light' : 'system';
}

/** Cor de fundo da janela antes de a página pintar: evita o lampejo branco. */
function fundoDaJanela(tema) {
  const escuro = tema === 'escuro' || (tema !== 'claro' && nativeTheme.shouldUseDarkColors);
  return escuro ? '#0b0f13' : '#eef1f4';
}

function criarJanela(tema) {
  aplicarTema(tema);
  janela = new BrowserWindow({
    width: 1060,
    height: 780,
    // Abaixo disso a coluna da direita (quem já atualizou) desce para baixo do
    // formulário, então a janela continua utilizável menor que isso.
    minWidth: 720,
    minHeight: 560,
    title: 'Versionador — Comunicação DP',
    backgroundColor: fundoDaJanela(tema),
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  janela.loadFile(join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  const { tema } = await lerConfig();
  criarJanela(tema);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela(tema);
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

// Claro ou escuro. Vale também para as caixas de diálogo do Windows, que são
// do sistema e não da página — por isso o nativeTheme, e não só o CSS.
ipcMain.handle('tema:definir', async (_evento, tema) => {
  const escolhido = tema === 'claro' || tema === 'escuro' ? tema : '';
  await gravarConfig({ tema: escolhido });
  aplicarTema(escolhido);
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
    'mobile-ota': [{ name: 'Atualização rápida do celular', extensions: ['zip'] }],
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

ipcMain.handle('servidor:esperar', async (_evento, { servidor }) => api.esperarServidor(servidor));

ipcMain.handle('aparelhos:listar', async (_evento, { servidor }) => api.listarAparelhos(servidor, sessao.token));

ipcMain.handle('saude:consultar', async (_evento, { servidor }) => api.saude(servidor));

ipcMain.handle('versoes:obrigatoria', async (_evento, { servidor, alvo, versao, obrigatoria }) =>
  api.marcarObrigatoria(servidor, sessao.token, alvo, versao, obrigatoria),
);

/**
 * Coloca na última versão quem ficou atrás, sem esperar as 03:00 de cada
 * aparelho: marca a versão como obrigatória (aí o aplicativo não adia esperando
 * o computador ficar livre) e manda o aviso na hora para quem está conectado.
 *
 * O servidor sempre entrega a versão mais nova, nunca a seguinte, então quem
 * está três versões atrás pula direto para a última numa instalação só.
 */
ipcMain.handle('versoes:instalar-em-todos', async (_evento, { servidor, alvo, versao, atrasados, conectados }) => {
  const confirmacao = await dialog.showMessageBox(janela, {
    type: 'question',
    buttons: ['Cancelar', 'Instalar em todos'],
    defaultId: 1,
    cancelId: 0,
    title: 'Instalar em todos agora',
    message: `Instalar a versão ${versao} em todos os aparelhos agora?`,
    detail: [
      `${atrasados === 1 ? '1 aparelho está' : `${atrasados} aparelhos estão`} atrás dessa versão; ` +
        `${conectados === 1 ? '1 está ligado' : `${conectados} estão ligados`} agora.`,
      '',
      'A versão passa a ser obrigatória e o aviso sai na hora:',
      '• quem está ligado atualiza em seguida, mesmo com alguém usando o computador — o aplicativo avisa na tela, fecha, instala e volta sozinho;',
      '• quem está desligado atualiza ao abrir o aplicativo.',
    ].join('\n'),
  });
  if (confirmacao.response !== 1) return { ok: false, cancelado: true };

  // Obrigatória primeiro: se o aviso chegasse antes, o aplicativo consultaria o
  // servidor e veria a versão ainda como opcional, voltando a adiar.
  const marcada = await api.marcarObrigatoria(servidor, sessao.token, alvo, versao, true);
  if (!marcada.ok) return marcada;
  return api.avisarTodos(servidor, sessao.token, alvo);
});

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
