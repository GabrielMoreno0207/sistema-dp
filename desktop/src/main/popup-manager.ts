import { app, screen, type BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { PopupChannels } from '../shared/popup-channels';
import type { DpMessage, PopupState } from '../shared/types';

/** Tamanho de notificação (o card tem 380x150; o resto é margem para a sombra) */
const POPUP_SIZE = { width: 400, height: 170 };
const MARGIN = 6;

/**
 * Fila de alertas de novas mensagens.
 * Mostra uma mensagem por vez, no tamanho de uma notificação, no canto inferior direito,
 * sempre por cima das outras janelas e com som (tocado pela interface do popup).
 * URGENTE fura a fila.
 */
export class PopupManager extends EventEmitter<{ view: [string] }> {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private queue: DpMessage[] = [];
  /** Quantas mensagens já saíram da fila no lote atual (para mostrar "2 de 3") */
  private handledInBatch = 0;
  private quitting = false;

  constructor(private readonly createWindow: () => BrowserWindow) {
    super();
    app.on('before-quit', () => {
      this.quitting = true;
    });
  }

  getState(): PopupState {
    return {
      current: this.queue[0] ?? null,
      position: this.handledInBatch + 1,
      total: this.handledInBatch + this.queue.length,
    };
  }

  enqueue(messages: DpMessage[]): void {
    let added = false;
    for (const message of messages) {
      if (message.read || this.queue.some((m) => m.id === message.id)) continue;
      if (message.type === 'URGENTE') {
        const firstNonUrgent = this.queue.findIndex((m) => m.type !== 'URGENTE');
        this.queue.splice(firstNonUrgent === -1 ? this.queue.length : firstNonUrgent, 0, message);
      } else {
        this.queue.push(message);
      }
      added = true;
    }
    if (added) this.render();
  }

  /** Esvazia a fila (ex.: funcionário saiu; os alertas eram da pessoa anterior). */
  clear(): void {
    if (this.queue.length === 0) return;
    this.queue = [];
    this.render();
  }

  /** Tira a mensagem da fila (fechada no popup ou lida na janela principal). */
  remove(messageId: string): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((m) => m.id !== messageId);
    if (this.queue.length === before) return;
    this.handledInBatch += 1;
    this.render();
  }

  view(messageId: string): void {
    this.remove(messageId);
    this.emit('view', messageId);
  }

  private render(): void {
    if (this.queue.length === 0) {
      this.handledInBatch = 0;
      this.win?.hide();
      this.send();
      return;
    }

    const win = this.ensureWindow();
    this.placeWindow(win);
    this.send();
    if (this.loaded) this.reveal(win);
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;

    const win = this.createWindow();
    this.loaded = false;
    win.webContents.once('did-finish-load', () => {
      this.loaded = true;
      this.send();
      if (this.queue.length > 0) this.reveal(win);
    });
    // Alt+F4 no alerta equivale a "Fechar": dispensa a mensagem atual sem perder o resto da fila
    win.on('close', (event) => {
      if (this.quitting) return;
      event.preventDefault();
      const current = this.queue[0];
      if (current) this.remove(current.id);
      else win.hide();
    });
    win.on('closed', () => {
      this.win = null;
      this.loaded = false;
    });
    this.win = win;
    return win;
  }

  private reveal(win: BrowserWindow): void {
    win.setAlwaysOnTop(true, 'screen-saver');
    // showInactive: aparece por cima de tudo sem roubar o foco de quem está digitando
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
  }

  /** Canto inferior direito da área de trabalho (acima da barra de tarefas) */
  private placeWindow(win: BrowserWindow): void {
    const { workArea } = screen.getPrimaryDisplay();
    win.setBounds({
      x: workArea.x + workArea.width - POPUP_SIZE.width - MARGIN,
      y: workArea.y + workArea.height - POPUP_SIZE.height - MARGIN,
      ...POPUP_SIZE,
    });
  }

  private send(): void {
    if (this.win && !this.win.isDestroyed() && this.loaded) {
      this.win.webContents.send(PopupChannels.Changed, this.getState());
    }
  }
}
