import { app, screen, type BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { PopupChannels } from '../shared/popup-channels';
import type { AtualizacaoEmAndamento, AvisoMensagem, DpMessage, ItemAlerta, MuralPost, PopupState } from '../shared/types';

/**
 * Tamanho de notificação (o card tem 380x150; o resto é margem para a sombra).
 * É só o tamanho inicial: assim que a tela do alerta mede o cartão, a janela
 * passa a acompanhar o conteúdo — comunicado com anexo e pedido de ciência tem
 * duas linhas a mais e, na altura fixa, o título saía cortado ao meio.
 */
const POPUP_SIZE = { width: 400, height: 170 };
/** O aviso da atualização tem uma linha a mais (o que fazer se não abrir sozinho) */
const POPUP_SIZE_ATUALIZACAO = { width: 400, height: 196 };
/** Limites de segurança: alerta nunca vira uma tarja minúscula nem uma parede */
const ALTURA_MINIMA = 120;
const ALTURA_MAXIMA = 360;
const MARGIN = 6;
/** Só existe um aviso de atualização por vez */
const CHAVE_ATUALIZACAO = 'atualizacao';

/** Chave única do alerta na fila. */
function chaveDo(item: ItemAlerta): string {
  if (item.tipo === 'COMUNICADO') return item.comunicado.id;
  if (item.tipo === 'MENSAGEM') return item.mensagem.id;
  // A data da edição entra na chave: recado alterado é alerta novo
  if (item.tipo === 'MURAL') return `mural:${item.post.id}:${item.post.updatedAt}`;
  return CHAVE_ATUALIZACAO;
}

/**
 * Fila de alertas: comunicados do DP, mensagens novas do chat e o aviso da
 * atualização.
 * Mostra um por vez, no tamanho de uma notificação, no canto inferior direito,
 * sempre por cima das outras janelas e com som (tocado pela interface do popup).
 * Comunicado URGENTE fura a fila.
 */
export class PopupManager extends EventEmitter<{ view: [string]; conversa: [string]; mural: [] }> {
  private win: BrowserWindow | null = null;
  private loaded = false;
  private queue: ItemAlerta[] = [];
  /** Quantas mensagens já saíram da fila no lote atual (para mostrar "2 de 3") */
  private handledInBatch = 0;
  /** Altura do cartão medida pela tela do alerta (null = ainda não mediu) */
  private alturaMedida: number | null = null;
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

  /**
   * Recado do mural novo ou alterado: um alerta igual ao do comunicado, com
   * "Visualizar". Só o último vale — trocar o recado duas vezes seguidas não
   * enfileira dois avisos do mesmo mural.
   */
  enfileirarMural(post: MuralPost): void {
    const chave = `mural:${post.id}:${post.updatedAt}`;
    if (this.queue.some((item) => chaveDo(item) === chave)) return;
    this.queue = this.queue.filter((item) => item.tipo !== 'MURAL');
    this.queue.push({ tipo: 'MURAL', post });
    this.render();
  }

  /** Mensagem nova do chat: entra no fim da fila, sem furar a dos comunicados. */
  enfileirarMensagem(aviso: AvisoMensagem): void {
    if (this.queue.some((item) => chaveDo(item) === aviso.id)) return;
    this.queue.push({ tipo: 'MENSAGEM', mensagem: aviso });
    this.render();
  }

  /**
   * Aviso de que a versão nova está sendo instalada (ou null para tirá-lo, quando
   * o instalador não sobe). Entra na frente de tudo: o aplicativo fecha em
   * seguida, e este é o alerta que explica o que está acontecendo.
   */
  avisarAtualizacao(info: AtualizacaoEmAndamento | null): void {
    const semAviso = this.queue.filter((item) => item.tipo !== 'ATUALIZACAO');
    this.queue = info ? [{ tipo: 'ATUALIZACAO', info }, ...semAviso] : semAviso;
    this.render();
  }

  /** Esvazia a fila (ex.: funcionário saiu; os alertas eram da pessoa anterior). */
  clear(): void {
    if (this.queue.length === 0) return;
    // O aviso da atualização fica: não é mensagem de ninguém, é o aplicativo de saída
    this.queue = this.queue.filter((item) => item.tipo === 'ATUALIZACAO');
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
    // O aviso da atualização não tem o que abrir: fechar é tudo o que ele faz
    if (alvo.tipo === 'ATUALIZACAO') return;
    if (alvo.tipo === 'MURAL') this.emit('mural');
    else if (alvo.tipo === 'MENSAGEM') this.emit('conversa', alvo.mensagem.conversaId);
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

  /**
   * Altura que a tela do alerta pediu, depois de medir o cartão. Assim o
   * conteúdo manda no tamanho da janela, e não o contrário.
   */
  definirAltura(altura: number): void {
    if (!Number.isFinite(altura)) return;
    const alvo = Math.min(ALTURA_MAXIMA, Math.max(ALTURA_MINIMA, Math.ceil(altura)));
    if (alvo === this.alturaMedida) return;
    this.alturaMedida = alvo;
    if (this.win && !this.win.isDestroyed()) this.placeWindow(this.win);
  }

  /** Canto inferior direito da área de trabalho (acima da barra de tarefas) */
  private placeWindow(win: BrowserWindow): void {
    const { workArea } = screen.getPrimaryDisplay();
    const padrao = this.queue[0]?.tipo === 'ATUALIZACAO' ? POPUP_SIZE_ATUALIZACAO : POPUP_SIZE;
    const height = this.alturaMedida ?? padrao.height;
    win.setBounds({
      x: workArea.x + workArea.width - padrao.width - MARGIN,
      y: workArea.y + workArea.height - height - MARGIN,
      width: padrao.width,
      height,
    });
  }

  private send(): void {
    if (this.win && !this.win.isDestroyed() && this.loaded) {
      this.win.webContents.send(PopupChannels.Changed, this.getState());
    }
  }
}
