/**
 * Fila do TI no celular.
 *
 * Mesma fila compartilhada do computador: todo chamado cai aqui, qualquer um
 * do TI pega. Serve para quem está no chão de fábrica com o celular na mão —
 * dá para aceitar, responder, mudar o andamento e ler as notas que a outra
 * pessoa deixou, sem voltar até a mesa.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { chamar } from '../../core/connection';
import { useApp } from '../../core/store';
import type { ChamadoCompleto, ChamadoResumo, StatusChamado } from '../../core/types';
import { Badge, Button, ButtonRow, Card, Empty, Feedback, Field, Header, Page, SectionTitle, Tag } from '../components';
import { useNav } from '../nav';
import { useTheme } from '../theme';
import {
  BarraAndamento,
  ICONE_CATEGORIA,
  quando,
  ROTULO_CATEGORIA,
  ROTULO_STATUS,
  TOM_STATUS,
} from './ChamadosScreens';

const PROXIMOS_STATUS: StatusChamado[] = ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO'];

export function FilaChamadosScreen() {
  const t = useTheme();
  const nav = useNav();
  const { chamadosVersao } = useApp();
  const [chamados, setChamados] = useState<ChamadoResumo[]>([]);
  const [encerrados, setEncerrados] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<{ ok: boolean; message: string } | null>(null);

  const carregar = useCallback(async () => {
    const resposta = await chamar<{ chamados?: ChamadoResumo[] }>(
      'GET',
      `/api/chamados/fila?encerrados=${encerrados ? 'true' : 'false'}`,
    );
    setCarregando(false);
    if (!resposta.ok) {
      setAviso({ ok: false, message: resposta.message });
      return;
    }
    setAviso(null);
    setChamados(resposta.dados?.chamados ?? []);
  }, [encerrados]);

  useEffect(() => {
    void carregar();
  }, [carregar, chamadosVersao]);

  // Sem dono primeiro (é o que o time precisa ver); os de teste no fim
  const ordenados = [...chamados].sort((a, b) => {
    if (Boolean(a.teste) !== Boolean(b.teste)) return a.teste ? 1 : -1;
    const livreA = a.responsavelId === null ? 0 : 1;
    const livreB = b.responsavelId === null ? 0 : 1;
    if (livreA !== livreB) return livreA - livreB;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const livres = ordenados.filter((c) => c.responsavelId === null && c.status !== 'FECHADO' && !c.teste).length;

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Fila do TI" onBack={() => nav.pop()} />
      <Page refreshControl={<RefreshControl refreshing={false} onRefresh={() => void carregar()} />}>
        <View style={styles.topo}>
          <Text style={[styles.resumo, { color: t.muted }]}>
            {chamados.length} {chamados.length === 1 ? 'chamado' : 'chamados'}
          </Text>
          <View style={styles.chaveLinha}>
            <Text style={[styles.resumo, { color: t.muted }]}>encerrados</Text>
            <Switch value={encerrados} onValueChange={setEncerrados} />
          </View>
        </View>

        {/* Quantos estão sem dono: é o número que decide o dia do TI, então
            aparece como faixa própria e não no meio da linha de apoio */}
        {livres > 0 ? (
          <View style={[styles.aviso, { backgroundColor: t.errorBg }]}>
            <Text style={[styles.avisoTexto, { color: t.errorText }]}>
              {livres} {livres === 1 ? 'chamado esperando' : 'chamados esperando'} alguém aceitar
            </Text>
          </View>
        ) : null}

        <Feedback result={aviso} />

        {carregando ? null : ordenados.length === 0 ? (
          <Empty icon="🛠️" text="Nenhum chamado por aqui." />
        ) : (
          ordenados.map((chamado) => {
            const semDono = chamado.responsavelId === null && chamado.status !== 'FECHADO';
            // A faixa da esquerda responde antes de ler: vermelha espera alguém,
            // verde já está com alguém, cinza é chamado de teste.
            const faixa = chamado.teste ? t.border : semDono ? t.danger : t.primary;
            return (
              <Card
                key={chamado.id}
                onPress={() => nav.push({ name: 'filaChamado', id: chamado.id })}
                style={[styles.item, { borderLeftColor: faixa }, chamado.teste ? styles.itemTeste : null]}
              >
                <View style={styles.itemTopo}>
                  {/* Coluna de largura fixa: o título de todos os chamados da lista
                      começa no mesmo lugar, tenha o número uma casa ou quatro */}
                  <View style={styles.itemColuna}>
                    <Text style={styles.itemIcone}>{ICONE_CATEGORIA[chamado.categoria]}</Text>
                    <Text style={[styles.itemNumero, { color: t.muted }]}>#{chamado.numero}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={[styles.itemTitulo, { color: t.text }]} numberOfLines={2}>
                      {chamado.titulo}
                    </Text>
                    <View style={styles.quem}>
                      {chamado.solicitanteSetor === undefined ? null : (
                        <Tag text={chamado.solicitanteSetor || 'sem setor'} tone="info" />
                      )}
                      <Text style={[styles.itemDetalhe, { color: t.textSoft }]} numberOfLines={1}>
                        {chamado.solicitanteNome}
                      </Text>
                    </View>
                    <Text style={[styles.itemDetalhe, { color: t.muted, marginTop: 3 }]} numberOfLines={1}>
                      {ROTULO_CATEGORIA[chamado.categoria]} · {quando(chamado.createdAt)}
                    </Text>
                  </View>
                  <View style={styles.itemLado}>
                    <Tag text={ROTULO_STATUS[chamado.status]} tone={TOM_STATUS[chamado.status]} />
                    {chamado.teste ? <Tag text="TESTE" tone="neutral" /> : null}
                    <Badge count={chamado.mensagensNaoLidas} />
                  </View>
                </View>

                {/* Quem está atendendo numa faixa só dele: é a resposta que o TI
                    procura em cada linha da fila */}
                <View style={[styles.itemRodape, { borderTopColor: t.border }]}>
                  <Text
                    style={[styles.itemDetalhe, { color: semDono ? t.dangerText : t.textSoft }]}
                    numberOfLines={1}
                  >
                    {chamado.responsavelNome ? `Com ${chamado.responsavelNome}` : 'Sem responsável'}
                  </Text>
                  {semDono && !chamado.teste ? (
                    <Text style={[styles.itemPegar, { color: t.muted }]}>toque para aceitar</Text>
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
      </Page>
    </View>
  );
}

// ---------------------------------------------------------------- um chamado, pelo lado do TI

export function FilaChamadoScreen({ id }: { id: string }) {
  const t = useTheme();
  const nav = useNav();
  const { chamadosVersao, employee } = useApp();
  const [chamado, setChamado] = useState<ChamadoCompleto | null>(null);
  const [resposta, setResposta] = useState('');
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [confirmandoAssumir, setConfirmandoAssumir] = useState(false);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; message: string } | null>(null);

  const carregar = useCallback(async () => {
    const saida = await chamar<ChamadoCompleto>('GET', `/api/chamados/${id}`);
    if (!saida.ok || !saida.dados) {
      setAviso({ ok: false, message: saida.message });
      return;
    }
    setChamado(saida.dados);
    setConfirmandoAssumir(false);
    setConfirmandoApagar(false);
    if (saida.dados.naoLidas > 0) await chamar('POST', `/api/chamados/${id}/lidas`);
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar, chamadosVersao]);

  /** Toda ação é igual: chama, mostra o erro se houver, recarrega. */
  async function agir(metodo: 'POST' | 'PUT', caminho: string, corpo?: unknown) {
    setOcupado(true);
    const saida = await chamar(metodo, caminho, corpo);
    setOcupado(false);
    if (!saida.ok) {
      setAviso({ ok: false, message: saida.message });
      return false;
    }
    setAviso(null);
    await carregar();
    return true;
  }

  async function apagar() {
    setOcupado(true);
    const saida = await chamar('DELETE', `/api/chamados/${id}`);
    setOcupado(false);
    if (!saida.ok) {
      setAviso({ ok: false, message: saida.message });
      return;
    }
    nav.pop();
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

  const livre = chamado.responsavelId === null && chamado.status !== 'FECHADO';
  const deOutraPessoa =
    chamado.responsavelId !== null && chamado.responsavelId !== employee?.id && chamado.status !== 'FECHADO';

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={`#${chamado.numero}`} subtitle={chamado.titulo} onBack={() => nav.pop()} />
      <Page keyboard>
        <Card>
          {/* Situação, setor e teste na primeira linha: é o que se olha antes de tudo */}
          <View style={styles.quem}>
            <Tag text={ROTULO_STATUS[chamado.status]} tone={TOM_STATUS[chamado.status]} />
            {chamado.solicitanteSetor === undefined ? null : (
              <Tag text={chamado.solicitanteSetor || 'sem setor'} tone="info" />
            )}
            {chamado.teste ? <Tag text="TESTE" tone="neutral" /> : null}
          </View>
          <Text style={[styles.itemDetalhe, { color: t.muted, marginTop: 8 }]}>
            {chamado.solicitanteNome} · {ROTULO_CATEGORIA[chamado.categoria]} · {quando(chamado.createdAt)}
          </Text>
          <BarraAndamento status={chamado.status} />
          <View style={[styles.responsavelLinha, { borderTopColor: t.border }]}>
            <Text style={[styles.itemDetalhe, { color: livre ? t.dangerText : t.textSoft }]}>
              {chamado.responsavelNome ? `Com ${chamado.responsavelNome}` : 'Sem responsável'}
            </Text>
          </View>

          {livre ? (
            <Button
              title={ocupado ? 'Aceitando…' : 'Aceitar chamado'}
              onPress={() => void agir('POST', `/api/chamados/${id}/aceitar`)}
              loading={ocupado}
              style={styles.acao}
            />
          ) : null}

          {deOutraPessoa ? (
            confirmandoAssumir ? (
              <View style={styles.acao}>
                <Text style={[styles.itemDetalhe, { color: t.muted }]}>
                  Passar para você? {chamado.responsavelNome} deixa de ser responsável.
                </Text>
                <ButtonRow style={styles.acao}>
                  <Button title="Cancelar" variant="ghost" onPress={() => setConfirmandoAssumir(false)} />
                  <Button
                    title="Assumir"
                    onPress={() => void agir('POST', `/api/chamados/${id}/aceitar`, { assumir: true })}
                    loading={ocupado}
                  />
                </ButtonRow>
              </View>
            ) : (
              <Button title="Assumir o chamado" variant="ghost" onPress={() => setConfirmandoAssumir(true)} style={styles.acao} />
            )
          ) : null}
        </Card>

        <SectionTitle>Situação</SectionTitle>
        <View style={styles.situacoes}>
          {PROXIMOS_STATUS.map((status) => (
            <Button
              key={status}
              title={ROTULO_STATUS[status]}
              variant={chamado.status === status ? 'primary' : 'ghost'}
              disabled={chamado.status === status || ocupado}
              onPress={() => void agir('PUT', `/api/chamados/${id}/status`, { status })}
              style={styles.situacao}
            />
          ))}
        </View>

        <SectionTitle>O que a pessoa escreveu</SectionTitle>
        <Card>
          <Text style={[styles.descricao, { color: t.text }]}>{chamado.descricao}</Text>
        </Card>

        {/* Notas do TI: o que a outra pessoa já tentou. Quem abriu não vê nada disto. */}
        <SectionTitle>Notas do TI · só o TI vê</SectionTitle>
        {(chamado.notas ?? []).length === 0 ? (
          <Text style={[styles.itemDetalhe, { color: t.muted }]}>
            Nenhuma nota. Escreva o que outra pessoa do TI precisaria saber para continuar.
          </Text>
        ) : (
          (chamado.notas ?? []).map((item) => (
            <Card key={item.id} style={[styles.nota, { borderLeftColor: t.border }]}>
              <Text style={[styles.itemDetalhe, { color: t.muted }]}>
                {item.autorNome} · {quando(item.createdAt)}
              </Text>
              <Text style={{ color: t.text }}>{item.conteudo}</Text>
            </Card>
          ))
        )}
        <Field
          label="Escrever uma nota"
          value={nota}
          onChangeText={setNota}
          multiline
          numberOfLines={2}
          maxLength={2000}
          placeholder="Ex.: disco cheio, limpei os temporários. Se voltar, trocar o HD."
        />
        <Button
          title="Guardar nota"
          variant="ghost"
          disabled={!nota.trim() || ocupado}
          onPress={async () => {
            if (await agir('POST', `/api/chamados/${id}/notas`, { conteudo: nota.trim() })) setNota('');
          }}
        />

        <SectionTitle>Conversa com {chamado.solicitanteNome}</SectionTitle>
        {chamado.mensagens.length === 0 ? (
          <Text style={[styles.itemDetalhe, { color: t.muted }]}>Nenhuma mensagem ainda.</Text>
        ) : (
          chamado.mensagens.map((mensagem) => {
            const minha = mensagem.autorTipo === 'TI';
            return (
              <View
                key={mensagem.id}
                style={[
                  styles.balao,
                  { backgroundColor: minha ? t.primarySoft : t.surface2, alignSelf: minha ? 'flex-end' : 'flex-start' },
                ]}
              >
                <Text style={[styles.balaoAutor, { color: t.muted }]}>
                  {mensagem.autorNome}
                  {mensagem.autorTipo === 'TI' ? ' · TI' : ''}
                </Text>
                <Text style={{ color: t.text }}>{mensagem.conteudo}</Text>
                <Text style={[styles.balaoHora, { color: t.muted }]}>{quando(mensagem.createdAt)}</Text>
              </View>
            );
          })
        )}

        <Feedback result={aviso} />

        {chamado.status !== 'FECHADO' ? (
          <>
            <Field
              label="Responder ao solicitante"
              value={resposta}
              onChangeText={setResposta}
              multiline
              numberOfLines={3}
              maxLength={2000}
              placeholder="Escreva aqui…"
            />
            <Button
              title="Enviar"
              disabled={!resposta.trim() || ocupado}
              onPress={async () => {
                if (await agir('POST', `/api/chamados/${id}/mensagens`, { conteudo: resposta.trim() })) setResposta('');
              }}
            />
          </>
        ) : null}

        {/* Só chamado de teste some de vez: o de gente de verdade fica no histórico */}
        {chamado.teste ? (
          confirmandoApagar ? (
            <ButtonRow style={styles.acao}>
              <Button title="Cancelar" variant="ghost" onPress={() => setConfirmandoApagar(false)} />
              <Button title="Apagar de vez" variant="danger" onPress={() => void apagar()} loading={ocupado} />
            </ButtonRow>
          ) : (
            <Button
              title="Apagar chamado de teste"
              variant="ghost"
              onPress={() => setConfirmandoApagar(true)}
              style={styles.acao}
            />
          )
        ) : null}
      </Page>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  chaveLinha: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resumo: { fontSize: 12.5 },
  aviso: { marginBottom: 10, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 },
  avisoTexto: { fontSize: 12.5, fontWeight: '600', textAlign: 'center' },
  item: { borderLeftWidth: 3 },
  itemTeste: { opacity: 0.8 },
  itemTopo: { flexDirection: 'row', gap: 12 },
  itemColuna: { width: 40, alignItems: 'center', gap: 1 },
  itemIcone: { fontSize: 24 },
  itemNumero: { fontSize: 11 },
  itemTitulo: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  itemDetalhe: { fontSize: 12 },
  itemPegar: { fontSize: 11 },
  itemLado: { alignItems: 'flex-end', gap: 6 },
  itemRodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  responsavelLinha: { marginTop: 10, paddingTop: 8, borderTopWidth: 1 },
  quem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  acao: { marginTop: 10 },
  situacoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // Dois por linha, do mesmo tamanho: os quatro botões ficavam de larguras
  // diferentes conforme o tamanho da palavra.
  situacao: { flexGrow: 1, minWidth: '47%' },
  descricao: { fontSize: 15, lineHeight: 21 },
  nota: { borderLeftWidth: 2, gap: 2 },
  balao: { maxWidth: '85%', gap: 2, marginBottom: 8, padding: 10, borderRadius: 12 },
  balaoAutor: { fontSize: 11, fontWeight: '600' },
  balaoHora: { fontSize: 10.5 },
});
