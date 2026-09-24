/** Perfil do funcionário, foto (com enquadramento) e troca de senha */
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import DpNative from '../../specs/NativeDpNative';
import { enviarMidia, escolherArquivo, tirarFoto, TIPOS_MIDIA_IMAGEM } from '../../core/arquivos';
import { chamar, changePassword, logout, syncPerfil } from '../../core/connection';
import { useApp } from '../../core/store';
import type { ArquivoLocal, OperationResult } from '../../core/types';
import { Avatar, Button, ButtonRow, Card, Confirm, Feedback, Field, Header, Page } from '../components';
import { useNav } from '../nav';
import { useLayout, useTheme } from '../theme';

export function ProfileScreen() {
  const t = useTheme();
  const nav = useNav();
  const { employee, foto, device, deviceId, serverUrl } = useApp();
  const [saindo, setSaindo] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [resultado, setResultado] = useState<OperationResult | null>(null);

  async function sair() {
    setSaindo(true);
    const r = await logout();
    setSaindo(false);
    setConfirmarSaida(false);
    if (!r.ok) setResultado(r);
  }

  const linhas: [string, string][] = employee
    ? [
        ['Usuário', employee.registration],
        ['Setor', employee.sector ?? '—'],
        ['Turno', employee.shift ?? '—'],
        ...(employee.acessoAdmin !== 'NENHUM' ? [['Acesso', employee.acessoAdmin === 'TI' ? 'TI' : 'Departamento Pessoal'] as [string, string]] : []),
      ]
    : [];

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Meu perfil" subtitle={employee?.name} onBack={nav.pop} />
      <Page>
        <Card style={styles.cartao}>
          <Pressable onPress={() => nav.push({ name: 'foto' })} accessibilityLabel={foto ? 'Trocar ou enquadrar a foto' : 'Enviar uma foto'}>
            <Avatar nome={employee?.name ?? '?'} fotoMidiaId={foto?.id} size={96} />
            <View style={[styles.lapis, { backgroundColor: t.primary, borderColor: t.surface }]}>
              <Text style={styles.lapisTexto}>✏️</Text>
            </View>
          </Pressable>
          <Text style={[styles.nome, { color: t.text }]}>{employee?.name}</Text>
          <View style={styles.linhas}>
            {linhas.map(([rotulo, valor]) => (
              <View key={rotulo} style={[styles.linha, { borderColor: t.border }]}>
                <Text style={[styles.rotulo, { color: t.muted }]}>{rotulo}</Text>
                <Text style={[styles.valor, { color: t.text }]}>{valor}</Text>
              </View>
            ))}
          </View>
        </Card>
        <Button title={foto ? 'Trocar ou enquadrar a foto' : 'Enviar uma foto'} variant="secondary" onPress={() => nav.push({ name: 'foto' })} />
        <Button title="Trocar minha senha" variant="secondary" onPress={() => nav.push({ name: 'password' })} />
        <Button title="Sair (trocar de funcionário)" variant="danger" onPress={() => setConfirmarSaida(true)} />
        <Feedback result={resultado} />

        <Card>
          <Text style={[styles.subtitulo, { color: t.text }]}>Este celular</Text>
          {(
            [
              ['Identificador', deviceId ?? ''],
              ['Aparelho', device ? `${device.manufacturer} ${device.model}` : ''],
              ['Versão do aplicativo', device?.appVersion ?? ''],
              ['Servidor', serverUrl ?? 'Não configurado'],
            ] as [string, string][]
          ).map(([rotulo, valor]) => (
            <View key={rotulo} style={[styles.linha, { borderColor: t.border }]}>
              <Text style={[styles.rotulo, { color: t.muted }]}>{rotulo}</Text>
              <Text style={[styles.valor, { color: t.text }]} numberOfLines={1}>
                {valor}
              </Text>
            </View>
          ))}
        </Card>
      </Page>
      <Confirm
        visible={confirmarSaida}
        title="Sair da sua conta neste celular?"
        message="O celular continua recebendo os comunicados gerais. Para ver os seus, entre de novo."
        confirmLabel="Sair"
        danger
        loading={saindo}
        onCancel={() => setConfirmarSaida(false)}
        onConfirm={() => void sair()}
      />
    </View>
  );
}

// ---------------------------------------------------------------- foto

/** Lado do JPEG enviado ao servidor (o mesmo do computador) */
const SAIDA = 512;
const ZOOM_MAX = 4;

interface ImagemPreparada {
  uri: string;
  width: number;
  height: number;
}

/**
 * Foto de perfil: escolhe (galeria ou câmera), enquadra dentro do círculo
 * arrastando e aproximando com dois dedos, e envia só o recorte quadrado.
 */
