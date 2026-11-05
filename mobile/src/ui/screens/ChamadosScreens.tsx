/**
 * Chamados para o TI no celular.
 *
 * Mesma ideia do aplicativo do computador: a tela já começa na grade de
 * ícones, porque pedir ajuda tem que ser um toque na figura do que está com
 * problema — e não um formulário. Quem quiser contar mais escreve uma linha na
 * tela seguinte; quem não quiser só aperta Enviar.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { chamar } from '../../core/connection';
import { useApp } from '../../core/store';
import type { CategoriaChamado, ChamadoCompleto, ChamadoResumo, StatusChamado } from '../../core/types';
import { Badge, Button, Card, Empty, Feedback, Field, Header, Page, SectionTitle, Tag } from '../components';
import { useNav } from '../nav';
import { useTheme } from '../theme';

/** As ocasiões, cada uma com o ícone e um exemplo do que cobre. */
export const CATEGORIAS: {
  valor: CategoriaChamado;
  label: string;
  icone: string;
  exemplo: string;
  descricaoObrigatoria?: boolean;
  pergunta?: string;
  dica?: string;
}[] = [
  { valor: 'COMPUTADOR', label: 'Computador', icone: '🖥️', exemplo: 'Não liga, travando, lento' },
  { valor: 'IMPRESSORA', label: 'Impressora', icone: '🖨️', exemplo: 'Não imprime, sem papel, atolou' },
  { valor: 'TOTVS', label: 'TOTVS', icone: '🗄️', exemplo: 'Erro, lentidão ou dúvida no TOTVS' },
  { valor: 'SISTEMA', label: 'Sistema', icone: '🪟', exemplo: 'Programa com erro ou fechando' },
  { valor: 'REDE', label: 'Rede', icone: '📶', exemplo: 'Sem internet, rede caindo' },
  { valor: 'ACESSO', label: 'Acesso e senha', icone: '🔑', exemplo: 'Esqueci a senha, sem permissão' },
  {
    valor: 'RELATORIO',
    label: 'Relatório',
    icone: '📊',
    exemplo: 'Pedir um relatório novo',
    descricaoObrigatoria: true,
    pergunta: 'Como precisa ser o relatório?',
    dica: 'Quais informações precisa mostrar, de qual período, com qual filtro e para que vai ser usado.',
  },
  { valor: 'OUTRO', label: 'Outro', icone: '❓', exemplo: 'Não sei em qual encaixa' },
];

export const ROTULO_CATEGORIA: Record<CategoriaChamado, string> = CATEGORIAS.reduce(
  (mapa, item) => ({ ...mapa, [item.valor]: item.label }),
  {} as Record<CategoriaChamado, string>,
);

export const ICONE_CATEGORIA: Record<CategoriaChamado, string> = CATEGORIAS.reduce(
  (mapa, item) => ({ ...mapa, [item.valor]: item.icone }),
  {} as Record<CategoriaChamado, string>,
);

export const ROTULO_STATUS: Record<StatusChamado, string> = {
  ABERTO: 'Aberto',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
};

const ETAPAS: StatusChamado[] = ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO'];

export const TOM_STATUS: Record<StatusChamado, 'warn' | 'info' | 'ok' | 'neutral'> = {
  ABERTO: 'warn',
  EM_ANDAMENTO: 'info',
  RESOLVIDO: 'ok',
  FECHADO: 'neutral',
};

