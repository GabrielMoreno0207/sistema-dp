import type { ConnectionState } from '../../../shared/types';
import { ConnectionBadge } from './ConnectionBadge';

export type Page = 'home' | 'messages' | 'announcements' | 'profile' | 'settings';

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: 'home', label: 'Início', icon: '🏠' },
  { page: 'messages', label: 'Mensagens', icon: '💬' },
  { page: 'announcements', label: 'Comunicados', icon: '📢' },
  { page: 'profile', label: 'Meu perfil', icon: '👤' },
  { page: 'settings', label: 'Configurações', icon: '⚙️' },
];

interface SidebarProps {
  page: Page;
  /** Comunicados não lidos */
  unreadAnnouncements: number;
  /** Mensagens do DP no chat não lidas */
  unreadChat: number;
  connection: ConnectionState;
  employeeName: string | null;
  onNavigate(page: Page): void;
}

export function Sidebar({ page, unreadAnnouncements, unreadChat, connection, employeeName, onNavigate }: SidebarProps) {
  const badges: Partial<Record<Page, number>> = { announcements: unreadAnnouncements, messages: unreadChat };

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">DP</span>
        <div>
          <strong>Comunicação DP</strong>
          <small>Departamento Pessoal</small>
        </div>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => {
          const badge = badges[item.page] ?? 0;
          return (
            <button
              key={item.page}
              className={`nav-item ${page === item.page ? 'nav-item--active' : ''}`}
              onClick={() => onNavigate(item.page)}
            >
              <span className="nav-item__icon" aria-hidden>
                {item.icon}
              </span>
              <span className="nav-item__label">{item.label}</span>
              {badge > 0 && <span className="nav-item__badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <button className="sidebar__user" onClick={() => onNavigate('profile')} title="Meu perfil">
          <span aria-hidden>👤</span>
          <span className="sidebar__user-name">{employeeName ?? 'Sem identificação'}</span>
        </button>
        <ConnectionBadge connection={connection} />
      </div>
    </aside>
  );
}
