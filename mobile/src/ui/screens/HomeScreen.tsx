/** Início: resumo dos comunicados e mensagens */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../core/store';
import { Banner, Card, Empty, Header, TypeTag } from '../components';
import { formatDate, useTheme } from '../theme';
import { useDeviceChecks } from './DeviceSetupScreen';

export function HomeScreen({
  onOpenMessage,
  onGoMessages,
  onGoChat,
  onDeviceSetup,
}: {
  onOpenMessage: (id: string) => void;
  onGoMessages: () => void;
  onGoChat: () => void;
  onDeviceSetup: () => void;
}) {
  const t = useTheme();
  const { employee, messages, chatUnread, contacts } = useApp();
  const checks = useDeviceChecks();
  const unread = messages.filter((m) => !m.read);
  const urgent = unread.filter((m) => m.type === 'URGENTE');
  const senders = contacts.filter((c) => c.unreadCount > 0).map((c) => c.name);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={`Olá, ${employee?.name.split(' ')[0] ?? ''}`} subtitle={employee?.sector ?? 'Departamento Pessoal'} />
      <ScrollView contentContainerStyle={styles.content}>
        {checks && !checks.allGood ? (
          <Banner
            tone="warning"
            text="Configure o celular para receber os avisos mesmo com o app fechado."
            action={{ title: 'Configurar', onPress: onDeviceSetup }}
          />
        ) : null}

        <View style={styles.stats}>
          <Card style={styles.stat} onPress={onGoMessages}>
            <Text style={[styles.statValue, { color: t.primary }]}>{unread.length}</Text>
            <Text style={[styles.statLabel, { color: t.muted }]}>Comunicados não lidos</Text>
          </Card>
          <Card style={styles.stat} onPress={onGoMessages}>
            <Text style={[styles.statValue, { color: t.danger }]}>{urgent.length}</Text>
            <Text style={[styles.statLabel, { color: t.muted }]}>Urgentes não lidos</Text>
          </Card>
        </View>

        <Card onPress={onGoChat}>
          <Text style={[styles.cardTitle, { color: t.text }]}>💬 Mensagens com o DP</Text>
          <Text style={[styles.cardText, { color: chatUnread > 0 ? t.text : t.muted }]}>
            {chatUnread > 0
              ? `${chatUnread} mensage${chatUnread === 1 ? 'm nova' : 'ns novas'} de ${senders.join(', ')}`
              : 'Nenhuma mensagem nova. Toque para conversar com o DP.'}
          </Text>
        </Card>

        <Text style={[styles.section, { color: t.text }]}>Comunicados recentes</Text>
        {messages.length === 0 ? (
          <Empty icon="📭" text="Nenhum comunicado recebido ainda. Quando o DP enviar, ele aparece aqui." />
        ) : (
          messages.slice(0, 5).map((m) => (
            <Card key={m.id} onPress={() => onOpenMessage(m.id)} style={!m.read && { borderColor: t.primary }}>
              <View style={styles.rowBetween}>
                <TypeTag type={m.type} />
                <Text style={[styles.date, { color: t.muted }]}>{formatDate(m.createdAt)}</Text>
              </View>
              <Text style={[styles.messageTitle, { color: t.text, fontWeight: m.read ? '600' : '800' }]} numberOfLines={1}>
                {m.title}
              </Text>
              <Text style={[styles.preview, { color: t.textSoft }]} numberOfLines={2}>
                {m.content}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1 },
  statValue: { fontSize: 28, fontWeight: '800' },
  statLabel: { fontSize: 12.5, marginTop: 2 },
  cardTitle: { fontSize: 15.5, fontWeight: '700' },
  cardText: { fontSize: 14, marginTop: 6, lineHeight: 20 },
  section: { fontSize: 16, fontWeight: '800', marginTop: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 12 },
  messageTitle: { fontSize: 15.5, marginTop: 10 },
  preview: { fontSize: 14, marginTop: 4, lineHeight: 20 },
});
