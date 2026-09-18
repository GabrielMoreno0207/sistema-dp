/** Alerta na tela quando chega um comunicado com o app aberto (como o popup do computador) */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { dismissAlert } from '../core/connection';
import { useApp } from '../core/store';
import { TYPE_LABELS } from '../core/types';
import { Button } from './components';
import { TONES, useTheme } from './theme';

export function AlertModal({ onView }: { onView: (id: string) => void }) {
  const t = useTheme();
  const { alert, alertQueue } = useApp();
  if (!alert) return null;
  const tone = TONES[alert.type];

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={dismissAlert}>
      <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={dismissAlert}>
        <Pressable style={[styles.card, { backgroundColor: t.surface, borderTopColor: tone.color }]} onPress={() => {}}>
          <View style={styles.head}>
            <Text style={styles.icon}>{tone.icon}</Text>
            <View style={styles.headTexts}>
              <Text style={[styles.kind, { color: tone.color }]}>
                {TYPE_LABELS[alert.type].toUpperCase()} · DP
              </Text>
              <Text style={[styles.title, { color: t.text }]} numberOfLines={3}>
                {alert.title}
              </Text>
            </View>
          </View>
          <Text style={[styles.body, { color: t.textSoft }]} numberOfLines={6}>
            {alert.content}
          </Text>
          {alert.attachments.length > 0 ? (
            <Text style={[styles.anexos, { color: t.textSoft }]}>
              📎 {alert.attachments.length} anexo{alert.attachments.length === 1 ? '' : 's'} — abra o comunicado para ver
            </Text>
          ) : null}
          {alertQueue.length > 0 ? (
            <Text style={[styles.more, { color: t.muted }]}>
              + {alertQueue.length} comunicado{alertQueue.length === 1 ? '' : 's'} na fila
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button title="Fechar" variant="secondary" onPress={dismissAlert} style={styles.action} />
            <Button
              title="Visualizar"
              onPress={() => {
                const id = alert.id;
                dismissAlert();
                onView(id);
              }}
              style={[styles.action, { backgroundColor: tone.color, borderColor: tone.color }]}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { borderRadius: 18, padding: 20, borderTopWidth: 6, elevation: 12 },
  head: { flexDirection: 'row', gap: 12 },
  icon: { fontSize: 30 },
  headTexts: { flex: 1 },
  kind: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4 },
  title: { fontSize: 19, fontWeight: '800', marginTop: 3, lineHeight: 25 },
  body: { fontSize: 15, lineHeight: 22, marginTop: 14 },
  anexos: { fontSize: 13, fontWeight: '700', marginTop: 10 },
  more: { fontSize: 12.5, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  action: { flex: 1 },
});
