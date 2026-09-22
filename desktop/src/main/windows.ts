import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';

type Page = 'index' | 'popup';

/** Cada janela recebe só o preload (e a API) de que precisa */
function secureWebPreferences(preload: 'index' | 'popup'): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload: join(__dirname, `../preload/${preload}.js`),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  };
}

function loadPage(win: BrowserWindow, page: Page): void {
  // A interface nunca navega para fora nem abre janelas novas
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}.html`);
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}.html`));
  }
}

/**
 * Janela principal sem a moldura do Windows: a barra de título é a do próprio
 * sistema (ver BarraSuperior), com os botões de minimizar, maximizar e fechar.
 * A janela continua redimensionável pelas bordas.
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: 'Comunica Trinys',
    show: false,
    frame: false,
    backgroundColor: '#0e151b',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences('index'),
  });
  loadPage(win, 'index');
  return win;
}

/** Janela do alerta: sem moldura, transparente, sempre por cima e fora da barra de tarefas. */
export function createPopupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 170,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Nova mensagem do DP',
    webPreferences: {
      ...secureWebPreferences('popup'),
      autoplayPolicy: 'no-user-gesture-required', // o som toca sem clique
      backgroundThrottling: false,
    },
  });
  loadPage(win, 'popup');
  return win;
}
