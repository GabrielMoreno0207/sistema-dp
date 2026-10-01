/** Início: saudação, avisos, meus atalhos, mural, calendário e conversas recentes */
import React, { useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { abrirMidia } from '../../core/arquivos';
import { aplicarAtualizacaoRapida, instalarAtualizacao } from '../../core/atualizacao';
import { chamar, syncConversas, syncMessages, syncMural, syncPerfil } from '../../core/connection';
import { useApp } from '../../core/store';
import type { Atalho, DadosAtalho, DestinoAtalho, MuralPost } from '../../core/types';
import { Agenda } from '../Agenda';
import { Avatar, Banner, Button, Card, Header, MidiaImage, Page, Select, SectionTitle } from '../components';
import { outraPessoa, previaDaConversa } from '../conversa-comuns';
import { CORES_ATALHO, emojiDoIcone, ICONES_DE_ATALHO, nomeDoIcone } from '../icones';
import { useNav, type Nav } from '../nav';
import { ReacoesDoMural } from '../reacoes';
import { formatDate, formatListDate, useLayout, useTheme } from '../theme';
import { useDeviceChecks } from './DeviceSetupScreen';

function saudacao(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

const DESTINOS: { value: DestinoAtalho; label: string }[] = [
  { value: 'COMUNICADOS', label: 'Comunicados' },
  { value: 'CHAT', label: 'Mensagens' },
  { value: 'MURAL', label: 'Mural' },
  { value: 'PERFIL', label: 'Meu perfil' },
  { value: 'CONFIGURACOES', label: 'Configurações' },
];

function abrirDestino(nav: Nav, destino: DestinoAtalho) {
  if (destino === 'COMUNICADOS') nav.goTab('comunicados');
  else if (destino === 'CHAT') nav.goTab('mensagens');
  else if (destino === 'PERFIL') nav.push({ name: 'perfil' });
  else if (destino === 'CONFIGURACOES') nav.goTab('mais');
  else nav.push({ name: 'mural' });
}

export function HomeScreen() {
  const t = useTheme();
  const nav = useNav();
  const { employee, messages, conversas, conversasNaoLidas, mural, atualizacao, atualizacaoRapida } = useApp();
  const checks = useDeviceChecks();
  const [atualizando, setAtualizando] = useState(false);
  const [instalando, setInstalando] = useState(false);
  const [avisoAtualizacao, setAvisoAtualizacao] = useState('');
  const naoLidos = messages.filter((m) => !m.read).length;
  const primeiroNome = employee?.name.trim().split(/\s+/)[0] ?? '';

  async function atualizar() {
    setAtualizando(true);
    await Promise.all([syncMessages(), syncConversas(), syncMural(), syncPerfil()]);
    setAtualizando(false);
  }

  async function atualizarAgora() {
    const r = await aplicarAtualizacaoRapida();
    setAvisoAtualizacao(r.ok ? '' : r.message);
  }

  async function instalar() {
    setInstalando(true);
    const r = await instalarAtualizacao();
    setInstalando(false);
    setAvisoAtualizacao(r.ok ? '' : r.message);
  }

  const resumo = [
    naoLidos > 0 ? `${naoLidos} ${naoLidos === 1 ? 'comunicado não lido' : 'comunicados não lidos'}` : 'Nenhum comunicado pendente',
    conversasNaoLidas > 0 ? `${conversasNaoLidas} ${conversasNaoLidas === 1 ? 'mensagem nova' : 'mensagens novas'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={`${saudacao()}${primeiroNome ? `, ${primeiroNome}` : ''}`} subtitle={resumo} />
      <Page refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => void atualizar()} colors={[t.primary]} />}>
        {atualizacao.etapa === 'pronta' || atualizacao.etapa === 'erro' ? (
          <Banner
            tone={atualizacao.etapa === 'erro' ? 'danger' : 'info'}
            text={
              avisoAtualizacao ||
              (atualizacao.etapa === 'erro'
                ? atualizacao.erro ?? 'Falha ao baixar a atualização.'
                : `Versão ${atualizacao.versao?.versao} pronta para instalar.${atualizacao.versao?.notas ? ` ${atualizacao.versao.notas}` : ''}`)
            }
            action={{ title: instalando ? '...' : atualizacao.etapa === 'erro' ? 'Tentar de novo' : 'Instalar', onPress: () => void instalar() }}
          />
        ) : atualizacao.etapa === 'baixando' ? (
          <Banner tone="info" text={`Baixando a versão ${atualizacao.versao?.versao ?? 'nova'} do app...`} />
        ) : atualizacaoRapida.etapa === 'aplicando' ? (
          <Banner tone="info" text={`Atualizando para a versão ${atualizacaoRapida.versao?.versao}. O app vai fechar e abrir de novo.`} />
        ) : atualizacaoRapida.etapa === 'disponivel' || atualizacaoRapida.etapa === 'erro' ? (
          <Banner
            tone={atualizacaoRapida.etapa === 'erro' ? 'danger' : 'info'}
            text={
              atualizacaoRapida.etapa === 'erro'
                ? atualizacaoRapida.erro ?? 'Não foi possível atualizar.'
                : `Versão ${atualizacaoRapida.versao?.versao} do app disponível.${atualizacaoRapida.versao?.notas ? ` ${atualizacaoRapida.versao.notas}` : ''}`
            }
            action={{ title: atualizacaoRapida.etapa === 'erro' ? 'Tentar de novo' : 'Atualizar', onPress: () => void atualizarAgora() }}
          />
        ) : null}

        {checks && !checks.allGood ? (
          <Banner
            tone="warning"
            text="Configure o celular para receber os avisos mesmo com o app fechado."
            action={{ title: 'Configurar', onPress: () => nav.push({ name: 'device' }) }}
          />
        ) : null}

        <GradeAtalhos />

        <SectionTitle right={mural ? <Button title="ver" small variant="ghost" onPress={() => nav.push({ name: 'mural' })} /> : undefined}>
          Mural
        </SectionTitle>
        <MuralCard post={mural} />

        <SectionTitle>Calendário</SectionTitle>
        <Agenda />

        <SectionTitle right={<Button title="ver todas" small variant="ghost" onPress={() => nav.goTab('mensagens')} />}>
          Conversas recentes
        </SectionTitle>
        {conversas.length === 0 ? (
          <Card>
            <Text style={[styles.textoSuave, { color: t.muted }]}>Nenhuma conversa ainda.</Text>
            <Button title="Começar uma conversa" small variant="secondary" onPress={() => nav.push({ name: 'novaConversa' })} style={styles.topo} />
          </Card>
        ) : (
          conversas.slice(0, 4).map((c) => {
            const outro = outraPessoa(c, employee?.id ?? '');
            return (
              <Card key={c.id} onPress={() => nav.push({ name: 'conversa', conversaId: c.id })} style={styles.conversa}>
                <Avatar nome={c.titulo} fotoMidiaId={outro?.fotoMidiaId} grupo={c.tipo === 'GRUPO'} size={40} />
                <View style={styles.flex}>
                  <Text style={[styles.conversaNome, { color: t.text }]} numberOfLines={1}>
                    {c.titulo}
                  </Text>
                  <Text style={[styles.textoSuave, { color: c.naoLidas > 0 ? t.text : t.muted }]} numberOfLines={1}>
                    {previaDaConversa(c, employee?.name ?? '')}
                  </Text>
                </View>
                {c.ultimaMensagem ? <Text style={[styles.hora, { color: t.muted }]}>{formatListDate(c.ultimaMensagem.createdAt)}</Text> : null}
              </Card>
            );
          })
        )}
      </Page>
    </View>
  );
}

// ---------------------------------------------------------------- mural

/** O recado que o DP deixa fixado, com imagem ou vídeo */
export function MuralCard({ post, completo }: { post: MuralPost | null; completo?: boolean }) {
  const t = useTheme();
  const nav = useNav();
  const { employee } = useApp();
  const [erro, setErro] = useState('');

  /** Reage ao recado (null = tira); o mural volta do servidor com as contagens */
  async function reagir(emoji: string | null) {
    if (!post) return;
    const r = await chamar('PUT', `/api/mural/${post.id}/reacao`, { emoji });
    setErro(r.ok ? '' : r.message);
    if (r.ok) await syncMural();
  }

  if (!post) {
    return (
      <Card>
        <Text style={[styles.textoSuave, { color: t.muted }]}>
          Nada no mural por enquanto. Quando o RH fixar um recado, ele aparece aqui.
        </Text>
      </Card>
    );
  }
  const midia = post.midia;
  return (
    <Card style={styles.mural}>
      {midia?.tipo === 'IMAGEM' ? (
        <Pressable onPress={() => nav.push({ name: 'imagem', midia })} accessibilityLabel="Ver a imagem do mural">
          <MidiaImage midiaId={midia.id} style={[styles.muralImagem, { backgroundColor: t.surface2 }]} resizeMode={completo ? 'contain' : 'cover'} />
        </Pressable>
      ) : null}
      {midia?.tipo === 'VIDEO' ? (
        <Pressable
          onPress={() => void abrirMidia(midia).then((r) => setErro(r.ok ? '' : r.message))}
          style={[styles.muralVideo, { backgroundColor: t.header }]}
          accessibilityLabel="Assistir ao vídeo do mural">
          <Text style={styles.muralPlay}>▶</Text>
          <Text style={[styles.muralVideoTexto, { color: t.onHeader }]}>Toque para assistir</Text>
        </Pressable>
      ) : null}
      <View style={styles.muralTexto}>
        <Text style={[styles.muralTitulo, { color: t.text }]}>{post.titulo}</Text>
        <Text style={[styles.muralCorpo, { color: t.textSoft }]} numberOfLines={completo ? undefined : 4}>
          {post.texto}
        </Text>
        <Text style={[styles.hora, { color: t.muted }]}>
          {formatDate(post.updatedAt || post.createdAt)} · {post.criadoPor}
        </Text>
        <ReacoesDoMural reacoes={post.reacoes} onReagir={employee ? (emoji) => void reagir(emoji) : undefined} />
        {erro ? <Text style={{ color: t.dangerText }}>{erro}</Text> : null}
      </View>
    </Card>
  );
}

export function MuralScreen() {
  const t = useTheme();
  const nav = useNav();
  const { mural } = useApp();
  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Mural" subtitle="Recado do RH" onBack={nav.pop} />
      <Page>
        <MuralCard post={mural} completo />
      </Page>
    </View>
  );
}

// ---------------------------------------------------------------- atalhos

function GradeAtalhos() {
  const t = useTheme();
  const nav = useNav();
  const { colunasAtalhos, maxWidth } = useLayout();
  const { atalhos, messages, conversasNaoLidas } = useApp();
  const [organizando, setOrganizando] = useState(false);
  const [editando, setEditando] = useState<Atalho | null | 'novo'>(null);
  const [aviso, setAviso] = useState('');

  const badges: Partial<Record<DestinoAtalho, number>> = {
    COMUNICADOS: messages.filter((m) => !m.read).length,
    CHAT: conversasNaoLidas,
  };

  async function mover(indice: number, passo: -1 | 1) {
    const destino = indice + passo;
    if (destino < 0 || destino >= atalhos.length) return;
    const ordem = atalhos.map((a) => a.id);
    [ordem[indice], ordem[destino]] = [ordem[destino], ordem[indice]];
    const r = await chamar('PUT', '/api/atalhos/ordem', { ids: ordem });
    if (!r.ok) setAviso(r.message);
    await syncPerfil();
  }

  // Largura de cada azulejo: a grade ocupa a largura do conteúdo (menos o espaçamento)
  const larguraConteudo = Math.min(maxWidth, 10_000) - 32;
  const lado = Math.floor((larguraConteudo - (colunasAtalhos - 1) * 10) / colunasAtalhos);

  return (
    <View style={styles.grade}>
      <SectionTitle
        right={
          <View style={styles.acoesGrade}>
            {atalhos.length > 0 ? (
              <Button title={organizando ? 'concluir' : 'organizar'} small variant="ghost" onPress={() => setOrganizando((v) => !v)} />
            ) : null}
            <Button title="+ novo" small variant="ghost" onPress={() => setEditando('novo')} />
          </View>
        }>
        Meus atalhos
      </SectionTitle>

      {atalhos.length === 0 ? (
        <Card>
          <Text style={[styles.textoSuave, { color: t.muted }]}>Você ainda não tem atalhos. Monte a sua tela do jeito que preferir.</Text>
          <Button title="Criar o primeiro atalho" small onPress={() => setEditando('novo')} style={styles.topo} />
        </Card>
      ) : (
        <View style={styles.azulejos}>
          {atalhos.map((atalho, indice) => {
            const badge = badges[atalho.destino] ?? 0;
            return (
              <View key={atalho.id} style={{ width: lado }}>
                <Pressable
                  onPress={() => (organizando ? setEditando(atalho) : abrirDestino(nav, atalho.destino))}
                  accessibilityRole="button"
                  accessibilityLabel={atalho.rotulo}
                  style={({ pressed }) => [styles.azulejo, { backgroundColor: atalho.cor, height: Math.min(lado, 120), opacity: pressed ? 0.85 : 1 }]}>
                  <Text style={styles.azulejoIcone}>{emojiDoIcone(atalho.icone)}</Text>
                  <Text style={styles.azulejoRotulo} numberOfLines={2}>
                    {atalho.rotulo}
                  </Text>
                  {badge > 0 && !organizando ? (
                    <View style={[styles.azulejoBadge, { backgroundColor: t.badge }]}>
                      <Text style={styles.azulejoBadgeTexto}>{badge > 99 ? '99+' : badge}</Text>
                    </View>
                  ) : null}
                  {organizando ? <Text style={styles.azulejoEditar}>✏️</Text> : null}
                </Pressable>
                {organizando ? (
                  <View style={styles.mover}>
                    <Pressable onPress={() => void mover(indice, -1)} disabled={indice === 0} style={[styles.moverBotao, { borderColor: t.border, opacity: indice === 0 ? 0.3 : 1 }]} accessibilityLabel="Mover para trás">
                      <Text style={{ color: t.text }}>‹</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void mover(indice, 1)}
                      disabled={indice === atalhos.length - 1}
                      style={[styles.moverBotao, { borderColor: t.border, opacity: indice === atalhos.length - 1 ? 0.3 : 1 }]}
                      accessibilityLabel="Mover para frente">
                      <Text style={{ color: t.text }}>›</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {aviso ? <Text style={{ color: t.dangerText }}>{aviso}</Text> : null}

      {editando !== null ? (
        <EditorAtalho
          atalho={editando === 'novo' ? null : editando}
          onFechar={() => setEditando(null)}
          onErro={setAviso}
        />
      ) : null}
    </View>
  );
}

function EditorAtalho({ atalho, onFechar, onErro }: { atalho: Atalho | null; onFechar: () => void; onErro: (m: string) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { maxWidth } = useLayout();
  const [rotulo, setRotulo] = useState(atalho?.rotulo ?? '');
  const [icone, setIcone] = useState(atalho ? nomeDoIcone(atalho.icone) : ICONES_DE_ATALHO[0]);
  const [cor, setCor] = useState(atalho?.cor ?? CORES_ATALHO[0]);
  const [destino, setDestino] = useState<DestinoAtalho>(atalho?.destino ?? 'COMUNICADOS');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!rotulo.trim()) return;
    setSalvando(true);
    const dados: DadosAtalho = { rotulo: rotulo.trim(), icone, cor, destino };
    const r = atalho ? await chamar('PUT', `/api/atalhos/${atalho.id}`, dados) : await chamar('POST', '/api/atalhos', dados);
    setSalvando(false);
    if (!r.ok) {
      onErro(r.message);
      return;
    }
    await syncPerfil();
    onFechar();
  }

  async function remover() {
    if (!atalho) return;
    const r = await chamar('DELETE', `/api/atalhos/${atalho.id}`);
    if (!r.ok) onErro(r.message);
    await syncPerfil();
    onFechar();
  }

  return (
    <Modal transparent animationType="slide" statusBarTranslucent onRequestClose={onFechar}>
      <Pressable style={[styles.fundo, { backgroundColor: t.overlay }]} onPress={onFechar}>
        <Pressable onPress={() => {}} style={[styles.painel, { backgroundColor: t.surface, paddingBottom: Math.max(insets.bottom, 16), maxWidth }]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.painelConteudo}>
            <Text style={[styles.painelTitulo, { color: t.text }]}>{atalho ? 'Editar atalho' : 'Novo atalho'}</Text>
            <View style={[styles.previa, { backgroundColor: cor }]}>
              <Text style={styles.azulejoIcone}>{emojiDoIcone(icone)}</Text>
              <Text style={styles.azulejoRotulo}>{rotulo.trim() || 'Nome do atalho'}</Text>
            </View>
            <Text style={[styles.rotuloCampo, { color: t.textSoft }]}>Nome</Text>
            <TextInput
              value={rotulo}
              onChangeText={setRotulo}
              maxLength={24}
              placeholder="Ex.: Meus comunicados"
              placeholderTextColor={t.muted}
              style={[styles.campo, { color: t.text, borderColor: t.fieldBorder }]}
            />
            <Select label="Abre" value={destino} options={DESTINOS} onChange={setDestino} />
            <Text style={[styles.rotuloCampo, { color: t.textSoft }]}>Ícone</Text>
            <View style={styles.opcoes}>
              {ICONES_DE_ATALHO.map((opcao) => (
                <Pressable
                  key={opcao}
                  onPress={() => setIcone(opcao)}
                  accessibilityLabel={`Ícone ${opcao}`}
                  style={[styles.opcaoIcone, { borderColor: icone === opcao ? t.primary : t.border, backgroundColor: icone === opcao ? t.primarySoft : t.surface }]}>
                  <Text style={styles.opcaoIconeTexto}>{emojiDoIcone(opcao)}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[styles.rotuloCampo, { color: t.textSoft }]}>Cor</Text>
            <View style={styles.opcoes}>
              {CORES_ATALHO.map((opcao) => (
                <Pressable
                  key={opcao}
                  onPress={() => setCor(opcao)}
                  accessibilityLabel={`Cor ${opcao}`}
                  style={[styles.opcaoCor, { backgroundColor: opcao, borderColor: cor === opcao ? t.text : 'transparent' }]}
                />
              ))}
            </View>
            <View style={styles.botoes}>
              {atalho ? <Button title="Remover" variant="danger" small onPress={() => void remover()} /> : null}
              <View style={styles.flex} />
              <Button title="Cancelar" variant="secondary" small onPress={onFechar} />
              <Button title="Salvar" small onPress={() => void salvar()} disabled={!rotulo.trim()} loading={salvando} />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topo: { marginTop: 10 },
  textoSuave: { fontSize: 14, lineHeight: 20 },
  hora: { fontSize: 12 },
  conversa: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  conversaNome: { fontSize: 15, fontWeight: '700' },
  mural: { padding: 0, overflow: 'hidden' },
  muralImagem: { width: '100%', aspectRatio: 16 / 9 },
  muralVideo: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', gap: 6 },
  muralPlay: { fontSize: 40, color: '#fff' },
  muralVideoTexto: { fontSize: 13.5, fontWeight: '700' },
  muralTexto: { padding: 16, gap: 6 },
  muralTitulo: { fontSize: 17, fontWeight: '800' },
  muralCorpo: { fontSize: 14.5, lineHeight: 21 },
  grade: { gap: 10 },
  acoesGrade: { flexDirection: 'row' },
  azulejos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  azulejo: { borderRadius: 14, padding: 10, justifyContent: 'space-between' },
  azulejoIcone: { fontSize: 26 },
  azulejoRotulo: { color: '#fff', fontSize: 13, fontWeight: '800' },
  azulejoBadge: { position: 'absolute', top: 6, right: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  azulejoBadgeTexto: { color: '#fff', fontSize: 11, fontWeight: '800' },
  azulejoEditar: { position: 'absolute', top: 6, right: 8, fontSize: 14 },
  mover: { flexDirection: 'row', gap: 6, marginTop: 4, justifyContent: 'center' },
  moverBotao: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 2 },
  fundo: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  painel: { width: '100%', maxHeight: '90%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  painelConteudo: { padding: 20, gap: 10 },
  painelTitulo: { fontSize: 18, fontWeight: '800' },
  previa: { alignSelf: 'center', width: 120, height: 110, borderRadius: 14, padding: 10, justifyContent: 'space-between' },
  rotuloCampo: { fontSize: 13.5, fontWeight: '600', marginTop: 4 },
  campo: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, minHeight: 48, fontSize: 16 },
  opcoes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcaoIcone: { width: 46, height: 46, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  opcaoIconeTexto: { fontSize: 22 },
  opcaoCor: { width: 38, height: 38, borderRadius: 19, borderWidth: 3 },
  botoes: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
});
