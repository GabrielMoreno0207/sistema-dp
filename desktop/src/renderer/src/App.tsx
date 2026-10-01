import { useEffect, useRef, useState } from 'react';
import type { AtualizacaoEmAndamento, ConversaResumo, DpMessage } from '../../shared/types';
import { ForcePasswordScreen } from './components/ForcePasswordScreen';
import { LoginScreen } from './components/LoginScreen';
import { BarraSuperior } from './components/BarraSuperior';
import { EntrarComoDp } from './components/EntrarComoDp';
import { ColunaDireita } from './components/ColunaDireita';
import { MenuLateral, type Page } from './components/MenuLateral';
import { useDesktopState } from './hooks/useDesktopState';
import { ConversasPage } from './pages/ConversasPage';
import { ConversasTiPage } from './pages/ConversasTiPage';
import { ChamadosPage } from './pages/ChamadosPage';
import { FilaChamadosPage } from './pages/FilaChamadosPage';
import { InicioPage } from './pages/InicioPage';
import { AjustesDpPage } from './pages/admin/AjustesDpPage';
import { CadastrosPage } from './pages/admin/CadastrosPage';
import { ComunicadosAdminPage } from './pages/admin/ComunicadosAdminPage';
import { MuralAdminPage } from './pages/MuralAdminPage';
import { MessagesPage } from './pages/MessagesPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { FecharSistema } from './components/FecharSistema';
import { TelaAtualizando } from './components/TelaAtualizando';

const SKIP_LOGIN_KEY = 'dp.skipLogin';
/** Tempo máximo esperando a primeira resposta do servidor antes de mostrar a tela de login */
const SESSION_WAIT_MS = 6_000;

