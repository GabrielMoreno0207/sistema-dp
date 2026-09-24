import { Icone, type NomeIcone } from '../lib/icones';

export type Page =
  | 'home'
  | 'messages'
  | 'announcements'
  | 'chamados'
  | 'profile'
  | 'settings'
  // Seções da conta do DP/TI dentro do aplicativo
  | 'admin-mural'
  | 'admin-chamados'
  | 'admin-comunicados'
  | 'admin-cadastros'
  | 'admin-conversas'
  | 'admin-ajustes';

interface ItemMenu {
  page: Page;
  label: string;
  icone: NomeIcone;
  /** Ainda não liberada: aparece no menu, marcada, mas não abre */
  emConstrucao?: boolean;
}

const ITENS: ItemMenu[] = [
  { page: 'home', label: 'Início', icone: 'inicio' },
  { page: 'announcements', label: 'Comunicados', icone: 'comunicados' },
  { page: 'messages', label: 'Mensagens', icone: 'mensagens' },
  { page: 'chamados', label: 'Chamados TI', icone: 'chamados', emConstrucao: true },
  { page: 'profile', label: 'Meu perfil', icone: 'perfil' },
  { page: 'settings', label: 'Configurações', icone: 'configuracoes' },
];

/**
 * Telas que são da pessoa logada no computador. Com a conta do DP/TI aberta,
 * quem está usando o aplicativo é outra pessoa: elas saem do menu para não
 * mostrar (nem mexer) nos dados de quem estava antes.
 */
const SO_DO_FUNCIONARIO: Page[] = ['profile', 'chamados'];

/** Seções que aparecem só para quem entrou com a conta do DP/TI */
const ITENS_ADMIN: (ItemMenu & { soTi?: boolean })[] = [
  { page: 'admin-comunicados', label: 'Comunicados', icone: 'enviar' },
  { page: 'admin-mural', label: 'Mural', icone: 'mural' },
  { page: 'admin-cadastros', label: 'Cadastros', icone: 'cadastros' },
  { page: 'admin-ajustes', label: 'Ajustes', icone: 'ajustes' },
  { page: 'admin-chamados', label: 'Fila do TI', icone: 'fila', soTi: true, emConstrucao: true },
  { page: 'admin-conversas', label: 'Conversas (TI)', icone: 'auditoria', soTi: true, emConstrucao: true },
];

interface MenuLateralProps {
  page: Page;
  /** Comunicados não lidos */
  unreadAnnouncements: number;
  /** Mensagens do DP não lidas */
  unreadChat: number;
  /** Chamados com resposta nova para quem abriu */
  chamadosNaoLidos: number;
  /** Nome da conta do DP/TI aberta no aplicativo (null = ninguém) */
  adminNome: string | null;
  /** Mostra as telas do Departamento Pessoal (conta do DP/TI ou acesso pelo setor) */
  mostrarTelasDoDp: boolean;
  /** Tem os poderes do TI (conta do TI ou setor de TI) */
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
  mostrarTelasDoDp,
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
      <nav className="menu-lateral__nav menu-lateral__nav--topo">
        {ITENS.filter((item) => !adminNome || !SO_DO_FUNCIONARIO.includes(item.page)).map((item) => {
          const badge = badges[item.page] ?? 0;
          return (
            <button
              key={item.page}
              className={`item-menu ${page === item.page ? 'item-menu--ativo' : ''} ${
                item.emConstrucao ? 'item-menu--construcao' : ''
              }`}
              onClick={() => !item.emConstrucao && onNavigate(item.page)}
              disabled={item.emConstrucao}
              title={item.emConstrucao ? 'Em construção: ainda não está disponível' : undefined}
            >
              <span className="item-menu__icone">
                <Icone nome={item.icone} />
              </span>
              {item.emConstrucao ? (
                <span className="item-menu__texto">
                  <span className="item-menu__label">{item.label}</span>
                  <span className="item-menu__construcao">em construção</span>
                </span>
              ) : (
                <span className="item-menu__label">{item.label}</span>
              )}
              {!item.emConstrucao && badge > 0 && (
                <span className="item-menu__badge">{badge > 99 ? '99+' : badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      {mostrarTelasDoDp && (
        <nav className="menu-lateral__nav menu-lateral__nav--admin" aria-label="Administração">
          <span className="menu-lateral__secao">Departamento Pessoal</span>
          {ITENS_ADMIN.filter((item) => !item.soTi || adminEhTi).map((item) => (
            <button
              key={item.page}
              className={`item-menu ${page === item.page ? 'item-menu--ativo' : ''} ${
                item.emConstrucao ? 'item-menu--construcao' : ''
              }`}
              onClick={() => !item.emConstrucao && onNavigate(item.page)}
              disabled={item.emConstrucao}
              title={item.emConstrucao ? 'Em construção: ainda não está disponível' : undefined}
            >
              <span className="item-menu__icone">
                <Icone nome={item.icone} />
              </span>
              {item.emConstrucao ? (
                <span className="item-menu__texto">
                  <span className="item-menu__label">{item.label}</span>
                  <span className="item-menu__construcao">em construção</span>
                </span>
              ) : (
                <span className="item-menu__label">{item.label}</span>
              )}
            </button>
          ))}
        </nav>
      )}

      <div className="menu-lateral__rodape">
        <button className="item-menu item-menu--discreto" onClick={() => onNavigate('home')}>
          <span className="item-menu__icone">
            <Icone nome="novidades" />
          </span>
          <span className="item-menu__label">Novidades</span>
        </button>
        <button className="item-menu item-menu--discreto" onClick={() => onNavigate('messages')}>
          <span className="item-menu__icone">
            <Icone nome="ajuda" />
          </span>
          <span className="item-menu__label">Central de Ajuda</span>
        </button>
        <span className="menu-lateral__versao">versão {appVersion}</span>
      </div>
    </aside>
  );
}
