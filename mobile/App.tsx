/**
 * Comunica Trinys — app Android.
 * Telas: configuração do servidor → login → abas Início, Comunicados, Mensagens e Mais,
 * com as telas do DP/TI para quem é desses setores (as mesmas funções do app do computador).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { boot, clearNavRequest, ensureService, reconnectNow } from './src/core/connection';
import { useApp } from './src/core/store';
import { AlertModal } from './src/ui/AlertModal';
import { Badge, Banner, Button, Header } from './src/ui/components';
import { NavContext, type Nav, type Route, type Tab } from './src/ui/nav';
import { AdminComunicadosScreen, AdminLeiturasScreen, AdminNovoComunicadoScreen } from './src/ui/screens/AdminComunicados';
import {
  AdminAjustesScreen,
  AdminCadastrosScreen,
  AdminFuncionarioScreen,
  AdminMuralEditarScreen,
  AdminMuralScreen,
} from './src/ui/screens/AdminOutros';
import {
  ConversaScreen,
  ConversasScreen,
  EncaminharScreen,
  GrupoScreen,
  ImagemScreen,
  NovaConversaScreen,
  NovoGrupoScreen,
} from './src/ui/screens/ConversasScreens';
import { DeviceSetupScreen, requestNotificationPermission } from './src/ui/screens/DeviceSetupScreen';
import { HomeScreen, MuralScreen } from './src/ui/screens/HomeScreen';
import { LoginScreen } from './src/ui/screens/LoginScreen';
import { MaisScreen, SobreScreen } from './src/ui/screens/MaisScreen';
import { MessageDetailScreen, MessagesScreen } from './src/ui/screens/MessagesScreen';
import { FotoScreen, PasswordScreen, ProfileScreen } from './src/ui/screens/ProfileScreens';
import { SetupScreen } from './src/ui/screens/SetupScreen';
import { useTheme } from './src/ui/theme';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <Root />
    </SafeAreaProvider>
  );
}

/** Telas do DP/TI: quem perdeu o acesso (trocou de setor) volta para o início */
const TELAS_ADMIN: Route['name'][] = [
  'adminComunicados',
  'adminNovoComunicado',
  'adminLeituras',
  'adminMural',
  'adminMuralEditar',
  'adminCadastros',
  'adminFuncionario',
  'adminAjustes',
];

function Root() {
  const t = useTheme();
  const app = useApp();
  const [tab, setTab] = useState<Tab>('inicio');
  const [stack, setStack] = useState<Route[]>([]);

  const push = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const goTab = useCallback((novaAba: Tab, route?: Route) => {
    setTab(novaAba);
    setStack(route ? [route] : []);
  }, []);
  const nav = useMemo<Nav>(() => ({ push, pop, goTab }), [push, pop, goTab]);

  useEffect(() => {
    void boot().then(async () => {
      await ensureService();
      await requestNotificationPermission().catch(() => {});
    });
  }, []);

  // Botão voltar do Android: fecha a tela aberta; nas abas, volta para o Início
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 0) {
        pop();
        return true;
      }
      if (tab !== 'inicio') {
        setTab('inicio');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, pop]);

  // Notificação tocada: abre o comunicado, a conversa ou a atualização
  useEffect(() => {
    const request = app.navRequest;
    if (!request || !app.employee) return;
    if (request.kind === 'message') goTab('comunicados', { name: 'message', id: request.id });
    else if (request.kind === 'conversa') goTab('mensagens', { name: 'conversa', conversaId: request.conversaId });
    else if (request.kind === 'atualizacao') goTab('mais', { name: 'sobre' });
    else goTab('mais');
    clearNavRequest();
  }, [app.navRequest, app.employee, goTab]);

  // Sem acesso de DP/TI (mudou de setor, saiu): fecha as telas de administração
  const ehDpOuTi = (app.employee?.acessoAdmin ?? 'NENHUM') !== 'NENHUM';
  useEffect(() => {
    if (!ehDpOuTi && stack.some((r) => TELAS_ADMIN.includes(r.name))) setStack([]);
  }, [ehDpOuTi, stack]);

  // Trocou de pessoa (saiu e outra entrou): começa do início
  useEffect(() => {
    setStack([]);
    setTab('inicio');
  }, [app.employee?.id]);

  if (!app.booted) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.primary} size="large" />
      </View>
    );
  }

  const top = stack[stack.length - 1];
  const configured = Boolean(app.serverUrl);

  if (!configured || top?.name === 'server') {
    return <SetupScreen onBack={configured ? pop : undefined} />;
  }
  if (!app.employeeChecked) return <Connecting onServer={() => push({ name: 'server' })} />;
  if (!app.employee) return <LoginScreen onServer={() => push({ name: 'server' })} />;
  if (app.employee.mustChangePassword) {
    return (
      <NavContext.Provider value={nav}>
        <PasswordScreen forced />
      </NavContext.Provider>
    );
  }

  return (
    <NavContext.Provider value={nav}>
      <View style={[styles.flex, { backgroundColor: t.bg }]}>
        <View style={styles.flex}>{top ? <Tela route={top} /> : <Aba tab={tab} />}</View>
        {!top ? <TabBar tab={tab} onChange={(novaAba) => goTab(novaAba)} /> : null}
        <AlertModal onView={(id) => goTab('comunicados', { name: 'message', id })} />
      </View>
    </NavContext.Provider>
  );
}