export function FotoScreen() {
  const t = useTheme();
  const nav = useNav();
  const { width } = useLayout();
  const { foto, employee } = useApp();
  const visor = Math.min(width - 48, 320);

  const [imagem, setImagem] = useState<ImagemPreparada | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [ocupado, setOcupado] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [resultado, setResultado] = useState<OperationResult | null>(null);

  const base = imagem ? Math.max(visor / imagem.width, visor / imagem.height) : 1;

  // O PanResponder guarda o estado do gesto; os valores atuais ficam num ref
  const atual = useRef({ zoom, pos, base, imagem, visor });
  atual.current = { zoom, pos, base, imagem, visor };
  const gesto = useRef<{ pos: { x: number; y: number }; zoom: number; distancia: number | null }>({
    pos: { x: 0, y: 0 },
    zoom: 1,
    distancia: null,
  });

  function limitar(p: { x: number; y: number }, z: number) {
    const { imagem: img, base: b, visor: v } = atual.current;
    if (!img) return p;
    const maxX = Math.max((img.width * b * z - v) / 2, 0);
    const maxY = Math.max((img.height * b * z - v) / 2, 0);
    return { x: Math.min(Math.max(p.x, -maxX), maxX), y: Math.min(Math.max(p.y, -maxY), maxY) };
  }

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // A página rola: sem isso a rolagem tomaria o arrasto vertical da foto
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          gesto.current = { pos: atual.current.pos, zoom: atual.current.zoom, distancia: null };
        },
        onPanResponderMove: (evento, estado) => {
          const toques = evento.nativeEvent.touches;
          if (toques.length >= 2) {
            // Dois dedos: aproxima ou afasta pela distância entre eles
            const d = Math.hypot(toques[0].pageX - toques[1].pageX, toques[0].pageY - toques[1].pageY);
            if (gesto.current.distancia === null) {
              gesto.current = { pos: atual.current.pos, zoom: atual.current.zoom, distancia: d };
              return;
            }
            const z = Math.min(Math.max((gesto.current.zoom * d) / gesto.current.distancia, 1), ZOOM_MAX);
            setZoom(z);
            setPos(limitar(atual.current.pos, z));
            return;
          }
          if (gesto.current.distancia !== null) return; // soltou um dedo: espera o próximo gesto
          setPos(limitar({ x: gesto.current.pos.x + estado.dx, y: gesto.current.pos.y + estado.dy }, atual.current.zoom));
        },
      }),
    [],
  );

  async function preparar(arquivo: ArquivoLocal) {
    setOcupado(true);
    setResultado(null);
    try {
      const preparada = JSON.parse(await DpNative.prepareImage(arquivo.uri, 2048)) as ImagemPreparada;
      setImagem(preparada);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    } catch {
      setResultado({ ok: false, message: 'Não foi possível abrir essa imagem.' });
    } finally {
      setOcupado(false);
    }
  }

  async function escolher(origem: 'galeria' | 'camera') {
    const escolha = origem === 'camera' ? await tirarFoto() : await escolherArquivo(TIPOS_MIDIA_IMAGEM);
    if (escolha.erro) setResultado({ ok: false, message: escolha.erro });
    if (escolha.arquivo) await preparar(escolha.arquivo);
  }

  function mudarZoom(novo: number) {
    const z = Math.min(Math.max(novo, 1), ZOOM_MAX);
    setZoom(z);
    setPos((p) => limitar(p, z));
  }

  async function salvar() {
    if (!imagem) return;
    setOcupado(true);
    setResultado(null);
    try {
      const s = base * zoom;
      const lado = visor / s;
      const x = (imagem.width * s) / 2 - visor / 2 - pos.x;
      const y = (imagem.height * s) / 2 - visor / 2 - pos.y;
      const recorte = await DpNative.cropImage(imagem.uri, Math.round(x / s), Math.round(y / s), Math.round(lado), Math.round(lado), SAIDA);
      const envio = await enviarMidia({ uri: recorte, name: 'foto-perfil.jpg', mimeType: 'image/jpeg', size: -1 });
      if (!envio.midia) {
        setResultado({ ok: false, message: envio.message });
        return;
      }
      const r = await chamar('PUT', '/api/perfil/foto', { midiaId: envio.midia.id });
      if (!r.ok) {
        setResultado({ ok: false, message: r.message });
        return;
      }
      await syncPerfil();
      nav.pop();
    } catch {
      setResultado({ ok: false, message: 'Não foi possível preparar a foto.' });
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    setRemovendo(false);
    setOcupado(true);
    const r = await chamar('DELETE', '/api/perfil/foto');
    setOcupado(false);
    if (!r.ok) {
      setResultado({ ok: false, message: r.message });
      return;
    }
    await syncPerfil();
    nav.pop();
  }

  const largura = imagem ? imagem.width * base * zoom : 0;
  const altura = imagem ? imagem.height * base * zoom : 0;

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Foto de perfil" onBack={nav.pop} />
      <Page>
        {imagem ? (
          <>
            <Text style={[styles.dica, { color: t.muted }]}>Arraste a foto para escolher a parte que aparece. Use dois dedos para aproximar.</Text>
            <View
              {...responder.panHandlers}
              style={[styles.visor, { width: visor, height: visor, borderRadius: visor / 2, borderColor: t.primary, backgroundColor: t.surface2 }]}>
              <Image
                source={{ uri: imagem.uri }}
                style={{
                  position: 'absolute',
                  width: largura,
                  height: altura,
                  left: visor / 2 - largura / 2 + pos.x,
                  top: visor / 2 - altura / 2 + pos.y,
                }}
              />
            </View>
            <View style={styles.zoom}>
              <Button title="−" small variant="secondary" onPress={() => mudarZoom(zoom - 0.25)} disabled={zoom <= 1} />
              <Text style={[styles.zoomTexto, { color: t.textSoft }]}>Zoom {zoom.toFixed(1).replace('.', ',')}x</Text>
              <Button title="+" small variant="secondary" onPress={() => mudarZoom(zoom + 0.25)} disabled={zoom >= ZOOM_MAX} />
            </View>
            <Button title="Salvar foto" onPress={() => void salvar()} loading={ocupado} />
            <ButtonRow>
              <Button title="Outra da galeria" small variant="secondary" onPress={() => void escolher('galeria')} disabled={ocupado} style={styles.flex} />
              <Button title="Tirar foto" small variant="secondary" onPress={() => void escolher('camera')} disabled={ocupado} style={styles.flex} />
            </ButtonRow>
          </>
        ) : (
          <>
            <View style={styles.atual}>
              <Avatar nome={employee?.name ?? '?'} fotoMidiaId={foto?.id} size={160} />
            </View>
            {ocupado ? <ActivityIndicator color={t.primary} /> : null}
            <Button title="Escolher da galeria" onPress={() => void escolher('galeria')} disabled={ocupado} />
            <Button title="Tirar foto" variant="secondary" onPress={() => void escolher('camera')} disabled={ocupado} />
            {foto ? <Button title="Remover foto" variant="danger" onPress={() => setRemovendo(true)} disabled={ocupado} /> : null}
          </>
        )}
        <Feedback result={resultado} />
      </Page>
      <Confirm
        visible={removendo}
        title="Remover a sua foto?"
        message="No lugar dela aparecem as suas iniciais."
        confirmLabel="Remover"
        danger
        onCancel={() => setRemovendo(false)}
        onConfirm={() => void remover()}
      />
    </View>
  );
}

