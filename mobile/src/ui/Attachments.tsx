/** Anexos do comunicado: miniatura das imagens e toque para abrir o arquivo */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { attachmentLink, openAttachment } from '../core/connection';
import type { DpAttachment } from '../core/types';
import { useTheme } from './theme';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Miniatura da imagem, buscada com um link temporário do servidor */
function Thumbnail({ attachment }: { attachment: DpAttachment }) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let ativo = true;
    void attachmentLink(attachment.id).then((link) => {
      if (!ativo) return;
      if (link) setUri(link);
      else setFalhou(true);
    });
    return () => {
      ativo = false;
    };
  }, [attachment.id]);

  if (falhou) return <View style={[styles.thumb, styles.thumbVazio, { backgroundColor: t.surface2 }]}><Text style={styles.icone}>🖼️</Text></View>;
  if (!uri) {
    return (
      <View style={[styles.thumb, styles.thumbVazio, { backgroundColor: t.surface2 }]}>
        <ActivityIndicator color={t.muted} />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.thumb} resizeMode="cover" onError={() => setFalhou(true)} />;
}

export function Attachments({ attachments }: { attachments: DpAttachment[] }) {
  const t = useTheme();
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  async function abrir(id: string) {
    setAbrindo(id);
    setErro(null);
    const resultado = await openAttachment(id);
    setAbrindo(null);
    if (!resultado.ok) setErro(resultado.message);
  }

  return (
    <View style={styles.bloco}>
      <Text style={[styles.titulo, { color: t.textSoft }]}>
        📎 {attachments.length} anexo{attachments.length === 1 ? '' : 's'}
      </Text>

      {attachments.map((anexo) => (
        <Pressable
          key={anexo.id}
          onPress={() => void abrir(anexo.id)}
          disabled={abrindo === anexo.id}
          style={({ pressed }) => [
            styles.item,
            { borderColor: t.border, backgroundColor: pressed ? t.surface2 : t.surface },
          ]}>
          {anexo.kind === 'IMAGE' ? (
            <Thumbnail attachment={anexo} />
          ) : (
            <View style={[styles.thumb, styles.thumbVazio, { backgroundColor: t.surface2 }]}>
              <Text style={styles.icone}>📄</Text>
            </View>
          )}
          <View style={styles.info}>
            <Text style={[styles.nome, { color: t.text }]} numberOfLines={2}>
              {anexo.name}
            </Text>
            <Text style={[styles.tamanho, { color: t.muted }]}>
              {formatSize(anexo.size)} · toque para abrir
            </Text>
          </View>
          {abrindo === anexo.id ? <ActivityIndicator color={t.primary} /> : null}
        </Pressable>
      ))}

      {erro ? <Text style={[styles.erro, { color: t.danger }]}>{erro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bloco: { marginTop: 20, gap: 8 },
  titulo: { fontSize: 13, fontWeight: '700' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: 1, borderRadius: 12 },
  thumb: { width: 54, height: 54, borderRadius: 8 },
  thumbVazio: { alignItems: 'center', justifyContent: 'center' },
  icone: { fontSize: 22 },
  info: { flex: 1 },
  nome: { fontSize: 14.5, fontWeight: '600' },
  tamanho: { fontSize: 12.5, marginTop: 2 },
  erro: { fontSize: 13, marginTop: 2 },
});
