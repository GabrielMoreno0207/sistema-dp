import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron';
import { join } from 'node:path';

/** Caminho de um arquivo da pasta resources/ (em dev e no aplicativo instalado). */
export function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'resources', name) : join(app.getAppPath(), 'resources', name);
}

export function loadIcon(name: string): NativeImage {
  return nativeImage.createFromPath(resourcePath(name));
}

interface TrayHandlers {
  open(): void;
  quit(): void;
}

/** Ícone na bandeja do Windows, com contador de não lidas no menu e na dica. */
export class AppTray {
  private readonly tray: Tray;
  private readonly icons = { normal: loadIcon('tray.png'), unread: loadIcon('tray-unread.png') };

  constructor(private readonly handlers: TrayHandlers) {
    this.tray = new Tray(this.icons.normal);
    this.tray.on('click', handlers.open);
    this.tray.on('double-click', handlers.open);
    this.update(0, 0, 'Conectando...');
  }

  /** unreadAnnouncements: comunicados não lidos; unreadChat: mensagens do DP no chat não lidas */
  update(unreadAnnouncements: number, unreadChat: number, connectionLabel: string, employeeName: string | null = null): void {
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const announcementsLabel =
      unreadAnnouncements === 0 ? 'Nenhum comunicado não lido' : plural(unreadAnnouncements, 'comunicado não lido', 'comunicados não lidos');
    const chatLabel = unreadChat === 0 ? 'Nenhuma mensagem nova do DP' : plural(unreadChat, 'mensagem nova do DP', 'mensagens novas do DP');
    const employeeLabel = `👤 ${employeeName ?? 'Sem identificação'}`;

    this.tray.setImage(unreadAnnouncements + unreadChat > 0 ? this.icons.unread : this.icons.normal);
    this.tray.setToolTip(
      `Comunicação DP\n${employeeName ?? 'Sem identificação'}\n${announcementsLabel}\n${chatLabel}\n${connectionLabel}`,
    );
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: employeeLabel, enabled: false },
        { label: announcementsLabel, enabled: false },
        { label: chatLabel, enabled: false },
        { label: connectionLabel, enabled: false },
        { type: 'separator' },
        { label: 'Abrir Comunicação DP', click: this.handlers.open },
        { type: 'separator' },
        { label: 'Sair', click: this.handlers.quit },
      ]),
    );
  }
}