export function quando(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? `Hoje, ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Andamento em quatro traços: dá para ver sem abrir o chamado. */
export function BarraAndamento({ status }: { status: StatusChamado }) {
  const t = useTheme();
  const atual = ETAPAS.indexOf(status);
  const cor = status === 'RESOLVIDO' || status === 'FECHADO' ? t.success : t.primary;
  return (
    <View style={styles.barra} accessibilityLabel={`Situação: ${ROTULO_STATUS[status]}`}>
      {ETAPAS.map((etapa, posicao) => (
        <View key={etapa} style={[styles.barraPasso, { backgroundColor: posicao <= atual ? cor : t.border }]} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- lista

export function ChamadosScreen() {
  const t = useTheme();
  const nav = useNav();
  const { chamadosVersao } = useApp();
  const [chamados, setChamados] = useState<ChamadoResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<{ ok: boolean; message: string } | null>(null);

  const carregar = useCallback(async () => {
    const resposta = await chamar<{ chamados?: ChamadoResumo[] }>('GET', '/api/chamados');
    setCarregando(false);
    if (!resposta.ok) {
      setAviso({ ok: false, message: resposta.message });
      return;
    }
    setAviso(null);
    setChamados(resposta.dados?.chamados ?? []);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, chamadosVersao]);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Chamados para o TI" onBack={() => nav.pop()} />
      <Page refreshControl={<RefreshControl refreshing={false} onRefresh={() => void carregar()} />}>
        <Text style={[styles.intro, { color: t.muted }]}>Toque no que está com problema. O TI recebe na hora.</Text>

        <View style={styles.grade}>
          {CATEGORIAS.map((categoria) => (
            <Pressable
              key={categoria.valor}
              onPress={() => nav.push({ name: 'novoChamado', categoria: categoria.valor })}
              style={({ pressed }) => [
                styles.ocasiao,
                { backgroundColor: t.surface, borderColor: t.border },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.ocasiaoIcone}>{categoria.icone}</Text>
              <Text style={[styles.ocasiaoNome, { color: t.text }]}>{categoria.label}</Text>
              <Text style={[styles.ocasiaoExemplo, { color: t.muted }]}>{categoria.exemplo}</Text>
            </Pressable>
          ))}
        </View>

        <Feedback result={aviso} />

        {carregando ? null : chamados.length === 0 ? (
          <Empty icon="🛟" text="Você ainda não abriu nenhum chamado." />
        ) : (
          <>
            <SectionTitle>Meus chamados</SectionTitle>
            {chamados.map((chamado) => (
              <Card key={chamado.id} onPress={() => nav.push({ name: 'chamado', id: chamado.id })} style={styles.item}>
                <Text style={styles.itemIcone}>{ICONE_CATEGORIA[chamado.categoria]}</Text>
                <View style={styles.flex}>
                  <Text style={[styles.itemTitulo, { color: t.text }]} numberOfLines={1}>
                    #{chamado.numero} · {chamado.titulo}
                  </Text>
                  <BarraAndamento status={chamado.status} />
                  <Text style={[styles.itemDetalhe, { color: t.muted }]} numberOfLines={1}>
                    {chamado.responsavelNome ? `Com ${chamado.responsavelNome}` : `Aberto em ${quando(chamado.createdAt)}`}
                  </Text>
                </View>
                <View style={styles.itemLado}>
                  <Tag text={ROTULO_STATUS[chamado.status]} tone={TOM_STATUS[chamado.status]} />
                  <Badge count={chamado.mensagensNaoLidas} />
                </View>
              </Card>
            ))}
          </>
        )}
      </Page>
    </View>
  );
}

// ---------------------------------------------------------------- abertura

/** Primeira linha do que a pessoa escreveu, para virar o título da fila. */
function tituloDoTexto(texto: string, categoria: CategoriaChamado): string {
  const primeira = texto.split('\n')[0]?.trim() ?? '';
  if (!primeira) return ROTULO_CATEGORIA[categoria];
  return primeira.length > 80 ? `${primeira.slice(0, 79)}…` : primeira;
}

export function NovoChamadoScreen({ categoria }: { categoria: CategoriaChamado }) {
  const t = useTheme();
  const nav = useNav();
  const escolhida = CATEGORIAS.find((item) => item.valor === categoria);
  const obrigatorio = escolhida?.descricaoObrigatoria === true;
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; message: string } | null>(null);
  const faltaTexto = obrigatorio && texto.trim().length < 15;

  async function enviar() {
    setEnviando(true);
    setAviso(null);
    const limpo = texto.trim();
    const resposta = await chamar('POST', '/api/chamados', {
      titulo: obrigatorio ? `Relatório: ${tituloDoTexto(limpo, categoria)}` : tituloDoTexto(limpo, categoria),
      // O servidor exige descrição; sem texto, o próprio ícone é o recado
      descricao: limpo || `Aberto pelo ícone "${ROTULO_CATEGORIA[categoria]}", sem detalhes.`,
      categoria,
      prioridade: 'NORMAL',
      midiaIds: [],
    });
    setEnviando(false);
    if (!resposta.ok) {
      setAviso({ ok: false, message: resposta.message });
      return;
    }
    nav.pop();
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Abrir chamado" onBack={() => nav.pop()} />
      <Page keyboard>
        <Card style={styles.escolha}>
          <Text style={styles.escolhaIcone}>{escolhida?.icone}</Text>
          <View style={styles.flex}>
            <Text style={[styles.escolhaNome, { color: t.text }]}>{ROTULO_CATEGORIA[categoria]}</Text>
            <Text style={[styles.ocasiaoExemplo, { color: t.muted }]}>{escolhida?.exemplo}</Text>
          </View>
        </Card>

        <Field
          label={obrigatorio ? (escolhida?.pergunta ?? 'Conte o que precisa') : 'Quer contar mais? (opcional)'}
          hint={obrigatorio ? escolhida?.dica : undefined}
          value={texto}
          onChangeText={setTexto}
          multiline
          numberOfLines={obrigatorio ? 6 : 4}
          maxLength={2000}
          placeholder={obrigatorio ? 'Descreva o relatório que você precisa…' : 'Ex.: a impressora do setor não puxa o papel'}
        />

        <Feedback result={aviso} />
        <Button title={enviando ? 'Enviando…' : 'Enviar chamado'} onPress={() => void enviar()} loading={enviando} disabled={faltaTexto} />
      </Page>
    </View>
  );
}

// ---------------------------------------------------------------- um chamado

export function ChamadoScreen({ id }: { id: string }) {
  const t = useTheme();
  const nav = useNav();
  const { chamadosVersao } = useApp();
  const [chamado, setChamado] = useState<ChamadoCompleto | null>(null);
  const [resposta, setResposta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; message: string } | null>(null);

  const carregar = useCallback(async () => {
    const saida = await chamar<ChamadoCompleto>('GET', `/api/chamados/${id}`);
    if (!saida.ok || !saida.dados) {
      setAviso({ ok: false, message: saida.message });
      return;
    }
    setChamado(saida.dados);
    if (saida.dados.naoLidas > 0) await chamar('POST', `/api/chamados/${id}/lidas`);
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar, chamadosVersao]);

  async function responder() {
    if (!resposta.trim()) return;
    setEnviando(true);
    const saida = await chamar('POST', `/api/chamados/${id}/mensagens`, { conteudo: resposta.trim() });
    setEnviando(false);
    if (!saida.ok) {
      setAviso({ ok: false, message: saida.message });
      return;
    }
    setResposta('');
    await carregar();
  }

  async function fechar() {
    const saida = await chamar('PUT', `/api/chamados/${id}/status`, { status: 'FECHADO' });
    if (!saida.ok) {
      setAviso({ ok: false, message: saida.message });
      return;
    }
    await carregar();
  }

  if (!chamado) {
    return (
      <View style={[styles.flex, { backgroundColor: t.bg }]}>
        <Header title="Chamado" onBack={() => nav.pop()} />
        <Page>
          <Feedback result={aviso} />
        </Page>
      </View>
    );
  }

  const fechado = chamado.status === 'FECHADO';

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={`#${chamado.numero}`} subtitle={chamado.titulo} onBack={() => nav.pop()} />
      <Page keyboard>
        <Card>
          <BarraAndamento status={chamado.status} />
          <View style={styles.andamentoLinha}>
            <Tag text={ROTULO_STATUS[chamado.status]} tone={TOM_STATUS[chamado.status]} />
            <Text style={[styles.itemDetalhe, { color: t.muted }]}>
              {chamado.responsavelNome ? `Com ${chamado.responsavelNome}` : 'Esperando o TI pegar'}
            </Text>
          </View>
          {chamado.status === 'RESOLVIDO' ? (
            <Button title="Está resolvido, pode fechar" onPress={() => void fechar()} style={styles.botaoFechar} />
          ) : null}
        </Card>

        <Card>
          <Text style={[styles.descricao, { color: t.text }]}>{chamado.descricao}</Text>
          <Text style={[styles.itemDetalhe, { color: t.muted }]}>
            {ROTULO_CATEGORIA[chamado.categoria]} · aberto em {quando(chamado.createdAt)}
          </Text>
        </Card>

        <SectionTitle>Conversa</SectionTitle>
        {chamado.mensagens.length === 0 ? (
          <Text style={[styles.itemDetalhe, { color: t.muted }]}>Nenhuma mensagem ainda.</Text>
        ) : (
          <FlatList
            scrollEnabled={false}
            data={chamado.mensagens}
            keyExtractor={(mensagem) => String(mensagem.id)}
            renderItem={({ item }) => {
              const minha = item.autorTipo === 'SOLICITANTE';
              return (
                <View
                  style={[
                    styles.balao,
                    { backgroundColor: minha ? t.primarySoft : t.surface2, alignSelf: minha ? 'flex-end' : 'flex-start' },
                  ]}
                >
                  <Text style={[styles.balaoAutor, { color: t.muted }]}>
                    {item.autorNome}
                    {item.autorTipo === 'TI' ? ' · TI' : ''}
                  </Text>
                  <Text style={{ color: t.text }}>{item.conteudo}</Text>
                  <Text style={[styles.balaoHora, { color: t.muted }]}>{quando(item.createdAt)}</Text>
                </View>
              );
            }}
          />
        )}

        <Feedback result={aviso} />

        {fechado ? (
          <Text style={[styles.itemDetalhe, { color: t.muted }]}>
            Este chamado está fechado. Se o problema voltar, abra um novo.
          </Text>
        ) : (
          <>
            <Field
              label="Escrever para o TI"
              value={resposta}
              onChangeText={setResposta}
              multiline
              numberOfLines={3}
              maxLength={2000}
              placeholder="Escreva aqui…"
            />
            <Button title="Enviar" onPress={() => void responder()} loading={enviando} disabled={!resposta.trim()} />
          </>
        )}
      </Page>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { fontSize: 13, marginBottom: 12 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  ocasiao: {
    width: '47.5%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 18,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 14,
  },
  ocasiaoIcone: { fontSize: 30 },
  ocasiaoNome: { fontSize: 15, fontWeight: '700' },
  ocasiaoExemplo: { fontSize: 11.5, textAlign: 'center', lineHeight: 15 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemIcone: { fontSize: 26 },
  itemTitulo: { fontSize: 15, fontWeight: '600' },
  itemDetalhe: { fontSize: 12 },
  itemLado: { alignItems: 'flex-end', gap: 6 },
  barra: { flexDirection: 'row', gap: 4, marginVertical: 7 },
  barraPasso: { flex: 1, height: 4, borderRadius: 2 },
  andamentoLinha: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  botaoFechar: { marginTop: 12 },
  escolha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  escolhaIcone: { fontSize: 32 },
  escolhaNome: { fontSize: 17, fontWeight: '700' },
  descricao: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  balao: { maxWidth: '85%', gap: 2, marginBottom: 8, padding: 10, borderRadius: 12 },
  balaoAutor: { fontSize: 11, fontWeight: '600' },
  balaoHora: { fontSize: 10.5 },
});
