/** Mensagens: lista das pessoas do DP e conversa individual com cada uma */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openChat, sendChat } from '../../core/connection';
import { useApp } from '../../core/store';
import { CHAT_MESSAGE_MAX } from '../../core/types';
import { Badge, Empty, Header } from '../components';
import { formatDate, formatTime, useTheme } from '../theme';

export function ChatListScreen({ onOpen }: { onOpen: (dpUserId: string) => void }) {
  const t = useTheme();
  const { contacts, chatUnread } = useApp();
  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Mensagens" subtitle={chatUnread > 0 ? `${chatUnread} não lida${chatUnread === 1 ? '' : 's'}` : 'Converse com qualquer pessoa do DP'} />
      <FlatList
        data={contacts}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Empty icon="💬" text="Nenhuma pessoa do DP disponível para conversa no momento." />}
        renderItem={({ item: c }) => {
          const last = c.lastMessage;
          return (
            <Pressable
              onPress={() => onOpen(c.id)}
              style={({ pressed }) => [styles.contact, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.85 : 1 }]}>
              <View style={[styles.avatar, { backgroundColor: t.primary }]}>
                <Text style={styles.avatarText}>{c.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.contactTexts}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.contactName, { color: t.text }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {last ? <Text style={[styles.time, { color: t.muted }]}>{formatTime(last.createdAt)}</Text> : null}
                </View>
                <View style={styles.rowBetween}>
                  <Text
                    style={[styles.preview, { color: c.unreadCount > 0 ? t.text : t.muted, fontWeight: c.unreadCount > 0 ? '700' : '400' }]}
                    numberOfLines={1}>
                    {last ? `${last.senderType === 'EMPLOYEE' ? 'Você: ' : ''}${last.content}` : 'Toque para conversar'}
                  </Text>
                  <Badge count={c.unreadCount} />
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

export function ChatScreen({ dpUserId, onBack }: { dpUserId: string; onBack: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { contacts, thread, threadLoading, connection } = useApp();
  const contact = contacts.find((c) => c.id === dpUserId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    void openChat(dpUserId);
    return () => void openChat(null);
  }, [dpUserId]);

  useEffect(() => {
    if (thread.length > 0) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  }, [thread.length]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    const result = await sendChat(dpUserId, text);
    setSending(false);
    if (result.ok) setText('');
    else setError(result.message);
  }

  let lastDay = '';
  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={contact?.name ?? 'Conversa'} subtitle="Só você e essa pessoa veem esta conversa" onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {threadLoading ? (
          <ActivityIndicator style={styles.loading} color={t.primary} />
        ) : (
          <FlatList
            ref={listRef}
            data={thread}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.thread}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<Empty icon="👋" text="Nenhuma mensagem ainda. Escreva a primeira!" />}
            renderItem={({ item: m }) => {
              const mine = m.senderType === 'EMPLOYEE';
              const day = formatDate(m.createdAt).split(',')[0];
              const showDay = day !== lastDay;
              lastDay = day;
              return (
                <View>
                  {showDay ? <Text style={[styles.day, { color: t.muted, backgroundColor: t.surface2 }]}>{day}</Text> : null}
                  <View
                    style={[
                      styles.bubble,
                      mine
                        ? { alignSelf: 'flex-end', backgroundColor: t.bubbleMine }
                        : { alignSelf: 'flex-start', backgroundColor: t.bubbleOther, borderColor: t.border, borderWidth: 1 },
                    ]}>
                    {!mine ? (
                      <Text style={[styles.sender, { color: t.primary }]}>
                        {m.senderName}
                        {m.automatic ? '  🤖 Resposta automática' : ''}
                      </Text>
                    ) : null}
                    <Text style={[styles.bubbleText, { color: mine ? t.onBubbleMine : t.text }]} selectable>
                      {m.content}
                    </Text>
                    <Text style={[styles.meta, { color: mine ? 'rgba(255,255,255,0.75)' : t.muted }]}>
                      {formatTime(m.createdAt)}
                      {mine && m.readAt ? ' · ✓ lida' : ''}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}
        {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
        <View style={[styles.composer, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Escreva para ${contact?.name ?? 'o DP'}...`}
            placeholderTextColor={t.muted}
            multiline
            maxLength={CHAT_MESSAGE_MAX}
            style={[styles.input, { color: t.text, backgroundColor: t.bg, borderColor: t.border }]}
          />
          <Pressable
            onPress={() => void send()}
            disabled={!text.trim() || sending || connection.status !== 'connected'}
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: t.primary, opacity: !text.trim() || sending || connection.status !== 'connected' ? 0.5 : pressed ? 0.8 : 1 },
            ]}
            accessibilityLabel="Enviar">
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>➤</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 12, gap: 8, paddingBottom: 24 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  contactTexts: { flex: 1, minWidth: 0, gap: 3 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  contactName: { flex: 1, fontSize: 15.5, fontWeight: '700' },
  time: { fontSize: 12 },
  preview: { flex: 1, fontSize: 13.5 },
  loading: { marginTop: 40 },
  thread: { padding: 12, gap: 6, flexGrow: 1 },
  day: { alignSelf: 'center', fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, marginVertical: 8, overflow: 'hidden' },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 2 },
  sender: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  bubbleText: { fontSize: 15.5, lineHeight: 21 },
  meta: { fontSize: 11, marginTop: 4, alignSelf: 'flex-end' },
  error: { textAlign: 'center', fontSize: 13, paddingVertical: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 10, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15.5 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 18 },
});
