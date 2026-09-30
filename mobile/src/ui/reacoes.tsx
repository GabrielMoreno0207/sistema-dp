/**
 * Reações (👍 ❤️ 😂 …) nas mensagens das conversas e nos recados do mural.
 * Cada pessoa tem uma reação por mensagem/recado: tocar em outra troca,
 * tocar na própria tira.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReacaoResumo } from '../core/types';
import { useTheme } from './theme';

/** As mesmas que o servidor aceita */
export const EMOJIS_REACAO = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function quemReagiu(nomes: string[]): string {
  if (nomes.length <= 3) return nomes.join(', ');
  return `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3}`;
}

/** Bolinhas com a contagem; a minha fica destacada. onReagir ausente = só leitura */
export function Reacoes({
  reacoes,
  onReagir,
  onLongPress,
}: {
  reacoes: ReacaoResumo[] | undefined;
  onReagir?: (emoji: string | null) => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  if (!reacoes || reacoes.length === 0) return null;
  return (
    <View style={styles.linha}>
      {reacoes.map((r) => (
        <Pressable
          key={r.emoji}
          onPress={() => onReagir?.(r.minha ? null : r.emoji)}
          onLongPress={onLongPress}
          disabled={!onReagir}
          hitSlop={6}
          style={[
            styles.chip,
            { borderColor: r.minha ? t.primary : t.border, backgroundColor: r.minha ? t.primarySoft : t.surface },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: r.minha }}
          accessibilityLabel={`${r.emoji} ${r.total}: ${quemReagiu(r.nomes)}${r.minha ? '. Toque para tirar a sua' : ''}`}>
          <Text style={styles.emoji}>{r.emoji}</Text>
          <Text style={[styles.total, { color: r.minha ? t.text : t.textSoft, fontWeight: r.minha ? '800' : '600' }]}>{r.total}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Fileira com os emojis para escolher (menu do toque longo e mural) */
export function SeletorDeReacao({ minha, onEscolher }: { minha: string | null; onEscolher: (emoji: string | null) => void }) {
  const t = useTheme();
  return (
    <View style={styles.seletor}>
      {EMOJIS_REACAO.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onEscolher(emoji === minha ? null : emoji)}
          style={[styles.opcao, emoji === minha ? { backgroundColor: t.primarySoft, borderColor: t.primary, borderWidth: 1 } : null]}
          accessibilityRole="button"
          accessibilityLabel={emoji === minha ? `Tirar a reação ${emoji}` : `Reagir com ${emoji}`}>
          <Text style={styles.opcaoEmoji}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Reações do mural: as bolinhas e um botão que abre os emojis */
export function ReacoesDoMural({ reacoes, onReagir }: { reacoes: ReacaoResumo[] | undefined; onReagir?: (emoji: string | null) => void }) {
  const t = useTheme();
  const [escolhendo, setEscolhendo] = useState(false);
  const minha = reacoes?.find((r) => r.minha)?.emoji ?? null;
  if (!onReagir) return <Reacoes reacoes={reacoes} />;
  return (
    <View style={styles.mural}>
      <View style={styles.muralLinha}>
        <Reacoes reacoes={reacoes} onReagir={onReagir} />
        <Pressable
          onPress={() => setEscolhendo((v) => !v)}
          hitSlop={8}
          style={[styles.chip, styles.reagir, { borderColor: escolhendo ? t.primary : t.border, backgroundColor: t.surface }]}
          accessibilityRole="button"
          accessibilityLabel="Reagir ao recado">
          <Text style={[styles.reagirTexto, { color: t.link }]}>{minha ? 'Trocar reação' : '🙂 Reagir'}</Text>
        </Pressable>
      </View>
      {escolhendo ? (
        <SeletorDeReacao
          minha={minha}
          onEscolher={(emoji) => {
            setEscolhendo(false);
            onReagir(emoji);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  emoji: { fontSize: 15 },
  total: { fontSize: 13 },
  seletor: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 14 },
  opcao: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  opcaoEmoji: { fontSize: 27 },
  mural: { gap: 4, marginTop: 4 },
  muralLinha: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  reagir: { marginTop: 4, paddingVertical: 5 },
  reagirTexto: { fontSize: 13, fontWeight: '700' },
});
