/**
 * Calendário do mês com as anotações de cada um e os eventos da empresa
 * (mesmas regras do app do computador). O dia escolhido mostra a lista embaixo,
 * onde dá para anotar um evento; quem é do DP/TI pode publicar para todos.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { chamar } from '../core/connection';
import { useApp } from '../core/store';
import type { EventoAgenda } from '../core/types';
import { Button, Card, CheckRow, Confirm } from './components';
import { useTheme } from './theme';

const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const CORES = ['#17b3a3', '#3f8fd0', '#6c63c7', '#2ea36f', '#d98324', '#c0554d'];

/** Data local no formato AAAA-MM-DD (o calendário não trabalha com fuso) */
function chaveDoDia(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function porExtenso(chave: string): string {
  const [ano, mes, dia] = chave.split('-').map(Number);
  return `${String(dia).padStart(2, '0')} de ${MESES[mes - 1]} de ${ano}`;
}

/** Os 42 quadrados do mês: começa no domingo e termina completando a semana */
function diasDaGrade(ano: number, mes: number): Date[] {
  const primeiro = new Date(ano, mes, 1);
  const inicio = new Date(ano, mes, 1 - primeiro.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
}

/** "8:5" → null; "08:30" → "08:30"; "" → "" (sem hora) */
function horaValida(texto: string): string | null {
  const limpo = texto.trim();
  if (!limpo) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(limpo);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function Agenda() {
  const t = useTheme();
  const { employee } = useApp();
  const meuId = employee?.id ?? null;
  const ehTi = employee?.acessoAdmin === 'TI';
  const podePublicar = (employee?.acessoAdmin ?? 'NENHUM') !== 'NENHUM';

  const hoje = useMemo(() => new Date(), []);
  const [mesVisivel, setMesVisivel] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [escolhido, setEscolhido] = useState(() => chaveDoDia(hoje));
  const [eventos, setEventos] = useState<EventoAgenda[]>([]);
  const [aviso, setAviso] = useState('');
  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [hora, setHora] = useState('');
  const [cor, setCor] = useState(CORES[0]);
  const [paraTodos, setParaTodos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState<EventoAgenda | null>(null);

  const ano = mesVisivel.getFullYear();
  const mes = mesVisivel.getMonth();
  const grade = useMemo(() => diasDaGrade(ano, mes), [ano, mes]);

  const carregar = useCallback(async () => {
    const r = await chamar<{ eventos: EventoAgenda[] }>(
      'GET',
      `/api/eventos?de=${chaveDoDia(grade[0])}&ate=${chaveDoDia(grade[grade.length - 1])}`,
    );
    if (!r.ok) {
      setAviso(r.message);
      return;
    }
    setAviso('');
    setEventos(r.dados?.eventos ?? []);
  }, [grade]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, EventoAgenda[]>();
    for (const evento of eventos) mapa.set(evento.dia, [...(mapa.get(evento.dia) ?? []), evento]);
    return mapa;
  }, [eventos]);
  const doDia = porDia.get(escolhido) ?? [];

  async function salvar() {
    const horaLimpa = horaValida(hora);
    if (horaLimpa === null) {
      setAviso('Hora inválida. Use o formato 08:30, ou deixe em branco.');
      return;
    }
    if (!titulo.trim() || salvando) return;
    setSalvando(true);
    const r = await chamar('POST', '/api/eventos', {
      titulo: titulo.trim(),
      dia: escolhido,
      hora: horaLimpa || null,
      cor,
      escopo: paraTodos ? 'GERAL' : 'PESSOAL',
    });
    setSalvando(false);
    if (!r.ok) {
      setAviso(r.message);
      return;
    }
    setTitulo('');
    setHora('');
    setParaTodos(false);
    setCriando(false);
    await carregar();
  }

  async function apagar(evento: EventoAgenda) {
    setApagando(null);
    const r = await chamar('DELETE', `/api/eventos/${evento.id}`);
    if (!r.ok) setAviso(r.message);
    await carregar();
  }

  const chaveHoje = chaveDoDia(hoje);

  return (
    <Card style={styles.caixa}>
      <View style={styles.cabecalho}>
        <Pressable onPress={() => setMesVisivel(new Date(ano, mes - 1, 1))} hitSlop={10} style={[styles.seta, { borderColor: t.border }]} accessibilityLabel="Mês anterior">
          <Text style={[styles.setaTexto, { color: t.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.nomeDoMes, { color: t.text }]}>
          {MESES[mes][0].toUpperCase() + MESES[mes].slice(1)} de {ano}
        </Text>
        <Pressable onPress={() => setMesVisivel(new Date(ano, mes + 1, 1))} hitSlop={10} style={[styles.seta, { borderColor: t.border }]} accessibilityLabel="Próximo mês">
          <Text style={[styles.setaTexto, { color: t.text }]}>›</Text>
        </Pressable>
        <View style={styles.flex} />
        <Pressable
          onPress={() => {
            setMesVisivel(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
            setEscolhido(chaveHoje);
          }}
          style={[styles.hoje, { borderColor: t.border }]}>
          <Text style={[styles.hojeTexto, { color: t.link }]}>Hoje</Text>
        </Pressable>
      </View>

      <View style={styles.semana}>
        {DIAS_DA_SEMANA.map((dia, i) => (
          <Text key={i} style={[styles.diaDaSemana, { color: t.muted }]}>
            {dia}
          </Text>
        ))}
      </View>
      <View style={styles.grade}>
        {grade.map((data) => {
          const chave = chaveDoDia(data);
          const doMes = data.getMonth() === mes;
          const marcas = porDia.get(chave) ?? [];
          const ehEscolhido = chave === escolhido;
          const ehHoje = chave === chaveHoje;
          return (
            <Pressable
              key={chave}
              onPress={() => setEscolhido(chave)}
              accessibilityLabel={`${porExtenso(chave)}${marcas.length ? `, ${marcas.length} evento${marcas.length > 1 ? 's' : ''}` : ''}`}
              style={styles.celula}>
              <View
                style={[
                  styles.numeroCaixa,
                  ehEscolhido && { backgroundColor: t.primary },
                  !ehEscolhido && ehHoje && { borderWidth: 2, borderColor: t.primary },
                ]}>
                <Text style={[styles.numero, { color: ehEscolhido ? t.onPrimary : doMes ? t.text : t.muted, opacity: doMes ? 1 : 0.5 }]}>
                  {data.getDate()}
                </Text>
              </View>
              <View style={styles.marcas}>
                {marcas.slice(0, 3).map((e) => (
                  <View key={e.id} style={[styles.marca, { backgroundColor: e.cor }]} />
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.lado, { borderTopColor: t.border }]}>
        <View style={styles.ladoTopo}>
          <Text style={[styles.diaEscolhido, { color: t.text }]}>{porExtenso(escolhido)}</Text>
          <Button title={criando ? 'Cancelar' : '+ Evento'} small variant={criando ? 'secondary' : 'primary'} onPress={() => setCriando((v) => !v)} />
        </View>

        {criando ? (
          <View style={styles.form}>
            <TextInput
              value={titulo}
              onChangeText={setTitulo}
              placeholder="O que acontece nesse dia?"
              placeholderTextColor={t.muted}
              maxLength={120}
              style={[styles.campo, { color: t.text, borderColor: t.fieldBorder, backgroundColor: t.surface }]}
            />
            <View style={styles.linha}>
              <TextInput
                value={hora}
                onChangeText={setHora}
                placeholder="hh:mm"
                placeholderTextColor={t.muted}
                maxLength={5}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Hora (opcional)"
                style={[styles.campo, styles.campoHora, { color: t.text, borderColor: t.fieldBorder, backgroundColor: t.surface }]}
              />
              <View style={styles.cores}>
                {CORES.map((opcao) => (
                  <Pressable
                    key={opcao}
                    onPress={() => setCor(opcao)}
                    accessibilityLabel={`Cor ${opcao}`}
                    style={[styles.cor, { backgroundColor: opcao, borderColor: cor === opcao ? t.text : 'transparent' }]}
                  />
                ))}
              </View>
            </View>
            {podePublicar ? <CheckRow label="Publicar para toda a empresa" value={paraTodos} onChange={setParaTodos} /> : null}
            <Button title="Salvar evento" onPress={() => void salvar()} disabled={!titulo.trim()} loading={salvando} small />
          </View>
        ) : null}

        {aviso ? <Text style={[styles.aviso, { color: t.dangerText }]}>{aviso}</Text> : null}

        {doDia.length === 0 && !criando ? <Text style={[styles.vazio, { color: t.muted }]}>Nada marcado nesse dia.</Text> : null}
        {doDia.map((evento) => (
          <View key={evento.id} style={[styles.evento, { borderColor: t.border }]}>
            <View style={[styles.eventoCor, { backgroundColor: evento.cor }]} />
            <View style={styles.flex}>
              <Text style={[styles.eventoTitulo, { color: t.text }]}>
                {evento.hora ? `${evento.hora}  ` : ''}
                {evento.titulo}
              </Text>
              <Text style={[styles.eventoDono, { color: t.muted }]}>
                {evento.escopo === 'GERAL' ? `Empresa · ${evento.criadoPorNome}` : 'Sua anotação'}
              </Text>
            </View>
            {evento.criadoPor === meuId || ehTi ? (
              <Pressable onPress={() => setApagando(evento)} hitSlop={8}>
                <Text style={[styles.apagar, { color: t.dangerText }]}>apagar</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>

      <Confirm
        visible={apagando !== null}
        title="Apagar o evento?"
        message={apagando?.titulo}
        confirmLabel="Apagar"
        danger
        onCancel={() => setApagando(null)}
        onConfirm={() => apagando && void apagar(apagando)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  caixa: { padding: 12 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  seta: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  setaTexto: { fontSize: 22, lineHeight: 24 },
  nomeDoMes: { fontSize: 15.5, fontWeight: '800' },
  hoje: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  hojeTexto: { fontSize: 13.5, fontWeight: '700' },
  semana: { flexDirection: 'row' },
  diaDaSemana: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', paddingVertical: 4 },
  grade: { flexDirection: 'row', flexWrap: 'wrap' },
  // 14,28%: com 100/7 exato a soma passa de 100% por arredondamento e o sábado cai para a linha de baixo
  celula: { width: '14.28%', alignItems: 'center', paddingVertical: 3, minHeight: 44 },
  numeroCaixa: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numero: { fontSize: 14, fontWeight: '600' },
  marcas: { flexDirection: 'row', gap: 2, height: 6, marginTop: 2 },
  marca: { width: 5, height: 5, borderRadius: 3 },
  lado: { borderTopWidth: 1, marginTop: 8, paddingTop: 10, gap: 8 },
  ladoTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  diaEscolhido: { fontSize: 14.5, fontWeight: '800', flexShrink: 1 },
  form: { gap: 8 },
  campo: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 15 },
  campoHora: { width: 90 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  cores: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  cor: { width: 28, height: 28, borderRadius: 14, borderWidth: 3 },
  aviso: { fontSize: 13.5 },
  vazio: { fontSize: 13.5, paddingVertical: 6 },
  evento: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10 },
  eventoCor: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  eventoTitulo: { fontSize: 14.5, fontWeight: '700' },
  eventoDono: { fontSize: 12.5, marginTop: 2 },
  apagar: { fontSize: 13, fontWeight: '700' },
});
