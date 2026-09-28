/**
 * Agendar comunicado ou recado do mural (DP/TI): campo de data e hora do
 * formulário e a lista do que está esperando, com cancelar. Quem envia na hora
 * certa é o servidor, mesmo com o celular desligado.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { chamar } from '../core/connection';
import { Button, Card, CheckRow, Field, Tag } from './components';
import { useTheme } from './theme';

type Status = 'PENDENTE' | 'ENVIANDO' | 'ENVIADO' | 'FALHOU' | 'CANCELADO';

interface Agendado {
  id: string;
  dados: { title?: string; titulo?: string };
  executarEm: string;
  status: Status;
  criadoPorNome: string;
  erro: string | null;
}

// Avisa as listas abertas quando algo é agendado em outra tela
const ouvintes = new Set<() => void>();
export function avisarAgendamento(): void {
  ouvintes.forEach((ouvir) => ouvir());
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** "20/10/2026" + "08:00" (hora do celular) -> ISO. null = data inválida */
export function paraIso(data: string, hora: string): string | null {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(data.trim());
  const h = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!d || !h) return null;
  const quando = new Date(Number(d[3]), Number(d[2]) - 1, Number(d[1]), Number(h[1]), Number(h[2]));
  // Recusa 31/02 e afins (o Date "pula" para o mês seguinte)
  if (quando.getDate() !== Number(d[1]) || quando.getMonth() !== Number(d[2]) - 1 || Number(h[1]) > 23) return null;
  return quando.toISOString();
}

/** "20/10/2026 às 08:00" */
export function dataPorExtenso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} às ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Máscara simples enquanto digita: 20102026 -> 20/10/2026 */
function mascaraData(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 8);
  return [n.slice(0, 2), n.slice(2, 4), n.slice(4, 8)].filter(Boolean).join('/');
}

function mascaraHora(v: string): string {
  const n = v.replace(/\D/g, '').slice(0, 4);
  return n.length > 2 ? `${n.slice(0, 2)}:${n.slice(2)}` : n;
}

export interface Agendar {
  ativo: boolean;
  data: string;
  hora: string;
}

export const SEM_AGENDAR: Agendar = { ativo: false, data: '', hora: '' };

export function CampoAgendar({ valor, onChange }: { valor: Agendar; onChange: (v: Agendar) => void }) {
  const t = useTheme();

  function ligar(ativo: boolean) {
    if (!ativo || valor.data) {
      onChange({ ...valor, ativo });
      return;
    }
    // Sugestão: amanhã às 8h
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    onChange({ ativo, data: `${p2(amanha.getDate())}/${p2(amanha.getMonth() + 1)}/${amanha.getFullYear()}`, hora: '08:00' });
  }

  return (
    <View>
      <CheckRow
        label="Agendar para uma data e hora"
        hint="O servidor envia sozinho na hora marcada, mesmo com o celular desligado."
        value={valor.ativo}
        onChange={ligar}
      />
      {valor.ativo ? (
        <View style={styles.linha}>
          <View style={styles.data}>
            <Field
              label="Data"
              value={valor.data}
              onChangeText={(v) => onChange({ ...valor, data: mascaraData(v) })}
              placeholder="dd/mm/aaaa"
              keyboardType="number-pad"
              maxLength={10}
            />
          </View>
          <View style={styles.hora}>
            <Field
              label="Hora"
              value={valor.hora}
              onChangeText={(v) => onChange({ ...valor, hora: mascaraHora(v) })}
              placeholder="hh:mm"
              keyboardType="number-pad"
              maxLength={5}
            />
          </View>
        </View>
      ) : null}
      {valor.ativo && valor.data.length === 10 && valor.hora.length === 5 && !paraIso(valor.data, valor.hora) ? (
        <Text style={[styles.erro, { color: t.errorText }]}>Data ou hora inválida.</Text>
      ) : null}
    </View>
  );
}

const SITUACAO: Record<Status, { texto: string; tom: 'ok' | 'warn' | 'error' | 'info' | 'neutral' }> = {
  PENDENTE: { texto: 'Aguardando', tom: 'info' },
  ENVIANDO: { texto: 'Enviando', tom: 'info' },
  ENVIADO: { texto: 'Enviado', tom: 'ok' },
  FALHOU: { texto: 'Falhou', tom: 'error' },
  CANCELADO: { texto: 'Cancelado', tom: 'neutral' },
};

/** Os que esperam e os últimos que falharam (os enviados aparecem na lista de sempre) */
export function ListaAgendados({ tipo }: { tipo: 'COMUNICADO' | 'MURAL' }) {
  const t = useTheme();
  const [lista, setLista] = useState<Agendado[]>([]);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const r = await chamar<{ agendamentos: Agendado[] }>('GET', `/api/agendamentos?tipo=${tipo}`);
    if (r.ok) setLista((r.dados?.agendamentos ?? []).filter((a) => a.status === 'PENDENTE' || a.status === 'ENVIANDO' || a.status === 'FALHOU'));
  }, [tipo]);

  useEffect(() => {
    void carregar();
    ouvintes.add(carregar);
    const timer = setInterval(() => void carregar(), 30_000);
    return () => {
      ouvintes.delete(carregar);
      clearInterval(timer);
    };
  }, [carregar]);

  async function cancelar(id: string) {
    setCancelando(id);
    const r = await chamar('DELETE', `/api/agendamentos/${id}`);
    setCancelando(null);
    setErro(r.ok ? '' : r.message);
    await carregar();
  }

  if (lista.length === 0) return null;

  return (
    <View style={styles.lista}>
      <Text style={[styles.titulo, { color: t.textSoft }]}>AGENDADOS</Text>
      {lista.map((item) => (
        <Card key={item.id} style={styles.item}>
          <View style={styles.cabecalho}>
            <Text style={[styles.quando, { color: t.text }]}>{dataPorExtenso(item.executarEm)}</Text>
            <Tag text={SITUACAO[item.status].texto} tone={SITUACAO[item.status].tom} />
          </View>
          <Text style={[styles.nome, { color: t.text }]} numberOfLines={2}>
            {item.dados.title ?? item.dados.titulo}
          </Text>
          <Text style={[styles.detalhe, { color: t.muted }]}>agendado por {item.criadoPorNome}</Text>
          {item.status === 'FALHOU' && item.erro ? <Text style={[styles.detalhe, { color: t.errorText }]}>{item.erro}</Text> : null}
          {item.status === 'PENDENTE' ? (
            <Button title="Cancelar" small variant="danger" onPress={() => void cancelar(item.id)} loading={cancelando === item.id} />
          ) : null}
        </Card>
      ))}
      {erro ? <Text style={[styles.detalhe, { color: t.errorText }]}>{erro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', gap: 10 },
  data: { flex: 1.4 },
  hora: { flex: 1 },
  erro: { fontSize: 13, marginTop: -4 },
  lista: { gap: 8, marginTop: 6 },
  titulo: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.5 },
  item: { gap: 6 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  quando: { fontSize: 14.5, fontWeight: '800' },
  nome: { fontSize: 15 },
  detalhe: { fontSize: 13 },
});
