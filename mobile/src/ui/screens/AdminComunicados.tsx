/**
 * Comunicados do DP (quem é do setor do DP ou do TI): enviar, ver os enviados,
 * quem leu e quem confirmou ciência, e lembrar quem falta. Apagar é do TI.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { enviarAnexoComunicado, escolherArquivo, tamanhoLegivel, TIPOS_ANEXO_COMUNICADO } from '../../core/arquivos';
import { chamar } from '../../core/connection';
import { useApp } from '../../core/store';
import { TYPE_LABELS, type MessageType, type OperationResult } from '../../core/types';
import {
  Button,
  Card,
  CheckRow,
  Chips,
  Confirm,
  Empty,
  Feedback,
  Field,
  Header,
  HeaderButton,
  Loading,
  Page,
  SectionTitle,
  Select,
  Tag,
  TypeTag,
  useListStyle,
} from '../components';
import { avisarAgendamento, CampoAgendar, dataPorExtenso, ListaAgendados, paraIso, SEM_AGENDAR, type Agendar } from '../agendamento';
import { useNav } from '../nav';
import { formatDate, TONES, useTheme } from '../theme';

type Destino = 'ALL' | 'SECTOR' | 'SHIFT' | 'COMPUTER' | 'EMPLOYEE';

const TIPOS: { value: MessageType; label: string }[] = [
  { value: 'COMUNICADO', label: 'Comunicado' },
  { value: 'AVISO', label: 'Aviso' },
  { value: 'INFORMATIVO', label: 'Informativo' },
  { value: 'URGENTE', label: 'Urgente' },
];

const DESTINOS: { value: Destino; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'SECTOR', label: 'Um setor' },
  { value: 'SHIFT', label: 'Um turno' },
  { value: 'COMPUTER', label: 'Um aparelho' },
  { value: 'EMPLOYEE', label: 'Um funcionário' },
];

interface EnviadoResumo {
  id: string;
  title: string;
  content: string;
  type: MessageType;
  target: Destino;
  targetId: string | null;
  sender: string;
  createdAt: string;
  exigeCiencia: boolean;
  readCount: number;
  recipientCount: number;
}

interface Leitura {
  type: string;
  id: string;
  name: string;
  detail: string | null;
  sector: string | null;
  computer: string | null;
  readAt: string;
  cienteEm: string | null;
}

interface Pendente {
  type: string;
  id: string;
  name: string;
  detail: string | null;
  sector: string | null;
  situation: string;
}

export function AdminComunicadosScreen() {
  const t = useTheme();
  const nav = useNav();
  const listStyle = useListStyle();
  const { employee } = useApp();
  const ehTi = employee?.acessoAdmin === 'TI';
  const [enviados, setEnviados] = useState<EnviadoResumo[] | null>(null);
  const [resultado, setResultado] = useState<OperationResult | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [apagando, setApagando] = useState<EnviadoResumo | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamar<{ messages: EnviadoResumo[] }>('GET', '/api/admin/messages?limit=100');
    if (!r.ok) {
      setResultado({ ok: false, message: r.message });
      setEnviados([]);
      return;
    }
    setEnviados(r.dados?.messages ?? []);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function apagar(comunicado: EnviadoResumo) {
    setApagando(null);
    const r = await chamar('DELETE', `/api/admin/messages/${encodeURIComponent(comunicado.id)}`);
    setResultado(r.ok ? { ok: true, message: `Comunicado ${comunicado.id} apagado.` } : { ok: false, message: r.message });
    await carregar();
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header
        title="Comunicados enviados"
        subtitle="Quem leu e quem confirmou"
        onBack={nav.pop}
        right={<HeaderButton label="+ Novo" onPress={() => nav.push({ name: 'adminNovoComunicado' })} accessibilityLabel="Novo comunicado" />}
      />
      <FlatList
        data={enviados ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={listStyle}
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => {
              setAtualizando(true);
              void carregar().then(() => setAtualizando(false));
            }}
            colors={[t.primary]}
          />
        }
        ListHeaderComponent={
          <View style={styles.topo}>
            <Button title="Escrever novo comunicado" onPress={() => nav.push({ name: 'adminNovoComunicado' })} />
            <Feedback result={resultado} />
            <ListaAgendados tipo="COMUNICADO" />
          </View>
        }
        ListEmptyComponent={enviados === null ? <Loading /> : <Empty icon="📤" text="Nenhum comunicado enviado ainda." />}
        renderItem={({ item: c }) => (
          <Card style={[styles.item, { borderLeftWidth: 4, borderLeftColor: TONES[c.type].color }]}>
            <View style={styles.linhaEntre}>
              <TypeTag type={c.type} />
              <Text style={[styles.data, { color: t.muted }]}>{formatDate(c.createdAt)}</Text>
            </View>
            <Text style={[styles.titulo, { color: t.text }]}>{c.title}</Text>
            <Text style={[styles.detalhe, { color: t.muted }]} numberOfLines={1}>
              {c.id} · {DESTINOS.find((d) => d.value === c.target)?.label ?? c.target}
              {c.targetId ? `: ${c.targetId}` : ''}
            </Text>
            <View style={styles.selos}>
              {c.exigeCiencia ? <Tag text="Pede ciência" tone="warn" /> : null}
              <Pressable onPress={() => nav.push({ name: 'adminLeituras', id: c.id, titulo: c.title })} hitSlop={8}>
                <Text style={[styles.leituras, { color: t.link }]}>
                  👁 {c.readCount} de {c.recipientCount} leram ›
                </Text>
              </Pressable>
              <View style={styles.flex} />
              {ehTi ? (
                <Pressable onPress={() => setApagando(c)} hitSlop={8}>
                  <Text style={[styles.apagar, { color: t.dangerText }]}>apagar</Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
        )}
      />
      <Confirm
        visible={apagando !== null}
        title="Apagar o comunicado?"
        message={`${apagando?.title ?? ''}\nEle some de todos os computadores e celulares.`}
        confirmLabel="Apagar"
        danger
        onCancel={() => setApagando(null)}
        onConfirm={() => apagando && void apagar(apagando)}
      />
    </View>
  );
}

export function AdminNovoComunicadoScreen() {
  const t = useTheme();
  const nav = useNav();
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<MessageType>('COMUNICADO');
  const [destino, setDestino] = useState<Destino>('ALL');
  const [destinoId, setDestinoId] = useState('');
  const [opcoes, setOpcoes] = useState<{ value: string; label: string }[]>([]);
  const [anexos, setAnexos] = useState<{ id: string; name: string; size: number }[]>([]);
  const [anexando, setAnexando] = useState(false);
  const [exigeCiencia, setExigeCiencia] = useState(false);
  const [agendar, setAgendar] = useState<Agendar>(SEM_AGENDAR);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<OperationResult | null>(null);

  // As opções de destino vêm do servidor conforme o tipo escolhido
  useEffect(() => {
    let ativo = true;
    async function carregarOpcoes() {
      setDestinoId('');
      if (destino === 'ALL') {
        setOpcoes([]);
        return;
      }
      let lista: { value: string; label: string }[] = [];
      if (destino === 'SECTOR') {
        const r = await chamar<{ sectors: { id: string; name: string }[] }>('GET', '/api/sectors');
        lista = (r.dados?.sectors ?? []).map((s) => ({ value: s.name, label: s.name }));
      } else if (destino === 'COMPUTER') {
        const r = await chamar<{ computers: { computerId: string; hostname: string }[] }>('GET', '/api/computers');
        lista = (r.dados?.computers ?? []).map((c) => ({ value: c.computerId, label: `${c.hostname} (${c.computerId})` }));
      } else {
        const r = await chamar<{ employees: { id: string; name: string; registration: string; shift: string | null }[] }>('GET', '/api/employees');
        const funcionarios = r.dados?.employees ?? [];
        lista =
          destino === 'EMPLOYEE'
            ? funcionarios.map((e) => ({ value: e.id, label: `${e.name} (${e.registration})` }))
            : [...new Set(funcionarios.map((e) => e.shift).filter((s): s is string => Boolean(s)))].map((s) => ({ value: s, label: s }));
      }
      if (ativo) setOpcoes(lista);
    }
    void carregarOpcoes();
    return () => {
      ativo = false;
    };
  }, [destino]);

  async function anexar() {
    const escolha = await escolherArquivo(TIPOS_ANEXO_COMUNICADO);
    if (escolha.erro) setResultado({ ok: false, message: escolha.erro });
    if (!escolha.arquivo) return;
    setAnexando(true);
    const envio = await enviarAnexoComunicado(escolha.arquivo);
    setAnexando(false);
    if (envio.anexo) setAnexos((a) => [...a, envio.anexo!].slice(0, 5));
    else setResultado({ ok: false, message: envio.message });
  }

  async function removerAnexo(id: string) {
    setAnexos((a) => a.filter((x) => x.id !== id));
    // Sem referência a um comunicado, o servidor apaga o arquivo enviado
    await chamar('DELETE', `/api/attachments/${id}`);
  }

  async function enviar() {
    if (destino !== 'ALL' && !destinoId) {
      setResultado({ ok: false, message: 'Escolha o destino.' });
      return;
    }
    const executarEm = agendar.ativo ? paraIso(agendar.data, agendar.hora) : null;
    if (agendar.ativo && !executarEm) {
      setResultado({ ok: false, message: 'Informe a data (dd/mm/aaaa) e a hora (hh:mm) do envio.' });
      return;
    }
    setEnviando(true);
    setResultado(null);
    const corpo = {
      title: titulo.trim(),
      content: texto.trim(),
      type: tipo,
      target: destino,
      ...(destino === 'ALL' ? {} : { targetId: destinoId }),
      ...(anexos.length > 0 ? { attachmentIds: anexos.map((a) => a.id) } : {}),
      ...(exigeCiencia ? { exigeCiencia: true } : {}),
    };
    const r = executarEm
      ? await chamar('POST', '/api/agendamentos/comunicado', { ...corpo, executarEm })
      : await chamar('POST', '/api/messages', corpo);
    setEnviando(false);
    if (!r.ok) {
      setResultado({ ok: false, message: r.message });
      return;
    }
    setTitulo('');
    setTexto('');
    setAnexos([]);
    setExigeCiencia(false);
    setAgendar(SEM_AGENDAR);
    if (executarEm) avisarAgendamento();
    setResultado({ ok: true, message: executarEm ? `Comunicado agendado para ${dataPorExtenso(executarEm)}.` : 'Comunicado enviado.' });
  }

  const tone = TONES[tipo];

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Novo comunicado" onBack={nav.pop} />
      <Page>
        <Card>
          <Field label="Título" value={titulo} onChangeText={setTitulo} maxLength={120} />
          <Field label="Mensagem" value={texto} onChangeText={setTexto} maxLength={5000} multiline />
          <Text style={[styles.rotulo, { color: t.textSoft }]}>Tipo</Text>
          <Chips value={tipo} onChange={setTipo} options={TIPOS} />
          <View style={styles.espaco} />
          <Select label="Destino" value={destino} options={DESTINOS} onChange={setDestino} />
          {destino !== 'ALL' ? (
            <Select label="Qual" value={destinoId} options={opcoes} onChange={setDestinoId} placeholder={opcoes.length ? 'Escolha...' : 'Carregando...'} />
          ) : null}

          <Text style={[styles.rotulo, { color: t.textSoft }]}>Anexos ({anexos.length}/5)</Text>
          {anexos.map((a) => (
            <View key={a.id} style={[styles.anexo, { borderColor: t.border }]}>
              <Text style={[styles.flex, { color: t.text }]} numberOfLines={1}>
                📎 {a.name} · {tamanhoLegivel(a.size)}
              </Text>
              <Pressable onPress={() => void removerAnexo(a.id)} hitSlop={10} accessibilityLabel={`Tirar ${a.name}`}>
                <Text style={{ color: t.muted, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>
          ))}
          <Button title="Anexar arquivo" small variant="secondary" onPress={() => void anexar()} disabled={anexos.length >= 5} loading={anexando} />

          <CheckRow
            label="Pedir confirmação de ciência"
            hint='A pessoa precisa tocar em "Li e estou ciente"; o DP vê a data da confirmação.'
            value={exigeCiencia}
            onChange={setExigeCiencia}
          />
          <CampoAgendar valor={agendar} onChange={setAgendar} />
          <Button
            title={agendar.ativo ? 'Agendar envio' : 'Enviar comunicado'}
            onPress={() => void enviar()}
            loading={enviando}
            disabled={!titulo.trim() || !texto.trim()}
          />
          <Feedback result={resultado} />
        </Card>

        <SectionTitle>Prévia do alerta</SectionTitle>
        <View style={[styles.previa, { backgroundColor: t.surface, borderTopColor: tone.color }]}>
          <Text style={[styles.previaTipo, { color: tone.color }]}>
            {tone.icon} {TYPE_LABELS[tipo].toUpperCase()} · DP
          </Text>
          <Text style={[styles.titulo, { color: t.text }]}>{titulo.trim() || 'Título da mensagem'}</Text>
          <Text style={[styles.detalhe, { color: t.textSoft }]} numberOfLines={5}>
            {texto.trim() || 'O texto da mensagem aparece aqui.'}
          </Text>
          {anexos.length > 0 ? <Text style={[styles.detalhe, { color: t.muted }]}>📎 {anexos.length} anexo{anexos.length > 1 ? 's' : ''}</Text> : null}
          {exigeCiencia ? <Text style={[styles.detalhe, { color: t.muted }]}>✔ pede confirmação de leitura</Text> : null}
        </View>
      </Page>
    </View>
  );
}

export function AdminLeiturasScreen({ id, titulo }: { id: string; titulo: string }) {
  const t = useTheme();
  const nav = useNav();
  const [dados, setDados] = useState<{ lista: Leitura[]; pendentes: Pendente[] } | null>(null);
  const [exigeCiencia, setExigeCiencia] = useState(false);
  const [avisando, setAvisando] = useState(false);
  const [resultado, setResultado] = useState<OperationResult | null>(null);

  useEffect(() => {
    void chamar<{ reads: Leitura[]; pending: Pendente[] | null }>('GET', `/api/messages/${encodeURIComponent(id)}/reads`).then((r) => {
      if (!r.ok) {
        setResultado({ ok: false, message: r.message });
        setDados({ lista: [], pendentes: [] });
        return;
      }
      const lista = r.dados?.reads ?? [];
      setDados({ lista, pendentes: r.dados?.pending ?? [] });
    });
    // O resumo da lista diz se o comunicado pede ciência
    void chamar<{ messages: EnviadoResumo[] }>('GET', '/api/admin/messages?limit=100').then((r) => {
      const comunicado = r.dados?.messages.find((m) => m.id === id);
      if (comunicado) setExigeCiencia(comunicado.exigeCiencia);
    });
  }, [id]);

  async function avisar() {
    setAvisando(true);
    const r = await chamar<{ avisados: number }>('POST', `/api/messages/${encodeURIComponent(id)}/avisar-pendentes`);
    setAvisando(false);
    if (!r.ok || !r.dados) {
      setResultado({ ok: false, message: r.message });
      return;
    }
    const total = r.dados.avisados;
    setResultado({
      ok: true,
      message:
        total === 0
          ? 'Ninguém para lembrar: todo mundo já leu (e confirmou, quando o comunicado pede).'
          : `Lembrete enviado para ${total} ${total === 1 ? 'pessoa' : 'pessoas'}.`,
    });
  }

  const semCiencia = exigeCiencia && (dados?.lista.some((l) => !l.cienteEm) ?? false);
  const podeAvisar = dados !== null && (dados.pendentes.length > 0 || semCiencia);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Leituras" subtitle={titulo} onBack={nav.pop} />
      {!dados ? (
        <Loading />
      ) : (
        <Page>
          {podeAvisar ? (
            <Button
              title={semCiencia && dados.pendentes.length === 0 ? '🔔 Avisar quem falta confirmar' : '🔔 Avisar quem não leu'}
              variant="secondary"
              onPress={() => void avisar()}
              loading={avisando}
            />
          ) : null}
          <Feedback result={resultado} />

          <SectionTitle>Já leram ({dados.lista.length})</SectionTitle>
          {dados.lista.length === 0 ? <Text style={{ color: t.muted }}>Ninguém leu ainda.</Text> : null}
          {dados.lista.map((l) => (
            <Card key={`${l.id}-${l.readAt}`} style={styles.pessoa}>
              <Text style={[styles.nome, { color: t.text }]}>{l.name}</Text>
              <Text style={[styles.detalhe, { color: t.muted }]}>
                {[l.detail, l.sector, l.computer ? `no ${l.computer}` : null, formatDate(l.readAt)].filter(Boolean).join(' · ')}
              </Text>
              {exigeCiencia ? (
                <Tag text={l.cienteEm ? `ciente · ${formatDate(l.cienteEm)}` : 'sem confirmação'} tone={l.cienteEm ? 'ok' : 'warn'} />
              ) : null}
            </Card>
          ))}

          {dados.pendentes.length > 0 ? (
            <>
              <SectionTitle>Ainda não leram ({dados.pendentes.length})</SectionTitle>
              {dados.pendentes.map((p) => (
                <Card key={p.id} style={styles.pessoa}>
                  <Text style={[styles.nome, { color: t.text }]}>{p.name}</Text>
                  <Text style={[styles.detalhe, { color: t.muted }]}>{[p.detail, p.sector, p.situation].filter(Boolean).join(' · ')}</Text>
                </Card>
              ))}
            </>
          ) : null}
        </Page>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topo: { gap: 10, marginBottom: 4 },
  item: { gap: 6 },
  linhaEntre: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  data: { fontSize: 12 },
  titulo: { fontSize: 15.5, fontWeight: '800' },
  detalhe: { fontSize: 13, lineHeight: 18 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 2 },
  leituras: { fontSize: 13.5, fontWeight: '700' },
  apagar: { fontSize: 13, fontWeight: '700' },
  rotulo: { fontSize: 13.5, fontWeight: '600', marginBottom: 6 },
  espaco: { height: 14 },
  anexo: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  previa: { borderRadius: 14, borderTopWidth: 5, padding: 16, gap: 6 },
  previaTipo: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  pessoa: { gap: 4, padding: 12 },
  nome: { fontSize: 15, fontWeight: '700' },
});