function readSkipLogin(): boolean {
  try {
    return sessionStorage.getItem(SKIP_LOGIN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSkipLogin(skip: boolean): void {
  try {
    if (skip) sessionStorage.setItem(SKIP_LOGIN_KEY, '1');
    else sessionStorage.removeItem(SKIP_LOGIN_KEY);
  } catch {
    /* sem sessionStorage: a escolha vale só enquanto a tela estiver aberta */
  }
}

export function App() {
  const state = useDesktopState();
  const [page, setPage] = useState<Page>('home');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skipLogin, setSkipLogin] = useState(readSkipLogin);
  const [waitExpired, setWaitExpired] = useState(false);
  const [entrandoComoDp, setEntrandoComoDp] = useState(false);
  const [fechandoSistema, setFechandoSistema] = useState(false);
  // Instalando versão nova: o aplicativo vai fechar e abrir de novo
  const [atualizando, setAtualizando] = useState<AtualizacaoEmAndamento | null>(null);
  // Conversa que o alerta pediu para abrir (botão "Responder")
  const [conversaPedida, setConversaPedida] = useState<string | null>(null);
  // Chamados com resposta nova (badge do menu)
  const [chamadosNaoLidos, setChamadosNaoLidos] = useState(0);
  // Conversas do chat: alimentam a tela inicial e o contador do menu
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  // Funcionário atual, lido dentro do listener (que é registrado uma vez só)
  const employeeIdRef = useRef<string | null>(null);
  employeeIdRef.current = state?.employee?.id ?? null;

  // "Visualizar" no popup abre a mensagem aqui. Sem funcionário logado, segue sem identificação:
  // o detalhe precisa aparecer (a mensagem já foi marcada como lida), não a tela de login.
  useEffect(
    () =>
      window.dp.onOpenMessage((messageId) => {
        if (!employeeIdRef.current) {
          setSkipLogin(true);
          writeSkipLogin(true);
        }
        setPage('announcements');
        setSelectedId(messageId);
      }),
    [],
  );

  // "Responder" no alerta de mensagem abre a conversa aqui
  useEffect(
    () =>
      window.dp.onOpenConversa((conversaId) => {
        setPage('messages');
        setSelectedId(null);
        setConversaPedida(conversaId);
      }),
    [],
  );

  // X da janela, Alt+F4 ou "Sair" na bandeja: quem encerra é a caixa da senha
  useEffect(() => window.dp.onPedirSenhaParaFechar(() => setFechandoSistema(true)), []);

  // O instalador vai rodar: avisa antes de a janela sumir
  useEffect(() => window.dp.onAtualizacaoInstalando((info) => setAtualizando(info)), []);

  useEffect(() => {
    const timer = setTimeout(() => setWaitExpired(true), SESSION_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Contador de chamados com resposta do TI ainda não lida
  useEffect(() => {
    async function atualizar() {
      const resultado = await window.dp.listarChamados();
      setChamadosNaoLidos(resultado.chamados.reduce((soma, c) => soma + c.mensagensNaoLidas, 0));
    }
    void atualizar();
    return window.dp.onChamadosChange(() => void atualizar());
  }, []);

  // Entrou: a escolha "continuar sem identificação" deixa de valer (ao sair, a tela de login volta)
  const employeeId = state?.employee?.id ?? null;
  useEffect(() => {
    if (employeeId) {
      setSkipLogin(false);
      writeSkipLogin(false);
    }
  }, [employeeId]);

  // Conversas do chat, atualizadas quando o servidor avisa que algo mudou
  const adminId = state?.admin?.id ?? null;
  useEffect(() => {
    async function atualizar() {
      const resposta = await window.dp.conversasApi<{ conversas: ConversaResumo[] }>('GET', '/api/conversas');
      setConversas(resposta.dados?.conversas ?? []);
    }
    void atualizar();
    const pararMudanca = window.dp.onConversasChange(() => void atualizar());
    // Conversa aberta na tela de mensagens: o contador do menu tem de zerar junto
    const pararContador = window.dp.onConversasContador(() => void atualizar());
    return () => {
      pararMudanca();
      pararContador();
    };
  }, [employeeId, adminId]);

  const naoLidasChat = conversas.reduce((soma, conversa) => soma + conversa.naoLidas, 0);

  /**
   * Quem pode usar as telas de administração: a conta do DP/TI aberta no
   * aplicativo ou o funcionário cujo setor é o do DP ou o do TI.
   */
  const acessoDoSetor = state?.employee?.acessoAdmin ?? 'NENHUM';
  const mostrarTelasDoDp = Boolean(state?.admin) || acessoDoSetor !== 'NENHUM';
  const ehTi = state?.admin?.superAdmin === true || acessoDoSetor === 'TI';

  // Por cima de tudo, inclusive da tela de login: o aplicativo está de saída
  if (atualizando) return <TelaAtualizando info={atualizando} />;

  if (!state) return <div className="loading">Carregando...</div>;

  const { messages } = state;

  function chooseSkipLogin(skip: boolean) {
    setSkipLogin(skip);
    writeSkipLogin(skip);
    if (skip) setPage('home');
  }

  // Com a conta do DP conectada, o aplicativo já abre: ela não é um funcionário
  // deste computador, mas tem as seções administrativas para usar.
  if (!state.employee && !skipLogin && !state.admin) {
    // Ainda não sabemos se há alguém logado (servidor conectando): evita piscar a tela de login
    const connecting = ['connecting', 'reconnecting', 'connected'].includes(state.connection.status);
    if (!state.employeeChecked && connecting && !waitExpired) {
      return <div className="loading">Conectando ao servidor...</div>;
    }
    return (
      <LoginScreen
        connection={state.connection}
        onSkip={() => chooseSkipLogin(true)}
        onOpenSettings={() => {
          chooseSkipLogin(true);
          setPage('settings');
        }}
      />
    );
  }

  // Senha inicial ou redefinida pelo DP: troca obrigatória antes de usar o app
  if (state.employee?.mustChangePassword) return <ForcePasswordScreen employee={state.employee} />;

  /** Comunicados abrem sempre na página Comunicados */
  function openMessage(message: DpMessage) {
    setPage('announcements');
    setSelectedId(message.id);
    if (!message.read) void window.dp.markAsRead(message.id);
  }

  function navigate(next: Page) {
    setPage(next);
    setSelectedId(null);
  }

  /** Atalho da tela inicial: leva para a página de mensagens */
  function abrirConversa() {
    navigate('messages');
  }

  let content;
  switch (page) {
    case 'home':
      content = (
        <InicioPage
          employee={state.employee}
          admin={state.admin}
          messages={messages}
          conversas={conversas}
          naoLidasChat={naoLidasChat}
          mural={state.mural}
          atalhos={state.atalhos}
          onNavegar={navigate}
          onAbrirConversa={abrirConversa}
          onEntrar={() => chooseSkipLogin(false)}
        />
      );
      break;
    case 'messages':
      content = (
        <ConversasPage
          connection={state.connection}
          conversaPedida={conversaPedida}
          onAbriuPedida={() => setConversaPedida(null)}
          onRequestLogin={() => chooseSkipLogin(false)}
        />
      );
      break;
    case 'announcements':
      content = (
        <MessagesPage
          title="Comunicados"
          subtitle="Comunicados, avisos, informativos e urgentes do RH."
          messages={messages.messages}
          selectedId={selectedId}
          onSelect={openMessage}
          onCloseDetail={() => setSelectedId(null)}
        />
      );
      break;
    case 'profile':
      content = <ProfilePage state={state} onRequestLogin={() => chooseSkipLogin(false)} />;
      break;
    case 'settings':
      content = <SettingsPage />;
      break;
    case 'chamados':
      content = <ChamadosPage />;
      break;
    case 'admin-mural':
      content = <MuralAdminPage />;
      break;
    case 'admin-chamados':
      content = <FilaChamadosPage />;
      break;
    case 'admin-comunicados':
      content = <ComunicadosAdminPage ehTi={ehTi} />;
      break;
    case 'admin-cadastros':
      content = <CadastrosPage />;
      break;
    case 'admin-conversas':
      content = <ConversasTiPage />;
      break;
    case 'admin-ajustes':
      content = <AjustesDpPage ehTi={ehTi} />;
      break;
  }

  return (
    <div className="app">
      <BarraSuperior
        employee={state.employee}
        foto={state.foto}
        admin={state.admin}
        connection={state.connection}
        onAbrirPerfil={() => navigate('profile')}
        onAbrirConfiguracoes={() => navigate('settings')}
        onEntrar={() => chooseSkipLogin(false)}
        onEntrarComoDp={() => setEntrandoComoDp(true)}
        onSairDoDp={() => {
          void window.dp.adminLogout();
          navigate('home');
        }}
        onFecharSistema={() => setFechandoSistema(true)}
      />

      {fechandoSistema && <FecharSistema onCancelar={() => setFechandoSistema(false)} />}

      {entrandoComoDp && <EntrarComoDp onFechar={() => setEntrandoComoDp(false)} />}

      <div className="app__corpo">
        <MenuLateral
          page={page}
          unreadAnnouncements={messages.unreadCount}
          unreadChat={naoLidasChat}
          chamadosNaoLidos={chamadosNaoLidos}
          adminNome={state.admin?.name ?? null}
          mostrarTelasDoDp={mostrarTelasDoDp}
          adminEhTi={ehTi}
          appVersion={state.appVersion}
          onNavigate={navigate}
        />

        <main className="app__conteudo">{content}</main>

        {/* A coluna da direita acompanha a tela inicial; nas demais, o conteúdo ocupa a largura toda */}
        {page === 'home' && (
          <ColunaDireita
            employee={state.employee}
            admin={state.admin}
            foto={state.foto}
            messages={messages}
            onAbrir={openMessage}
            onVerTodos={() => navigate('announcements')}
            onEntrar={() => chooseSkipLogin(false)}
          />
        )}
      </div>
    </div>
  );
}
