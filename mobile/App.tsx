/**
 * Comunicação DP — app Android para os funcionários.
 * Telas: configuração do servidor → login → Início, Comunicados, Mensagens e Perfil.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { boot, clearNavRequest, ensureService, reconnectNow } from './src/core/connection';
import { useApp } from './src/core/store';
import { AlertModal } from './src/ui/AlertModal';
import { Badge, Banner, Button, Header } from './src/ui/components';
import { ChatListScreen, ChatScreen } from './src/ui/screens/ChatScreens';
import { DeviceSetupScreen, requestNotificationPermission } from './src/ui/screens/DeviceSetupScreen';
import { HomeScreen } from './src/ui/screens/HomeScreen';
import { LoginScreen } from './src/ui/screens/LoginScreen';
import { MessageDetailScreen, MessagesScreen } from './src/ui/screens/MessagesScreen';
import { PasswordScreen, ProfileScreen } from './src/ui/screens/ProfileScreens';
import { SetupScreen } from './src/ui/screens/SetupScreen';
import { useTheme } from './src/ui/theme';

type Tab = 'inicio' | 'comunicados' | 'mensagens' | 'perfil';
type Route =
  | { name: 'message'; id: string }
  | { name: 'chat'; dpUserId: string }
  | { name: 'password' }
  | { name: 'device' }
  | { name: 'server' };

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useTheme();
  const app = useApp();
  const [tab, setTab] = useState<Tab>('inicio');
  const [stack, setStack] = useState<Route[]>([]);
  const push = (route: Route) => setStack((s) => [...s, route]);
  const pop = () => setStack((s) => s.slice(0, -1));

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
  }, [stack.length, tab]);

  // Notificação tocada: abre o comunicado ou a conversa
  useEffect(() => {
    const request = app.navRequest;
    if (!request || !app.employee) return;
    if (request.kind === 'message') {
      setTab('comunicados');
      setStack([{ name: 'message', id: request.id }]);
    } else {
      setTab('mensagens');
      setStack([{ name: 'chat', dpUserId: request.dpUserId }]);
    }
    clearNavRequest();
  }, [app.navRequest, app.employee]);

  if (!app.booted) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <ActivityIndicator color={t.primary} size="large" />
      </View>
    );
  }

  const top = stack[stack.length - 1];
  const configured = Boolean(app.serverUrl);

  if (!configured || top?.name === 'server') return <SetupScreen onBack={configured ? pop : undefined} />;

  if (!app.employeeChecked) return <Connecting onServer={() => push({ name: 'server' })} />;

  if (!app.employee) return <LoginScreen onServer={() => push({ name: 'server' })} />;

  if (app.employee.mustChangePassword) return <PasswordScreen forced />;

  let screen: React.ReactNode;
  if (top?.name === 'message') screen = <MessageDetailScreen id={top.id} onBack={pop} />;
  else if (top?.name === 'chat') screen = <ChatScreen dpUserId={top.dpUserId} onBack={pop} />;
  else if (top?.name === 'password') screen = <PasswordScreen onBack={pop} />;
  else if (top?.name === 'device') screen = <DeviceSetupScreen onBack={pop} />;
  else if (tab === 'inicio')
    screen = (
      <HomeScreen
        onOpenMessage={(id) => push({ name: 'message', id })}
        onGoMessages={() => setTab('comunicados')}
        onGoChat={() => setTab('mensagens')}
        onDeviceSetup={() => push({ name: 'device' })}
      />
    );
  else if (tab === 'comunicados') screen = <MessagesScreen onOpen={(id) => push({ name: 'message', id })} />;
  else if (tab === 'mensagens') screen = <ChatListScreen onOpen={(dpUserId) => push({ name: 'chat', dpUserId })} />;
  else
    screen = (
      <ProfileScreen
        onPassword={() => push({ name: 'password' })}
        onDeviceSetup={() => push({ name: 'device' })}
        onServer={() => push({ name: 'server' })}
      />
    );

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <View style={styles.flex}>{screen}</View>
      {!top ? <TabBar tab={tab} onChange={setTab} /> : null}
      <AlertModal
        onView={(id) => {
          setTab('comunicados');
          setStack([{ name: 'message', id }]);
        }}
      />
    </View>
  );
}

function Connecting({ onServer }: { onServer: () => void }) {
  const t = useTheme();
  const { connection } = useApp();
  const waiting = connection.status === 'connecting' || connection.status === 'reconnecting';
  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Comunicação DP" subtitle="Departamento Pessoal" />
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
  { key: 'perfil', label: 'Perfil', icon: '👤' },
];

function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { messages, chatUnread } = useApp();
  const unread = messages.filter((m) => !m.read).length;
  return (
    <View style={[styles.tabBar, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: Math.max(insets.bottom, 6) }]}>
      {TABS.map((item) => {
        const active = item.key === tab;
        const count = item.key === 'comunicados' ? unread : item.key === 'mensagens' ? chatUnread : 0;
        return (
          <Pressable key={item.key} onPress={() => onChange(item.key)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: active }}>
            <View>
              <Text style={[styles.tabIcon, { opacity: active ? 1 : 0.55 }]}>{item.icon}</Text>
              <View style={styles.tabBadge}>
                <Badge count={count} />
              </View>
            </View>
            <Text style={[styles.tabLabel, { color: active ? t.primary : t.muted, fontWeight: active ? '800' : '600' }]}>{item.label}</Text>
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
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  tabIcon: { fontSize: 22 },
  tabBadge: { position: 'absolute', top: -4, right: -16 },
  tabLabel: { fontSize: 11.5 },
});
