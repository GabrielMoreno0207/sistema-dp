import { app, screen, type BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { PopupChannels } from '../shared/popup-channels';
import type { AvisoMensagem, DpMessage, ItemAlerta, PopupState } from '../shared/types';

/** Tamanho de notificação (o card tem 380x150; o resto é margem para a sombra) */
const POPUP_SIZE = { width: 400, height: 170 };
const MARGIN = 6;

/** Chave única do alerta na fila. */
function chaveDo(item: ItemAlerta): string {
  return item.tipo === 'COMUNICADO' ? item.comunicado.id : item.mensagem.id;
}

/**
 * Fila de alertas: comunicados do DP e mensagens novas do chat.
 * Mostra um por vez, no tamanho de uma notificação, no canto inferior direito,
 * sempre por cima das outras janelas e com som (tocado pela interface do popup).
 * Comunicado URGENTE fura a fila.
 */
export class PopupManager extends EventEmitter<{ view: [string]; conversa: [string] }> {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private queue: ItemAlerta[] = [];
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
      if (message.read || this.queue.some((item) => chaveDo(item) === message.id)) continue;
      const item: ItemAlerta = { tipo: 'COMUNICADO', comunicado: message };
      if (message.type === 'URGENTE') {
        const primeiroNaoUrgente = this.queue.findIndex(
          (naFila) => !(naFila.tipo === 'COMUNICADO' && naFila.comunicado.type === 'URGENTE'),
        );
        this.queue.splice(primeiroNaoUrgente === -1 ? this.queue.length : primeiroNaoUrgente, 0, item);
      } else {
        this.queue.push(item);
      }
      added = true;
    }
    if (added) this.render();
  }

  /** Mensagem nova do chat: entra no fim da fila, sem furar a dos comunicados. */
  enfileirarMensagem(aviso: AvisoMensagem): void {
    if (this.queue.some((item) => chaveDo(item) === aviso.id)) return;
    this.queue.push({ tipo: 'MENSAGEM', mensagem: aviso });
    this.render();
  }

  /** Esvazia a fila (ex.: funcionário saiu; os alertas eram da pessoa anterior). */
  clear(): void {
    if (this.queue.length === 0) return;
    this.queue = [];
    this.render();
  }

  /** Tira o alerta da fila (fechado no popup ou lido na janela principal). */
  remove(messageId: string): void {
    const antes = this.queue.length;
    this.queue = this.queue.filter((item) => chaveDo(item) !== messageId);
    if (this.queue.length === antes) return;
    this.handledInBatch += 1;
    this.render();
  }

  /** Tira da fila os alertas de uma conversa (ex.: a pessoa abriu a conversa). */
  limparConversa(conversaId: string): void {
    const antes = this.queue.length;
    this.queue = this.queue.filter((item) => item.tipo !== 'MENSAGEM' || item.mensagem.conversaId !== conversaId);
    if (this.queue.length !== antes) this.render();
  }

  view(messageId: string): void {
    const item = this.queue.find((naFila) => chaveDo(naFila) === messageId);
    // Clique numa chave que já saiu da fila: vale para o alerta que está à vista,
    // senão o botão não faria nada e o alerta ficaria parado na tela
    const alvo = item ?? this.queue[0];
    if (!alvo) {
      this.render();
      return;
    }
    this.remove(chaveDo(alvo));
    if (alvo.tipo === 'MENSAGEM') this.emit('conversa', alvo.mensagem.conversaId);
    else this.emit('view', chaveDo(alvo));
  }

  /** "Fechar" no alerta: tira da fila e, em último caso, tira o que está à vista. */
  dispensar(messageId: string): void {
    if (this.queue.some((naFila) => chaveDo(naFila) === messageId)) {
      this.remove(messageId);
      return;
    }
    this.dispensarAtual();
  }

  /** Rede de segurança: o clique sempre mexe em alguma coisa. */
  dispensarAtual(): void {
    const atual = this.queue[0];
    if (atual) this.remove(chaveDo(atual));
    else this.render();
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
      const atual = this.queue[0];
      if (atual) this.remove(chaveDo(atual));
      else win.hide();
    });
    win.on('closed', () => {
      this.win = null;
      this.loaded = false;
    });
    // Tela do alerta travada ou derrubada: descarta a janela para a próxima
    // notificação abrir uma nova, em vez de ficar um cartão morto na tela
    win.webContents.on('render-process-gone', (_evento, detalhe) => {
      console.warn(`[alerta] a tela do alerta caiu (${detalhe.reason}); vai ser refeita na próxima`);
      this.descartarJanela();
    });
    win.on('unresponsive', () => {
      console.warn('[alerta] a tela do alerta parou de responder; refazendo');
      this.descartarJanela();
    });
    this.win = win;
    return win;
  }

  /** Fecha a janela do alerta de verdade (a fila continua como está). */
  private descartarJanela(): void {
    const win = this.win;
    this.win = null;
    this.loaded = false;
    if (win && !win.isDestroyed()) {
      win.removeAllListeners('close');
      win.destroy();
    }
    // Ainda há alerta na fila: abre uma janela nova já com ele
    if (this.queue.length > 0) this.render();
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
