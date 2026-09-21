export type Page = 'home' | 'messages' | 'announcements' | 'profile' | 'settings';

interface ItemMenu {
  page: Page;
  label: string;
  icon: string;
}

const ITENS: ItemMenu[] = [
  { page: 'home', label: 'Início', icon: '⌂' },
  { page: 'announcements', label: 'Comunicados', icon: '◈' },
  { page: 'messages', label: 'Mensagens', icon: '✉' },
  { page: 'profile', label: 'Meu perfil', icon: '☺' },
  { page: 'settings', label: 'Configurações', icon: '⚙' },
];

interface MenuLateralProps {
  page: Page;
  /** Comunicados não lidos */
  unreadAnnouncements: number;
  /** Mensagens do DP não lidas */
  unreadChat: number;
  appVersion: string;
  onNavigate(page: Page): void;
}

export function MenuLateral({ page, unreadAnnouncements, unreadChat, appVersion, onNavigate }: MenuLateralProps) {
  const badges: Partial<Record<Page, number>> = { announcements: unreadAnnouncements, messages: unreadChat };

  return (
    <aside className="menu-lateral">
      <div className="menu-lateral__marca">
        <span className="menu-lateral__logo">DP</span>
        <div className="menu-lateral__titulo">
          <strong>Comunicação DP</strong>
          <small>Departamento Pessoal</small>
        </div>
      </div>

      <nav className="menu-lateral__nav">
        {ITENS.map((item) => {
          const badge = badges[item.page] ?? 0;
          return (
            <button
              key={item.page}
              className={`item-menu ${page === item.page ? 'item-menu--ativo' : ''}`}
              onClick={() => onNavigate(item.page)}
            >
              <span className="item-menu__icone" aria-hidden>
                {item.icon}
              </span>
              <span className="item-menu__label">{item.label}</span>
              {badge > 0 && <span className="item-menu__badge">{badge > 99 ? '99+' : badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="menu-lateral__rodape">
        <button className="item-menu item-menu--discreto" onClick={() => onNavigate('home')}>
          <span className="item-menu__icone" aria-hidden>
            ✦
          </span>
          <span className="item-menu__label">Novidades</span>
        </button>
        <button className="item-menu item-menu--discreto" onClick={() => onNavigate('messages')}>
          <span className="item-menu__icone" aria-hidden>
            ?
          </span>
          <span className="item-menu__label">Central de Ajuda</span>
        </button>
        <span className="menu-lateral__versao">versão {appVersion}</span>
      </div>
    </aside>
  );
}