function Aba({ tab }: { tab: Tab }) {
  if (tab === 'comunicados') return <MessagesScreen />;
  if (tab === 'mensagens') return <ConversasScreen />;
  if (tab === 'mais') return <MaisScreen />;
  return <HomeScreen />;
}

function Tela({ route }: { route: Route }) {
  const nav = React.useContext(NavContext);
  switch (route.name) {
    case 'message':
      return <MessageDetailScreen id={route.id} />;
    case 'conversa':
      // key: trocar de conversa (ex.: encaminhar e abrir outra) recomeça a tela
      return <ConversaScreen key={route.conversaId} conversaId={route.conversaId} />;
    case 'novaConversa':
      return <NovaConversaScreen />;
    case 'novoGrupo':
      return <NovoGrupoScreen />;
    case 'grupo':
      return <GrupoScreen conversaId={route.conversaId} />;
    case 'encaminhar':
      return <EncaminharScreen mensagem={route.mensagem} />;
    case 'imagem':
      return <ImagemScreen midia={route.midia} />;
    case 'mural':
      return <MuralScreen />;
    case 'perfil':
      return <ProfileScreen />;
    case 'foto':
      return <FotoScreen />;
    case 'password':
      return <PasswordScreen />;
    case 'device':
      return <DeviceSetupScreen onBack={nav.pop} />;
    case 'server':
      return <SetupScreen onBack={nav.pop} />;
    case 'sobre':
      return <SobreScreen />;
    case 'adminComunicados':
      return <AdminComunicadosScreen />;
    case 'adminNovoComunicado':
      return <AdminNovoComunicadoScreen />;
    case 'adminLeituras':
      return <AdminLeiturasScreen id={route.id} titulo={route.titulo} />;
    case 'adminMural':
      return <AdminMuralScreen />;
    case 'adminMuralEditar':
      return <AdminMuralEditarScreen post={route.post} />;
    case 'adminCadastros':
      return <AdminCadastrosScreen />;
    case 'adminFuncionario':
      return <AdminFuncionarioScreen funcionario={route.funcionario} />;
    case 'adminAjustes':
      return <AdminAjustesScreen />;
  }
}

function Connecting({ onServer }: { onServer: () => void }) {
  const t = useTheme();
  const { connection } = useApp();
  const waiting = connection.status === 'connecting' || connection.status === 'reconnecting';
  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Comunica Trinys" subtitle="Departamento Pessoal" />
      <View style={styles.connecting}>
        {waiting ? <ActivityIndicator color={t.primary} size="large" /> : null}
        <Text style={[styles.connectingText, { color: t.textSoft }]}>
          {waiting ? 'Conectando ao servidor...' : 'Não foi possível conectar ao servidor.'}
        </Text>
        {!waiting ? (
          <Banner
            tone={connection.status === 'unauthorized' ? 'danger' : 'warning'}
            text={connection.lastError ?? 'Confira se o celular está no Wi-Fi da empresa.'}
          />
        ) : null}
        <Button title="Tentar agora" onPress={reconnectNow} style={styles.connectingButton} />
        <Button title="Configurações do servidor" variant="ghost" onPress={onServer} />
      </View>
    </View>
  );
}

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'inicio', label: 'Início', icon: '🏠' },
  { key: 'comunicados', label: 'Comunicados', icon: '📢' },
  { key: 'mensagens', label: 'Mensagens', icon: '💬' },
  { key: 'mais', label: 'Mais', icon: '☰' },
];

function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { messages, conversasNaoLidas, atualizacao } = useApp();
  const unread = messages.filter((m) => !m.read).length;
  return (
    <View style={[styles.tabBar, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: Math.max(insets.bottom, 6) }]}>
      {TABS.map((item) => {
        const active = item.key === tab;
        const count =
          item.key === 'comunicados' ? unread : item.key === 'mensagens' ? conversasNaoLidas : item.key === 'mais' && atualizacao.etapa === 'pronta' ? 1 : 0;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={count > 0 ? `${item.label}, ${count} novos` : item.label}>
            <View style={[styles.tabIconWrap, active && { backgroundColor: t.primarySoft }]}>
              <Text style={[styles.tabIcon, { opacity: active ? 1 : 0.6, color: t.text }]}>{item.icon}</Text>
              <View style={styles.tabBadge}>
                <Badge count={count} />
              </View>
            </View>
            <Text style={[styles.tabLabel, { color: active ? t.link : t.muted, fontWeight: active ? '800' : '600' }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  connecting: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  connectingText: { fontSize: 16, textAlign: 'center' },
  connectingButton: { marginTop: 8 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  tabIconWrap: { paddingHorizontal: 16, paddingVertical: 3, borderRadius: 999 },
  tabIcon: { fontSize: 20 },
  tabBadge: { position: 'absolute', top: -4, right: 0 },
  tabLabel: { fontSize: 11.5 },
});
