/** Player da mensagem de voz dentro do balão da conversa */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { irPara, pausarAudio, tempoLegivel, tocarAudio, useStatusAudio } from '../core/audio';
import type { MidiaPublica } from '../core/types';
import { useTheme } from './theme';

export function PlayerDeAudio({ midia, minha, onLongPress }: { midia: MidiaPublica; minha: boolean; onLongPress?: () => void }) {
  const t = useTheme();
  const status = useStatusAudio(midia.id);
  const [largura, setLargura] = useState(0);

  const estado = status?.estado ?? 'parado';
  const tocando = estado === 'tocando';
  const carregando = estado === 'carregando';
  // O WEBM gravado no desktop não traz a duração no arquivo: vale a do servidor
  const duracao = status?.duracaoMs && status.duracaoMs > 0 ? status.duracaoMs : (midia.duracaoMs ?? 0);
  const ativo = estado === 'tocando' || estado === 'pausado';
  const posicao = ativo ? (status?.posicaoMs ?? 0) : 0;
  const progresso = duracao > 0 ? Math.min(posicao / duracao, 1) : 0;

  function alternar() {
    if (tocando) pausarAudio();
    else tocarAudio(midia, estado === 'pausado' ? posicao : 0);
  }

  /** Toque na barra: pula para aquele ponto */
  function pular(evento: GestureResponderEvent) {
    if (!duracao || largura <= 0) return;
    const alvo = (evento.nativeEvent.locationX / largura) * duracao;
    if (ativo) irPara(alvo);
    else tocarAudio(midia, alvo);
  }

  const corBotao = t.primary;
  const corTrilha = t.dark ? 'rgba(255,255,255,0.18)' : minha ? 'rgba(0,0,0,0.12)' : t.border;

  return (
    <View style={styles.player}>
      <Pressable
        onPress={alternar}
        onLongPress={onLongPress}
        style={[styles.botao, { backgroundColor: corBotao }]}
        accessibilityRole="button"
        accessibilityLabel={tocando ? 'Pausar mensagem de voz' : 'Ouvir mensagem de voz'}>
        {carregando ? (
          <ActivityIndicator color={t.onPrimary} />
        ) : (
          <Text style={[styles.icone, { color: t.onPrimary }]}>{tocando ? '❚❚' : '▶'}</Text>
        )}
      </Pressable>
      <View style={styles.meio}>
        <Pressable
          onPress={pular}
          onLongPress={onLongPress}
          onLayout={(e) => setLargura(e.nativeEvent.layout.width)}
          hitSlop={{ top: 12, bottom: 12 }}
          style={styles.areaBarra}
          accessibilityLabel="Posição da mensagem de voz">
          <View style={[styles.trilha, { backgroundColor: corTrilha }]}>
            <View style={[styles.preenchido, { backgroundColor: corBotao, width: `${progresso * 100}%` }]} />
          </View>
          <View style={[styles.bolinha, { backgroundColor: corBotao, left: Math.max(0, progresso * largura - 6) }]} />
        </Pressable>
        <Text style={[styles.tempo, { color: estado === 'erro' ? t.dangerText : t.muted }]}>
          {estado === 'erro' ? (status?.mensagem || 'Não foi possível tocar.') : `🎤 ${tempoLegivel(ativo ? posicao : duracao)}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  player: { flexDirection: 'row', alignItems: 'center', gap: 10, width: 240, maxWidth: '100%', paddingVertical: 4 },
  botao: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  icone: { fontSize: 15, fontWeight: '900' },
  meio: { flex: 1, gap: 4 },
  areaBarra: { height: 16, justifyContent: 'center' },
  trilha: { height: 4, borderRadius: 2, overflow: 'hidden' },
  preenchido: { height: 4 },
  bolinha: { position: 'absolute', width: 12, height: 12, borderRadius: 6 },
  tempo: { fontSize: 12.5, fontVariant: ['tabular-nums'] },
});
