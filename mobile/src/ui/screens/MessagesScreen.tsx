/** Comunicados: lista (todos / não lidos / aguardando ciência) e detalhe com "Li e estou ciente" */
import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { confirmarCiencia, markRead, syncMessages } from '../../core/connection';
import { useApp } from '../../core/store';
import { TYPE_LABELS, type OperationResult } from '../../core/types';
import { Attachments } from '../Attachments';
import { Button, Card, Chips, Empty, Feedback, Header, Page, Tag, TypeTag, useListStyle } from '../components';
import { useNav } from '../nav';
import { formatDate, TONES, useTheme } from '../theme';

/** Selo de destino para comunicados que não são para todos */
const TARGET_LABELS: Record<string, string> = {
  EMPLOYEE: 'Para você',
  SECTOR: 'Para o seu setor',
  SHIFT: 'Para o seu turno',
  COMPUTER: 'Para este aparelho',
};

type Filtro = 'todos' | 'naoLidos' | 'ciencia';

export function MessagesScreen() {
  const t = useTheme();
  const nav = useNav();
  const listStyle = useListStyle();
  const { messages } = useApp();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [atualizando, setAtualizando] = useState(false);
  const naoLidos = messages.filter((m) => !m.read).length;
  const semCiencia = messages.filter((m) => m.exigeCiencia && !m.cienteEm).length;
  const lista =
    filtro === 'naoLidos' ? messages.filter((m) => !m.read) : filtro === 'ciencia' ? messages.filter((m) => m.exigeCiencia && !m.cienteEm) : messages;

  async function atualizar() {
    setAtualizando(true);
    await syncMessages();
    setAtualizando(false);
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Comunicados" subtitle={naoLidos > 0 ? `${naoLidos} não lido${naoLidos === 1 ? '' : 's'}` : 'Tudo lido'} />
      <FlatList
        data={lista}
        keyExtractor={(m) => m.id}
        contentContainerStyle={listStyle}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => void atualizar()} colors={[t.primary]} />}
        ListHeaderComponent={
          <Chips<Filtro>
            value={filtro}
            onChange={setFiltro}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'naoLidos', label: `Não lidos (${naoLidos})` },
              ...(semCiencia > 0 ? [{ value: 'ciencia' as const, label: `Pedem ciência (${semCiencia})` }] : []),
            ]}
          />
        }
        ListEmptyComponent={
          <Empty
            icon="📭"
            text={
              filtro === 'naoLidos'
                ? 'Nenhum comunicado não lido.'
                : filtro === 'ciencia'
                  ? 'Nenhum comunicado esperando a sua confirmação.'
                  : 'Nenhum comunicado recebido ainda.'
            }
          />
        }
        renderItem={({ item: m }) => (
          <Card
            onPress={() => nav.push({ name: 'message', id: m.id })}
            style={[styles.item, !m.read && { borderLeftWidth: 4, borderLeftColor: TONES[m.type].color }]}>
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
            <View style={styles.selos}>
              {m.attachments.length > 0 ? (
                <Text style={[styles.anexoSelo, { color: t.muted }]}>
                  📎 {m.attachments.length} anexo{m.attachments.length === 1 ? '' : 's'}
                </Text>
              ) : null}
              {m.exigeCiencia ? <Tag text={m.cienteEm ? 'Ciência confirmada' : 'Pede ciência'} tone={m.cienteEm ? 'ok' : 'warn'} /> : null}
            </View>
          </Card>
        )}
      />
    </View>
  );
}

export function MessageDetailScreen({ id }: { id: string }) {
  const t = useTheme();
  const nav = useNav();
  const { messages } = useApp();
  const message = messages.find((m) => m.id === id);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<OperationResult | null>(null);

  useEffect(() => {
    if (message && !message.read) void markRead(message.id);
  }, [message]);

  async function confirmar() {
    if (!message) return;
    setConfirmando(true);
    const saida = await confirmarCiencia(message.id);
    setConfirmando(false);
    setResultado(saida.ok ? null : saida);
  }

  const destino = message ? TARGET_LABELS[message.target] : undefined;

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={message ? TYPE_LABELS[message.type] : 'Comunicado'} subtitle={message?.id} onBack={nav.pop} />
      {!message ? (
        <Empty icon="🔎" text="Comunicado não encontrado. Ele pode ter sido removido." />
      ) : (
        <Page>
          <Card style={{ borderTopWidth: 4, borderTopColor: TONES[message.type].color }}>
            <View style={styles.selos}>
              <TypeTag type={message.type} />
              {destino ? <Tag text={destino} tone="info" /> : null}
            </View>
            <Text style={[styles.detailTitle, { color: t.text }]}>{message.title}</Text>
            <Text style={[styles.meta, { color: t.muted }]}>
              De {message.sender} · {formatDate(message.createdAt)}
            </Text>
            <Text style={[styles.body, { color: t.text }]} selectable>
              {message.content}
            </Text>
            <Attachments attachments={message.attachments} />
          </Card>

          {message.exigeCiencia ? (
            <Card style={[styles.ciencia, { borderColor: message.cienteEm ? t.success : t.warning }]}>
              {message.cienteEm ? (
                <Text style={[styles.cienciaTexto, { color: t.okText }]}>
                  ✓ Ciência confirmada · {formatDate(message.cienteEm)}
                </Text>
              ) : (
                <>
                  <Text style={[styles.cienciaTexto, { color: t.text }]}>
                    Este comunicado pede confirmação: o RH registra quem leu e está ciente.
                  </Text>
                  <Button title="Li e estou ciente" onPress={() => void confirmar()} loading={confirmando} />
                  <Feedback result={resultado} />
                </>
              )}
            </Card>
          ) : null}

          <Text style={[styles.readAt, { color: t.muted }]}>
            {message.readAt ? `✓ Lido · ${formatDate(message.readAt)}` : '✓ Marcado como lido'}
          </Text>
        </Page>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  item: { paddingVertical: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  date: { fontSize: 12 },
  title: { fontSize: 15.5, marginTop: 10 },
  preview: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  anexoSelo: { fontSize: 12.5, fontWeight: '600' },
  detailTitle: { fontSize: 21, fontWeight: '800', marginTop: 12, lineHeight: 27 },
  meta: { fontSize: 13, marginTop: 6 },
  body: { fontSize: 16, lineHeight: 24, marginTop: 18 },
  ciencia: { gap: 12, borderWidth: 2 },
  cienciaTexto: { fontSize: 14.5, lineHeight: 21 },
  readAt: { fontSize: 13, textAlign: 'center' },
});
