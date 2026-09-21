import { useEffect, useRef, useState } from 'react';
import type { DpMessage } from '../../shared/types';
import { ForcePasswordScreen } from './components/ForcePasswordScreen';
import { LoginScreen } from './components/LoginScreen';
import { BarraSuperior } from './components/BarraSuperior';
import { EntrarComoDp } from './components/EntrarComoDp';
import { ColunaDireita } from './components/ColunaDireita';
import { MenuLateral, type Page } from './components/MenuLateral';
import { useDesktopState } from './hooks/useDesktopState';
import { ChatPage } from './pages/ChatPage';
import { ChamadosPage } from './pages/ChamadosPage';
import { FilaChamadosPage } from './pages/FilaChamadosPage';
import { InicioPage } from './pages/InicioPage';
import { MuralAdminPage } from './pages/MuralAdminPage';
import { MessagesPage } from './pages/MessagesPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';

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
  // Chamados com resposta nova (badge do menu)
  const [chamadosNaoLidos, setChamadosNaoLidos] = useState(0);
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

  if (!state) return <div className="loading">Carregando...</div>;

  const { messages } = state;

  function chooseSkipLogin(skip: boolean) {
    setSkipLogin(skip);
    writeSkipLogin(skip);
    if (skip) setPage('home');
  }

  if (!state.employee && !skipLogin) {
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

  /** Abre a conversa com aquela pessoa do DP já na tela de mensagens */
  function abrirConversa(contatoId: string) {
    void window.dp.chatOpen(contatoId);
    navigate('messages');
  }

  let content;
  switch (page) {
    case 'home':
      content = (
        <InicioPage
          employee={state.employee}
          messages={messages}
          chat={state.chat}
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
        <ChatPage
          chat={state.chat}
          employee={state.employee}
          connection={state.connection}
          onRequestLogin={() => chooseSkipLogin(false)}
        />
      );
      break;
    case 'announcements':
      content = (
        <MessagesPage
          title="Comunicados"
          subtitle="Comunicados, avisos, informativos e urgentes do Departamento Pessoal."
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
      />

      {entrandoComoDp && <EntrarComoDp onFechar={() => setEntrandoComoDp(false)} />}

      <div className="app__corpo">
        <MenuLateral
          page={page}
          unreadAnnouncements={messages.unreadCount}
          unreadChat={state.chat.unreadCount}
          chamadosNaoLidos={chamadosNaoLidos}
          adminNome={state.admin?.name ?? null}
          adminEhTi={state.admin?.superAdmin ?? false}
          appVersion={state.appVersion}
          onNavigate={navigate}
        />

        <main className="app__conteudo">{content}</main>

        {/* A coluna da direita acompanha a tela inicial; nas demais, o conteúdo ocupa a largura toda */}
        {page === 'home' && (
          <ColunaDireita
            employee={state.employee}
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