// ---------------------------------------------------------------- senha

export function PasswordScreen({ forced }: { forced?: boolean }) {
  const t = useTheme();
  const nav = useNav();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OperationResult | null>(null);

  async function submit() {
    if (next.length < 8) return setResult({ ok: false, message: 'A nova senha precisa ter pelo menos 8 caracteres.' });
    if (next !== confirm) return setResult({ ok: false, message: 'A confirmação não confere com a nova senha.' });
    setBusy(true);
    const outcome = await changePassword(current, next);
    setBusy(false);
    setResult(outcome);
    if (outcome.ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
      if (!forced) setTimeout(nav.pop, 700);
    }
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Trocar senha" subtitle={forced ? 'Crie uma senha sua para continuar' : undefined} onBack={forced ? undefined : nav.pop} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Page>
          <Card>
            <Field label="Senha atual" value={current} onChangeText={setCurrent} secureTextEntry maxLength={128} />
            <Field label="Nova senha" value={next} onChangeText={setNext} secureTextEntry hint="Mínimo de 8 caracteres." maxLength={128} />
            <Field
              label="Confirmar nova senha"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              maxLength={128}
              onSubmitEditing={() => void submit()}
            />
            <Button title="Salvar nova senha" onPress={() => void submit()} loading={busy} disabled={!current || !next || !confirm} />
            <Feedback result={result} />
          </Card>
        </Page>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cartao: { alignItems: 'center', gap: 10 },
  lapis: { position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  lapisTexto: { fontSize: 13 },
  nome: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  linhas: { alignSelf: 'stretch' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  rotulo: { fontSize: 14 },
  valor: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  subtitulo: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
  dica: { fontSize: 13.5, textAlign: 'center' },
  visor: { alignSelf: 'center', overflow: 'hidden', borderWidth: 3 },
  zoom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  zoomTexto: { fontSize: 14, minWidth: 90, textAlign: 'center' },
  atual: { alignItems: 'center', paddingVertical: 12 },
});
