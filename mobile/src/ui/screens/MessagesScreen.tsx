/** Comunicados: lista (não lidos / todos) e detalhe */
import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { markRead } from '../../core/connection';
import { useApp } from '../../core/store';
import { TYPE_LABELS } from '../../core/types';
import { Attachments } from '../Attachments';
import { Card, Empty, Header, TypeTag } from '../components';
import { formatDate, TONES, useTheme } from '../theme';

export function MessagesScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useTheme();
  const { messages } = useApp();
  const [filter, setFilter] = useState<'unread' | 'all'>('all');
  const unreadCount = messages.filter((m) => !m.read).length;
  const list = filter === 'unread' ? messages.filter((m) => !m.read) : messages;

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Comunicados" subtitle={unreadCount > 0 ? `${unreadCount} não lido${unreadCount === 1 ? '' : 's'}` : 'Tudo lido'} />
      <View style={styles.filters}>
        {(['all', 'unread'] as const).map((key) => {
          const active = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.chip, { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.surface }]}>
              <Text style={[styles.chipText, { color: active ? t.primary : t.textSoft }]}>
                {key === 'all' ? 'Todos' : `Não lidos (${unreadCount})`}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        data={list}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Empty icon="📭" text={filter === 'unread' ? 'Nenhum comunicado não lido.' : 'Nenhum comunicado recebido ainda.'} />
        }
        renderItem={({ item: m }) => (
          <Card onPress={() => onOpen(m.id)} style={[styles.item, !m.read && { borderLeftWidth: 4, borderLeftColor: TONES[m.type].color }]}>
            <View style={styles.rowBetween}>
              <TypeTag type={m.type} />
              <Text style={[styles.date, { color: t.muted }]}>{formatDate(m.createdAt)}</Text>
            </View>
            <Text style={[styles.title, { color: t.text, fontWeight: m.read ? '600' : '800' }]} numberOfLines={2}>
              {!m.read ? '● ' : ''}
              {m.title}
            </Text>
            <Text style={[styles.preview, { color: t.textSoft }]} numberOfLines={2}>
              {m.content}
            </Text>
            {m.attachments.length > 0 ? (
              <Text style={[styles.anexoSelo, { color: t.muted }]}>
                📎 {m.attachments.length} anexo{m.attachments.length === 1 ? '' : 's'}
              </Text>
            ) : null}
          </Card>
        )}
      />
    </View>
  );
}

export function MessageDetailScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useTheme();
  const { messages } = useApp();
  const message = messages.find((m) => m.id === id);

  useEffect(() => {
    if (message && !message.read) void markRead(message.id);
  }, [message]);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={message ? TYPE_LABELS[message.type] : 'Comunicado'} subtitle={message?.id} onBack={onBack} />
      {!message ? (
        <Empty icon="🔎" text="Comunicado não encontrado. Ele pode ter sido removido." />
      ) : (
        <ScrollView contentContainerStyle={styles.detail}>
          <Card style={{ borderTopWidth: 4, borderTopColor: TONES[message.type].color }}>
            <TypeTag type={message.type} />
            <Text style={[styles.detailTitle, { color: t.text }]}>{message.title}</Text>
            <Text style={[styles.meta, { color: t.muted }]}>
              Enviado por {message.sender} · {formatDate(message.createdAt)}
            </Text>
            <Text style={[styles.body, { color: t.text }]} selectable>
              {message.content}
            </Text>
            <Attachments attachments={message.attachments} />
            <Text style={[styles.readAt, { color: t.success }]}>
              {message.readAt ? `✓ Lido em ${formatDate(message.readAt)}` : '✓ Marcado como lido'}
            </Text>
          </Card>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  chipText: { fontSize: 13.5, fontWeight: '700' },
  list: { padding: 16, gap: 10, paddingBottom: 24 },
  item: { paddingVertical: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 12 },
  title: { fontSize: 15.5, marginTop: 10 },
  preview: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  anexoSelo: { fontSize: 12.5, marginTop: 6, fontWeight: '600' },
  detail: { padding: 16 },
  detailTitle: { fontSize: 21, fontWeight: '800', marginTop: 12, lineHeight: 27 },
  meta: { fontSize: 13, marginTop: 6 },
  body: { fontSize: 16, lineHeight: 24, marginTop: 18 },
  readAt: { fontSize: 13, marginTop: 22, fontWeight: '600' },
});
