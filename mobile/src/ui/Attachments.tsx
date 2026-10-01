/** Anexos do comunicado: imagem aberta junto com o recado, documento para abrir */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { attachmentLink, openAttachment } from '../core/connection';
import { nomeDeArquivo } from '../core/arquivos';
import type { DpAttachment } from '../core/types';
import { useTheme } from './theme';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/**
 * Imagem do comunicado, aberta junto com ele.
 *
 * O funcionário não precisa tocar em nada para ver: a imagem aparece inteira,
 * na largura do comunicado. Tocar nela abre no visualizador do celular (para
 * dar zoom ou salvar).
 */
function ImagemAberta({ attachment }: { attachment: DpAttachment }) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  // Altura real da imagem, para ela aparecer inteira sem cortar nem sobrar espaço
  const [proporcao, setProporcao] = useState(4 / 3);

  useEffect(() => {
    let ativo = true;
    void attachmentLink(attachment.id).then((link) => {
      if (!ativo) return;
      if (link) {
        setUri(link);
        Image.getSize(
          link,
          (largura, altura) => {
            if (ativo && largura > 0 && altura > 0) setProporcao(largura / altura);
          },
          () => {
            /* mantém a proporção padrão: a imagem ainda aparece */
          },
        );
      } else {
        setFalhou(true);
      }
    });
    return () => {
      ativo = false;
    };
  }, [attachment.id]);

  if (falhou) {
    return (
      <View style={[styles.imagemVazia, { borderColor: t.border, backgroundColor: t.surface }]}>
        <Text style={[styles.aviso, { color: t.muted }]}>
          Não foi possível carregar a imagem agora. Tente de novo com a internet conectada.
        </Text>
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={[styles.imagemVazia, { borderColor: t.border, backgroundColor: t.surface2 }]}>
        <ActivityIndicator color={t.muted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[styles.imagem, { aspectRatio: proporcao, borderColor: t.border }]}
      resizeMode="contain"
      onError={() => setFalhou(true)}
    />
  );
}

export function Attachments({ attachments }: { attachments: DpAttachment[] }) {
  const t = useTheme();
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const imagens = attachments.filter((a) => a.kind === 'IMAGE');
  const arquivos = attachments.filter((a) => a.kind !== 'IMAGE');

  async function abrir(id: string) {
    setAbrindo(id);
    setErro(null);
    const resultado = await openAttachment(id);
    setAbrindo(null);
    if (!resultado.ok) setErro(resultado.message);
  }

  return (
    <View style={styles.bloco}>
      {imagens.map((anexo) => (
        <Pressable key={anexo.id} onPress={() => void abrir(anexo.id)} disabled={abrindo === anexo.id}>
          <ImagemAberta attachment={anexo} />
        </Pressable>
      ))}

      {arquivos.length > 0 ? (
        <>
          <Text style={[styles.titulo, { color: t.textSoft }]}>
            📎 {arquivos.length} anexo{arquivos.length === 1 ? '' : 's'}
          </Text>

          {arquivos.map((anexo) => (
            <Pressable
              key={anexo.id}
              onPress={() => void abrir(anexo.id)}
              disabled={abrindo === anexo.id}
              style={({ pressed }) => [
                styles.item,
                { borderColor: t.border, backgroundColor: pressed ? t.surface2 : t.surface },
              ]}>
              <View style={[styles.thumb, styles.thumbVazio, { backgroundColor: t.surface2 }]}>
                <Text style={styles.icone}>📄</Text>
              </View>
              <View style={styles.info}>
                <Text style={[styles.nome, { color: t.text }]} numberOfLines={2}>
                  {nomeDeArquivo(anexo.name)}
                </Text>
                <Text style={[styles.tamanho, { color: t.muted }]}>
                  {formatSize(anexo.size)} · toque para abrir
                </Text>
              </View>
              {abrindo === anexo.id ? <ActivityIndicator color={t.primary} /> : null}
            </Pressable>
          ))}
        </>
      ) : null}

      {erro ? <Text style={[styles.erro, { color: t.danger }]}>{erro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bloco: { marginTop: 20, gap: 8 },
  titulo: { fontSize: 13, fontWeight: '700' },
  imagem: { width: '100%', borderRadius: 12, borderWidth: 1 },
  imagemVazia: { width: '100%', height: 180, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 14 },
  aviso: { fontSize: 13, textAlign: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderWidth: 1, borderRadius: 12 },
  thumb: { width: 54, height: 54, borderRadius: 8 },
  thumbVazio: { alignItems: 'center', justifyContent: 'center' },
  icone: { fontSize: 22 },
  info: { flex: 1 },
  nome: { fontSize: 14.5, fontWeight: '600' },
  tamanho: { fontSize: 12.5, marginTop: 2 },
  erro: { fontSize: 13, marginTop: 2 },
});
