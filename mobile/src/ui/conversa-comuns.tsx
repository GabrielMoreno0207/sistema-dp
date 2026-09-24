/** Peças das conversas: balão da mensagem, texto com links e código, citação */
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { abrirMidia, tamanhoLegivel } from '../core/arquivos';
import type { ConversaResumo, MensagemConversa, Participante } from '../core/types';
import { MidiaImage } from './components';
import { useNav } from './nav';
import { formatDayLabel, formatTime, useTheme } from './theme';

/** Em conversa direta, a pessoa do outro lado (é dela a foto e o nome) */
export function outraPessoa(conversa: ConversaResumo, meuId: string): Participante | null {
  if (conversa.tipo !== 'DIRETA') return null;
  return conversa.participantes.find((p) => p.id !== meuId) ?? null;
}

export function juntarMensagens(atuais: MensagemConversa[], novas: MensagemConversa[]): MensagemConversa[] {
  const porId = new Map(atuais.map((m) => [m.id, m]));
  for (const m of novas) porId.set(m.id, m);
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

/** Texto curto da mensagem citada, para o bloco acima do campo de escrever */
export function resumoDaCitacao(mensagem: MensagemConversa): string {
  if (mensagem.apagadaEm) return 'mensagem apagada';
  if (mensagem.conteudo) return mensagem.conteudo.slice(0, 120);
  if (mensagem.midia) return mensagem.midia.nome;
  return 'anexo';
}

/** Texto da última mensagem na lista de conversas */
export function previaDaConversa(conversa: ConversaResumo, meuNome: string): string {
  const ultima = conversa.ultimaMensagem;
  if (!ultima) return conversa.tipo === 'GRUPO' ? 'Grupo criado' : 'Toque para conversar';
  if (ultima.tipo === 'SISTEMA') return ultima.conteudo;
  const autor = ultima.autorNome === meuNome ? 'Você' : conversa.tipo === 'GRUPO' ? ultima.autorNome.split(/\s+/)[0] : '';
  return autor ? `${autor}: ${ultima.conteudo}` : ultima.conteudo;
}

// ---------------------------------------------------------------- texto

const URL_REGEX = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

function TextoComLinks({ texto, cor, corLink }: { texto: string; cor: string; corLink: string }) {
  const partes = texto.split(URL_REGEX);
  return (
    <Text style={[styles.texto, { color: cor }]}>
      {partes.map((parte, i) =>
        /^https?:\/\//i.test(parte) ? (
          <Text key={i} style={[styles.link, { color: corLink }]} onPress={() => void Linking.openURL(parte).catch(() => {})}>
            {parte}
          </Text>
        ) : (
          parte.split(/(`[^`\n]+`)/).map((pedaco, j) =>
            /^`[^`\n]+`$/.test(pedaco) ? (
              <Text key={`${i}-${j}`} style={styles.codigoCurto}>
                {pedaco.slice(1, -1)}
              </Text>
            ) : (
              pedaco
            ),
          )
        ),
      )}
    </Text>
  );
}

/** Conteúdo da mensagem: blocos de código entre ``` , trechos entre crases e endereços clicáveis */
export function TextoDaMensagem({ texto, cor, corLink }: { texto: string; cor: string; corLink: string }) {
  const t = useTheme();
  const partes = texto.split(/```(?:[\w+#-]{0,20})?\r?\n?([\s\S]*?)```/);
  if (partes.length === 1) return <TextoComLinks texto={texto} cor={cor} corLink={corLink} />;
  return (
    <View style={styles.blocos}>
      {partes.map((parte, i) =>
        i % 2 === 1 ? (
          <View key={i} style={[styles.blocoCodigo, { backgroundColor: t.dark ? '#0b1116' : '#f4f6f9', borderColor: t.border }]}>
            <Text style={[styles.codigo, { color: t.text }]} selectable>
              {parte.replace(/\n$/, '')}
            </Text>
          </View>
        ) : parte.trim() ? (
          <TextoComLinks key={i} texto={parte.trim()} cor={cor} corLink={corLink} />
        ) : null,
      )}
    </View>
  );
}

// ---------------------------------------------------------------- balão

export function SeparadorDeDia({ iso }: { iso: string }) {
  const t = useTheme();
  return (
    <View style={styles.dia}>
      <Text style={[styles.diaTexto, { backgroundColor: t.surface2, color: t.muted }]}>{formatDayLabel(iso)}</Text>
    </View>
  );
}

export function Balao({
  mensagem,
  minha,
  emGrupo,
  lida,
  destacada,
  onAcoes,
  onIrAte,
  onErro,
}: {
  mensagem: MensagemConversa;
  minha: boolean;
  emGrupo: boolean;
  lida: boolean;
  destacada: boolean;
  /** Toque longo: responder, encaminhar, apagar */
  onAcoes?: () => void;
  onIrAte?: (id: number) => void;
  onErro: (mensagem: string) => void;
}) {
  const t = useTheme();
  const nav = useNav();
  const [abrindo, setAbrindo] = useState(false);

  if (mensagem.tipo === 'SISTEMA') {
    return (
      <View style={styles.sistema}>
        <Text style={[styles.sistemaTexto, { color: t.muted, backgroundColor: t.surface2 }]}>{mensagem.conteudo}</Text>
      </View>
    );
  }

  const midia = mensagem.midia;
  const apagada = mensagem.apagadaEm !== null;

  async function abrirArquivo() {
    if (!midia) return;
    setAbrindo(true);
    const resultado = await abrirMidia(midia);
    setAbrindo(false);
    if (!resultado.ok) onErro(resultado.message);
  }

  return (
    <View style={[styles.linha, minha ? styles.linhaMinha : styles.linhaOutra]}>
      <Pressable
        onLongPress={apagada ? undefined : onAcoes}
        delayLongPress={350}
        style={[
          styles.balao,
          {
            backgroundColor: minha ? t.bubbleMine : t.bubbleOther,
            borderColor: destacada ? t.warning : minha ? 'transparent' : t.border,
            borderWidth: destacada ? 2 : minha ? 0 : StyleSheet.hairlineWidth,
          },
        ]}>
        {!minha && emGrupo ? <Text style={[styles.autor, { color: t.link }]}>{mensagem.autorNome}</Text> : null}
        {!minha && !emGrupo && mensagem.automatica ? (
          <Text style={[styles.auto, { color: t.muted }]}>🤖 Resposta automática</Text>
        ) : null}

        {mensagem.respondida && !apagada ? (
          <Pressable
            onPress={() => onIrAte?.(mensagem.respondida!.id)}
            style={[styles.citacao, { borderLeftColor: t.primary, backgroundColor: t.dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.05)' }]}>
            <Text style={[styles.citacaoAutor, { color: t.link }]} numberOfLines={1}>
              {mensagem.respondida.autorNome}
            </Text>
            <Text style={[styles.citacaoTexto, { color: t.textSoft, fontStyle: mensagem.respondida.apagada ? 'italic' : 'normal' }]} numberOfLines={2}>
              {mensagem.respondida.resumo}
            </Text>
          </Pressable>
        ) : null}

        {mensagem.encaminhada && !apagada ? <Text style={[styles.encaminhada, { color: t.muted }]}>↪ encaminhada</Text> : null}

        {apagada ? (
          <Text style={[styles.texto, styles.apagada, { color: t.muted }]}>mensagem apagada</Text>
        ) : (
          <>
            {midia?.tipo === 'IMAGEM' ? (
              <Pressable onPress={() => nav.push({ name: 'imagem', midia })} onLongPress={onAcoes} accessibilityLabel={`Abrir imagem ${midia.nome}`}>
                <MidiaImage midiaId={midia.id} style={[styles.imagem, { backgroundColor: t.surface2 }]} />
              </Pressable>
            ) : null}
            {midia && midia.tipo !== 'IMAGEM' ? (
              <Pressable
                onPress={() => void abrirArquivo()}
                onLongPress={onAcoes}
                disabled={abrindo}
                style={[styles.arquivo, { borderColor: t.border, backgroundColor: t.dark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.7)' }]}>
                <Text style={styles.arquivoIcone}>{midia.tipo === 'VIDEO' ? '▶️' : '📄'}</Text>
                <View style={styles.flex}>
                  <Text style={[styles.arquivoNome, { color: t.text }]} numberOfLines={2}>
                    {midia.nome}
                  </Text>
                  <Text style={[styles.arquivoTamanho, { color: t.muted }]}>
                    {tamanhoLegivel(midia.tamanho)} · {midia.tipo === 'VIDEO' ? 'toque para assistir' : 'toque para abrir'}
                  </Text>
                </View>
                {abrindo ? <ActivityIndicator color={t.primary} /> : null}
              </Pressable>
            ) : null}
            {mensagem.conteudo ? <TextoDaMensagem texto={mensagem.conteudo} cor={minha ? t.onBubbleMine : t.text} corLink={t.link} /> : null}
          </>
        )}

        <View style={styles.meta}>
          <Text style={[styles.hora, { color: t.muted }]}>{formatTime(mensagem.createdAt)}</Text>
          {minha && !apagada ? <Text style={[styles.tique, { color: lida ? t.link : t.muted }]}>{lida ? '✓✓' : '✓'}</Text> : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  blocos: { gap: 6 },
  texto: { fontSize: 15.5, lineHeight: 21 },
  link: { textDecorationLine: 'underline' },
  codigoCurto: { fontFamily: 'monospace', fontSize: 14 },
  blocoCodigo: { borderWidth: 1, borderRadius: 8, padding: 8 },
  codigo: { fontFamily: 'monospace', fontSize: 13 },
  dia: { alignItems: 'center', marginVertical: 8 },
  diaTexto: { fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  sistema: { alignItems: 'center', marginVertical: 4, paddingHorizontal: 24 },
  sistemaTexto: { fontSize: 12.5, textAlign: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden' },
  linha: { flexDirection: 'row', marginVertical: 2, paddingHorizontal: 10 },
  linhaMinha: { justifyContent: 'flex-end' },
  linhaOutra: { justifyContent: 'flex-start' },
  balao: { maxWidth: '84%', borderRadius: 14, paddingHorizontal: 11, paddingTop: 7, paddingBottom: 5, gap: 4 },
  autor: { fontSize: 12.5, fontWeight: '800' },
  auto: { fontSize: 11.5, fontWeight: '700' },
  citacao: { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
  citacaoAutor: { fontSize: 12, fontWeight: '800' },
  citacaoTexto: { fontSize: 13 },
  encaminhada: { fontSize: 11.5, fontStyle: 'italic' },
  apagada: { fontStyle: 'italic' },
  imagem: { width: 230, height: 230, borderRadius: 10 },
  arquivo: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 9, minWidth: 210 },
  arquivoIcone: { fontSize: 24 },
  arquivoNome: { fontSize: 14, fontWeight: '600' },
  arquivoTamanho: { fontSize: 12 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: 4 },
  hora: { fontSize: 11 },
  tique: { fontSize: 11, fontWeight: '800' },
});
