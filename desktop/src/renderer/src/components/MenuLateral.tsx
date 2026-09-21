export type Page =
  | 'home'
  | 'messages'
  | 'announcements'
  | 'chamados'
  | 'profile'
  | 'settings'
  // Seções da conta do DP/TI dentro do aplicativo
  | 'admin-mural'
  | 'admin-chamados';

interface ItemMenu {
  page: Page;
  label: string;
  icon: string;
}

const ITENS: ItemMenu[] = [
  { page: 'home', label: 'Início', icon: '⌂' },
  { page: 'announcements', label: 'Comunicados', icon: '◈' },
  { page: 'messages', label: 'Mensagens', icon: '✉' },
  { page: 'chamados', label: 'Chamados TI', icon: '⚑' },
  { page: 'profile', label: 'Meu perfil', icon: '☺' },
  { page: 'settings', label: 'Configurações', icon: '⚙' },
];

/** Seções que aparecem só para quem entrou com a conta do DP/TI */
const ITENS_ADMIN: (ItemMenu & { soTi?: boolean })[] = [
  { page: 'admin-mural', label: 'Mural', icon: '◉' },
  { page: 'admin-chamados', label: 'Fila do TI', icon: '⚒', soTi: true },
];

interface MenuLateralProps {
  page: Page;
  /** Comunicados não lidos */
  unreadAnnouncements: number;
  /** Mensagens do DP não lidas */
  unreadChat: number;
  /** Chamados com resposta nova para quem abriu */
  chamadosNaoLidos: number;
  /** Nome do DP/TI logado (null = ninguém) */
  adminNome: string | null;
  /** A conta logada é do TI (fila de chamados) */
  adminEhTi: boolean;
  appVersion: string;
  onNavigate(page: Page): void;
}

export function MenuLateral({
  page,
  unreadAnnouncements,
  unreadChat,
  chamadosNaoLidos,
  adminNome,
  adminEhTi,
  appVersion,
  onNavigate,
}: MenuLateralProps) {
  const badges: Partial<Record<Page, number>> = {
    announcements: unreadAnnouncements,
    messages: unreadChat,
    chamados: chamadosNaoLidos,
  };

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

      {adminNome && (
        <nav className="menu-lateral__nav menu-lateral__nav--admin" aria-label="Administração">
          <span className="menu-lateral__secao">Departamento Pessoal</span>
          {ITENS_ADMIN.filter((item) => !item.soTi || adminEhTi).map((item) => (
            <button
              key={item.page}
              className={`item-menu ${page === item.page ? 'item-menu--ativo' : ''}`}
              onClick={() => onNavigate(item.page)}
            >
              <span className="item-menu__icone" aria-hidden>
                {item.icon}
              </span>
              <span className="item-menu__label">{item.label}</span>
            </button>
          ))}
        </nav>
      )}

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
