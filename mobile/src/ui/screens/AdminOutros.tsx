/**
 * Telas do DP e do TI no celular: mural, cadastros (funcionários, setores e
 * aparelhos) e ajustes (resposta automática, minhas mensagens e, para o TI,
 * os logins do DP e a limpeza de dados). Mesmas regras do app do computador.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import DpNative from '../../specs/NativeDpNative';
import { abrirMidia, enviarMidia, escolherArquivo, TIPOS_MIDIA_IMAGEM, TIPOS_MIDIA_VIDEO } from '../../core/arquivos';
import { chamar, syncMural } from '../../core/connection';
import { useApp } from '../../core/store';
import type { MidiaPublica, MuralPost, OperationResult } from '../../core/types';
import {
  Button,
  ButtonRow,
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
  MidiaImage,
  Page,
  SearchBox,
  SectionTitle,
  Select,
  Tag,
} from '../components';
import { avisarAgendamento, CampoAgendar, ListaAgendados, paraIso, SEM_AGENDAR, type Agendar } from '../agendamento';
import { useNav, type FuncionarioAdmin } from '../nav';
import { formatDate, useTheme } from '../theme';

/** Confirmação genérica: texto + ação */
type Pedido = { titulo: string; texto?: string; rotulo: string; acao: () => Promise<void> } | null;

function useConfirmacao() {
  const [pedido, setPedido] = useState<Pedido>(null);
  const [ocupado, setOcupado] = useState(false);
  const dialogo = (
    <Confirm
      visible={pedido !== null}
      title={pedido?.titulo ?? ''}
      message={pedido?.texto}
      confirmLabel={pedido?.rotulo ?? 'Confirmar'}
      danger
      loading={ocupado}
      onCancel={() => setPedido(null)}
      onConfirm={() => {
        const atual = pedido;
        if (!atual) return;
        setOcupado(true);
        void atual.acao().finally(() => {
          setOcupado(false);
          setPedido(null);
        });
      }}
    />
  );
  return { pedir: setPedido, dialogo };
}

// ---------------------------------------------------------------- mural

export function AdminMuralScreen() {
  const t = useTheme();
  const nav = useNav();
  const { mural } = useApp();
  const [posts, setPosts] = useState<MuralPost[] | null>(null);
  const [resultado, setResultado] = useState<OperationResult | null>(null);
  const { pedir, dialogo } = useConfirmacao();

  const carregar = useCallback(async () => {
    const r = await chamar<{ posts: MuralPost[] }>('GET', '/api/mural/todos');
    setPosts(r.dados?.posts ?? []);
    if (!r.ok) setResultado({ ok: false, message: r.message });
  }, []);

  // Recarrega quando volta da edição (o mural em exibição muda)
  useEffect(() => {
    void carregar();
  }, [carregar, mural?.id, mural?.updatedAt]);

  const emExibicao = posts?.find((p) => p.ativo);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header
        title="Mural"
        subtitle="Recado fixado na tela inicial"
        onBack={nav.pop}
        right={<HeaderButton label="+ Novo" onPress={() => nav.push({ name: 'adminMuralEditar', post: null })} />}
      />
      <Page refreshControl={<RefreshControl refreshing={false} onRefresh={() => void carregar()} colors={[t.primary]} />}>
        <Button title="Publicar recado novo" onPress={() => nav.push({ name: 'adminMuralEditar', post: null })} />
        <Feedback result={resultado} />
        <ListaAgendados tipo="MURAL" />
        <SectionTitle>Recados</SectionTitle>
        {posts === null ? <Loading /> : null}
        {posts?.length === 0 ? <Empty icon="📌" text="Nenhum recado publicado ainda." /> : null}
        {posts?.map((post) => (
          <Card key={post.id} style={[styles.gap6, !post.ativo && styles.inativo]}>
            <View style={styles.linhaEntre}>
              <Text style={[styles.titulo, { color: t.text }]} numberOfLines={2}>
                {post.titulo}
              </Text>
              {post === emExibicao ? <Tag text="em exibição" tone="ok" /> : !post.ativo ? <Tag text="fora do ar" /> : null}
            </View>
            <Text style={[styles.texto, { color: t.textSoft }]} numberOfLines={3}>
              {post.texto}
            </Text>
            <Text style={[styles.detalhe, { color: t.muted }]}>
              {formatDate(post.createdAt)} · {post.criadoPor}
              {post.midia ? ` · ${post.midia.tipo === 'VIDEO' ? 'vídeo' : 'imagem'}` : ''}
            </Text>
            <ButtonRow>
              <Button title="Editar" small variant="secondary" onPress={() => nav.push({ name: 'adminMuralEditar', post })} />
              <Button
                title="Apagar"
                small
                variant="danger"
                onPress={() =>
                  pedir({
                    titulo: 'Apagar o recado?',
                    texto: post.titulo,
                    rotulo: 'Apagar',
                    acao: async () => {
                      const r = await chamar('DELETE', `/api/mural/${post.id}`);
                      setResultado(r.ok ? null : { ok: false, message: r.message });
                      await Promise.all([carregar(), syncMural()]);
                    },
                  })
                }
              />
            </ButtonRow>
          </Card>
        ))}
      </Page>
      {dialogo}
    </View>
  );
}

export function AdminMuralEditarScreen({ post }: { post: MuralPost | null }) {
  const t = useTheme();
  const nav = useNav();
  const [titulo, setTitulo] = useState(post?.titulo ?? '');
  const [texto, setTexto] = useState(post?.texto ?? '');
  const [midia, setMidia] = useState<MidiaPublica | null>(post?.midia ?? null);
  const [ativo, setAtivo] = useState(post?.ativo ?? true);
  // Recado novo pode ser agendado; editar um já publicado é na hora
  const [agendar, setAgendar] = useState<Agendar>(SEM_AGENDAR);
  const [enviandoMidia, setEnviandoMidia] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<OperationResult | null>(null);

  async function escolherMidia() {
    const escolha = await escolherArquivo([...TIPOS_MIDIA_IMAGEM, ...TIPOS_MIDIA_VIDEO]);
    if (escolha.erro) setResultado({ ok: false, message: escolha.erro });
    if (!escolha.arquivo) return;
    setEnviandoMidia(true);
    const envio = await enviarMidia(escolha.arquivo);
    setEnviandoMidia(false);
    if (envio.midia) setMidia(envio.midia);
    else setResultado({ ok: false, message: envio.message });
  }

  async function salvar() {
    if (!post && agendar.ativo) {
      const executarEm = paraIso(agendar.data, agendar.hora);
      if (!executarEm) {
        setResultado({ ok: false, message: 'Informe a data (dd/mm/aaaa) e a hora (hh:mm) da publicação.' });
        return;
      }
      setSalvando(true);
      const r = await chamar('POST', '/api/agendamentos/mural', { titulo: titulo.trim(), texto: texto.trim(), midiaId: midia?.id ?? null, executarEm });
      setSalvando(false);
      if (!r.ok) {
        setResultado({ ok: false, message: r.message });
        return;
      }
      avisarAgendamento();
      nav.pop();
      return;
    }
    setSalvando(true);
    const corpo = { titulo: titulo.trim(), texto: texto.trim(), midiaId: midia?.id ?? null, ativo };
    const r = post ? await chamar('PUT', `/api/mural/${post.id}`, corpo) : await chamar('POST', '/api/mural', corpo);
    setSalvando(false);
    if (!r.ok) {
      setResultado({ ok: false, message: r.message });
      return;
    }
    await syncMural();
    nav.pop();
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={post ? 'Editar recado' : 'Novo recado'} onBack={nav.pop} />
      <Page>
        <Card>
          <Field label="Título" value={titulo} onChangeText={setTitulo} maxLength={120} placeholder="Ex.: Campanha de vacinação" />
          <Field label="Texto" value={texto} onChangeText={setTexto} maxLength={4000} multiline />
          <Text style={[styles.rotulo, { color: t.textSoft }]}>Imagem ou vídeo</Text>
          {midia?.tipo === 'IMAGEM' ? <MidiaImage midiaId={midia.id} style={[styles.previa, { backgroundColor: t.surface2 }]} /> : null}
          {midia?.tipo === 'VIDEO' ? (
            <Pressable onPress={() => void abrirMidia(midia)} style={[styles.previa, styles.video, { backgroundColor: t.header }]}>
              <Text style={styles.play}>▶</Text>
              <Text style={{ color: t.onHeader }}>{midia.nome}</Text>
            </Pressable>
          ) : null}
          {!midia ? <Text style={[styles.detalhe, { color: t.muted }]}>sem imagem ou vídeo</Text> : null}
          <ButtonRow style={styles.espaco}>
            <Button
              title={midia ? 'Trocar arquivo' : 'Escolher imagem ou vídeo'}
              small
              variant="secondary"
              onPress={() => void escolherMidia()}
              loading={enviandoMidia}
            />
            {midia ? <Button title="Tirar" small variant="secondary" onPress={() => setMidia(null)} /> : null}
          </ButtonRow>
          {!agendar.ativo ? <CheckRow label="Em exibição no aplicativo" value={ativo} onChange={setAtivo} /> : null}
          {!post ? <CampoAgendar valor={agendar} onChange={setAgendar} /> : null}
          <Button
            title={post ? 'Salvar alterações' : agendar.ativo ? 'Agendar publicação' : 'Publicar no mural'}
            onPress={() => void salvar()}
            loading={salvando}
            disabled={!titulo.trim() || !texto.trim() || enviandoMidia}
          />
          <Feedback result={resultado} />
        </Card>
      </Page>
    </View>
  );
}

// ---------------------------------------------------------------- cadastros

interface Setor {
  id: string;
  name: string;
  employeeCount: number;
}

interface Computador {
  computerId: string;
  hostname: string;
  status: 'ONLINE' | 'OFFLINE';
  lastSeenAt: string;
  appVersion: string;
  currentUserId: string | null;
  /** Último IP de onde o aparelho se conectou */
  ip?: string | null;
}

type Aba = 'funcionarios' | 'setores' | 'aparelhos';

export function AdminCadastrosScreen() {
  const t = useTheme();
  const nav = useNav();
  const [aba, setAba] = useState<Aba>('funcionarios');
  const [funcionarios, setFuncionarios] = useState<(FuncionarioAdmin & { acessoAdmin?: string })[] | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [computadores, setComputadores] = useState<Computador[]>([]);
  const [busca, setBusca] = useState('');
  const [novoSetor, setNovoSetor] = useState('');
  const [resultado, setResultado] = useState<OperationResult | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const { pedir, dialogo } = useConfirmacao();

  const carregar = useCallback(async () => {
    const [f, s, c] = await Promise.all([
      chamar<{ employees: (FuncionarioAdmin & { acessoAdmin?: string })[] }>('GET', '/api/employees'),
      chamar<{ sectors: Setor[] }>('GET', '/api/sectors'),
      chamar<{ computers: Computador[] }>('GET', '/api/computers'),
    ]);
    setFuncionarios(f.dados?.employees ?? []);
    setSetores(s.dados?.sectors ?? []);
    setComputadores(c.dados?.computers ?? []);
    if (!f.ok) setResultado({ ok: false, message: f.message });
  }, []);

  const { sessao } = useApp();
  useEffect(() => {
    void carregar();
  }, [carregar, sessao]);

  async function criarSetor() {
    const r = await chamar('POST', '/api/sectors', { name: novoSetor.trim() });
    setResultado(r.ok ? { ok: true, message: `Setor ${novoSetor.trim()} criado.` } : { ok: false, message: r.message });
    if (r.ok) setNovoSetor('');
    await carregar();
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = (funcionarios ?? []).filter(
    (f) => !termo || [f.name, f.registration, f.sector, f.shift].some((c) => (c ?? '').toLowerCase().includes(termo)),
  );

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header
        title="Cadastros"
        subtitle="Funcionários, setores e aparelhos"
        onBack={nav.pop}
        right={aba === 'funcionarios' ? <HeaderButton label="+ Novo" onPress={() => nav.push({ name: 'adminFuncionario', funcionario: null })} /> : undefined}
      />
      <Page
        refreshControl={
          <RefreshControl
            refreshing={atualizando}
            onRefresh={() => {
              setAtualizando(true);
              void carregar().then(() => setAtualizando(false));
            }}
            colors={[t.primary]}
          />
        }>
        <Chips<Aba>
          value={aba}
          onChange={setAba}
          options={[
            { value: 'funcionarios', label: `Funcionários (${funcionarios?.length ?? 0})` },
            { value: 'setores', label: `Setores (${setores.length})` },
            { value: 'aparelhos', label: `Aparelhos (${computadores.length})` },
          ]}
        />
        <Feedback result={resultado} />

        {aba === 'funcionarios' ? (
          <>
            <Button title="Cadastrar funcionário" onPress={() => nav.push({ name: 'adminFuncionario', funcionario: null })} />
            <SearchBox value={busca} onChangeText={setBusca} placeholder="Procurar por nome, usuário, setor ou turno" />
            {funcionarios === null ? <Loading /> : null}
            {funcionarios?.length === 0 ? <Empty icon="👥" text="Nenhum funcionário cadastrado ainda." /> : null}
            {filtrados.map((f) => (
              <Card key={f.id} onPress={() => nav.push({ name: 'adminFuncionario', funcionario: f })} style={styles.gap6}>
                <View style={styles.linhaEntre}>
                  <Text style={[styles.titulo, { color: t.text }]} numberOfLines={1}>
                    {f.name}
                  </Text>
                  {f.status === 'ACTIVE' ? null : <Tag text="Inativo" tone="warn" />}
                </View>
                <Text style={[styles.detalhe, { color: t.muted }]}>
                  {[f.registration, f.sector ?? 'sem setor', f.shift].filter(Boolean).join(' · ')}
                </Text>
                {f.acessoAdmin && f.acessoAdmin !== 'NENHUM' ? <Tag text={`acesso ${f.acessoAdmin}`} tone="info" /> : null}
              </Card>
            ))}
          </>
        ) : null}

        {aba === 'setores' ? (
          <>
            <Card>
              <Field label="Novo setor" value={novoSetor} onChangeText={setNovoSetor} maxLength={60} />
              <Button title="Criar setor" small onPress={() => void criarSetor()} disabled={!novoSetor.trim()} />
              <Text style={[styles.detalhe, styles.espaco, { color: t.muted }]}>
                Os setores “Departamento Pessoal” (ou “DP”) e “TI” dão acesso às telas de administração a quem for desses setores.
              </Text>
            </Card>
            {setores.map((s) => (
              <Card key={s.id} style={styles.linhaCard}>
                <View style={styles.flex}>
                  <Text style={[styles.titulo, { color: t.text }]}>{s.name}</Text>
                  <Text style={[styles.detalhe, { color: t.muted }]}>
                    {s.employeeCount} funcionário{s.employeeCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    pedir({
                      titulo: `Excluir o setor ${s.name}?`,
                      rotulo: 'Excluir',
                      acao: async () => {
                        const r = await chamar('DELETE', `/api/sectors/${encodeURIComponent(s.id)}`);
                        setResultado(r.ok ? null : { ok: false, message: r.message });
                        await carregar();
                      },
                    })
                  }
                  hitSlop={8}>
                  <Text style={[styles.acaoPerigo, { color: t.dangerText }]}>excluir</Text>
                </Pressable>
              </Card>
            ))}
          </>
        ) : null}

        {aba === 'aparelhos' ? (
          <>
            <ListaAparelhos
              titulo="Computadores"
              aparelhos={computadores.filter((c) => !c.computerId.startsWith('CEL-'))}
              onCopiado={(ip) => setResultado({ ok: true, message: `IP ${ip} copiado.` })}
            />
            <ListaAparelhos
              titulo="Celulares"
              aparelhos={computadores.filter((c) => c.computerId.startsWith('CEL-'))}
              onCopiado={(ip) => setResultado({ ok: true, message: `IP ${ip} copiado.` })}
            />
          </>
        ) : null}
      </Page>
      {dialogo}
    </View>
  );
}

/** Computadores ou celulares, com o IP e o botão de copiar */
function ListaAparelhos({ titulo, aparelhos, onCopiado }: { titulo: string; aparelhos: Computador[]; onCopiado: (ip: string) => void }) {
  const t = useTheme();
  const online = aparelhos.filter((a) => a.status === 'ONLINE').length;
  return (
    <>
      <SectionTitle>
        {titulo} · {aparelhos.length} ({online} online)
      </SectionTitle>
      {aparelhos.length === 0 ? (
        <Text style={[styles.detalhe, { color: t.muted }]}>Nenhum {titulo === 'Celulares' ? 'celular' : 'computador'} registrado.</Text>
      ) : null}
      {aparelhos.map((c) => (
        <Card key={c.computerId} style={styles.linhaCard}>
          <View style={[styles.ponto, { backgroundColor: c.status === 'ONLINE' ? t.success : t.muted }]} />
          <View style={styles.flex}>
            <Text style={[styles.titulo, { color: t.text }]} numberOfLines={1}>
              {c.computerId.startsWith('CEL-') ? '📱 ' : '💻 '}
              {c.hostname}
            </Text>
            <Text style={[styles.detalhe, { color: t.muted }]}>
              {c.computerId} · versão {c.appVersion} · {c.status === 'ONLINE' ? 'online' : `visto ${formatDate(c.lastSeenAt)}`}
            </Text>
            <Text style={[styles.detalhe, styles.ip, { color: c.ip ? t.text : t.muted }]} selectable>
              IP: {c.ip ?? '—'}
            </Text>
          </View>
          {c.ip ? (
            <Button
              title="Copiar"
              small
              variant="secondary"
              onPress={() => {
                DpNative.copyText(c.ip!);
                onCopiado(c.ip!);
              }}
            />
          ) : null}
        </Card>
      ))}
    </>
  );
}

export function AdminFuncionarioScreen({ funcionario }: { funcionario: FuncionarioAdmin | null }) {
  const t = useTheme();
  const nav = useNav();
  const [nome, setNome] = useState(funcionario?.name ?? '');
  const [usuario, setUsuario] = useState(funcionario?.registration ?? '');
  const [setor, setSetor] = useState(funcionario?.sector ?? '');
  const [turno, setTurno] = useState(funcionario?.shift ?? '');
  const [senha, setSenha] = useState('');
  const [setores, setSetores] = useState<{ value: string; label: string }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<OperationResult | null>(null);
  const [status, setStatus] = useState(funcionario?.status ?? 'ACTIVE');
  const { pedir, dialogo } = useConfirmacao();

  useEffect(() => {
    void chamar<{ sectors: { id: string; name: string }[] }>('GET', '/api/sectors').then((r) =>
      setSetores([{ value: '', label: 'Sem setor' }, ...(r.dados?.sectors ?? []).map((s) => ({ value: s.name, label: s.name }))]),
    );
  }, []);

  async function salvar() {
    setSalvando(true);
    setResultado(null);
    const r = funcionario
      ? await chamar('PATCH', `/api/employees/${encodeURIComponent(funcionario.id)}`, {
          name: nome.trim(),
          registration: usuario.trim(),
          sector: setor || null,
          shift: turno.trim() || null,
        })
      : await chamar('POST', '/api/employees', {
          name: nome.trim(),
          registration: usuario.trim(),
          sector: setor || null,
          shift: turno.trim() || null,
          password: senha,
        });
    setSalvando(false);
    if (!r.ok) {
      setResultado({ ok: false, message: r.message });
      return;
    }
    nav.pop();
  }

  async function alternarStatus() {
    if (!funcionario) return;
    const novo = status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const r = await chamar('PATCH', `/api/employees/${encodeURIComponent(funcionario.id)}`, { status: novo });
    if (r.ok) setStatus(novo);
    setResultado(r.ok ? { ok: true, message: novo === 'ACTIVE' ? 'Funcionário ativado.' : 'Funcionário desativado.' } : { ok: false, message: r.message });
  }

  async function redefinirSenha() {
    if (!funcionario) return;
    const nova = `Dp-${Math.random().toString(36).slice(2, 8)}-${new Date().getFullYear()}`;
    const r = await chamar('POST', `/api/employees/${encodeURIComponent(funcionario.id)}/password`, { password: nova });
    setResultado(
      r.ok
        ? { ok: true, message: `Senha de ${funcionario.name} redefinida para: ${nova}\n(ele pode trocar em "Meu perfil")` }
        : { ok: false, message: r.message },
    );
  }

  const usuarioValido = /^[A-Za-z0-9._-]+$/.test(usuario.trim());
  const podeSalvar = nome.trim() && usuarioValido && (funcionario !== null || senha.length >= 8);

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={funcionario ? funcionario.name : 'Novo funcionário'} subtitle={funcionario ? 'Editar cadastro' : 'Cadastro'} onBack={nav.pop} />
      <Page>
        <Card>
          <Field label="Nome" value={nome} onChangeText={setNome} maxLength={120} />
          <Field
            label="Usuário"
            value={usuario}
            onChangeText={setUsuario}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
            hint="Letras, números, ponto, hífen ou sublinhado. É o login do funcionário."
          />
          <Select label="Setor" value={setor} options={setores} onChange={setSetor} placeholder="Sem setor" />
          <Field label="Turno" value={turno} onChangeText={setTurno} maxLength={60} placeholder="Ex.: Manhã" />
          {!funcionario ? (
            <Field label="Senha inicial" value={senha} onChangeText={setSenha} autoCapitalize="none" hint="Mínimo de 8 caracteres." maxLength={128} />
          ) : null}
          <Button title={funcionario ? 'Salvar alterações' : 'Cadastrar'} onPress={() => void salvar()} loading={salvando} disabled={!podeSalvar} />
          <Text selectable>
            <Feedback result={resultado} />
          </Text>
        </Card>
        {funcionario ? (
          <>
            <Button title="Redefinir a senha" variant="secondary" onPress={() => void redefinirSenha()} />
            <Button title={status === 'ACTIVE' ? 'Desativar' : 'Ativar'} variant="secondary" onPress={() => void alternarStatus()} />
            <Button
              title="Excluir funcionário"
              variant="danger"
              onPress={() =>
                pedir({
                  titulo: `Excluir ${funcionario.name}?`,
                  texto: 'O histórico de mensagens e leituras é mantido.',
                  rotulo: 'Excluir',
                  acao: async () => {
                    const r = await chamar('DELETE', `/api/employees/${encodeURIComponent(funcionario.id)}`);
                    if (r.ok) nav.pop();
                    else setResultado({ ok: false, message: r.message });
                  },
                })
              }
            />
          </>
        ) : null}
      </Page>
      {dialogo}
    </View>
  );
}

// ---------------------------------------------------------------- ajustes

interface Regra {
  id: string;
  sector: string | null;
  content: string;
  active: boolean;
}

interface LoginDp {
  id: string;
  username: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  superAdmin: boolean;
}

interface ResumoChat {
  dpUserId: string;
  conversations: number;
  messages: number;
}

/** Campos que o servidor troca no texto da resposta automática */
const CAMPOS_RESPOSTA = [
  { campo: '{primeiro_nome}', descricao: 'Primeiro nome do funcionário' },
  { campo: '{funcionario}', descricao: 'Nome completo do funcionário' },
  { campo: '{setor}', descricao: 'Setor do funcionário' },
  { campo: '{nome_dp}', descricao: 'Seu nome, sem o (DP)' },
];

export function AdminAjustesScreen() {
  const t = useTheme();
  const nav = useNav();
  const { employee } = useApp();
  const ehTi = employee?.acessoAdmin === 'TI';
  const [aba, setAba] = useState<'respostas' | 'ti'>('respostas');
  const [regras, setRegras] = useState<Regra[]>([]);
  const [setores, setSetores] = useState<{ value: string; label: string }[]>([]);
  const [preferencias, setPreferencias] = useState<{ podeRestringir: boolean; mensagensSoDpTi: boolean } | null>(null);
  const [setorRegra, setSetorRegra] = useState('');
  const [textoRegra, setTextoRegra] = useState('');
  const [selecao, setSelecao] = useState({ start: 0, end: 0 });
  const [logins, setLogins] = useState<LoginDp[]>([]);
  const [resumo, setResumo] = useState<ResumoChat[]>([]);
  const [novoUsuario, setNovoUsuario] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  // Vazio = apaga tudo (com 90, num sistema novo, a limpeza não achava nada)
  const [diasComunicados, setDiasComunicados] = useState('');
  const [diasConversas, setDiasConversas] = useState('');
  const [resultado, setResultado] = useState<OperationResult | null>(null);
  const { pedir, dialogo } = useConfirmacao();

  const carregar = useCallback(async () => {
    const [r, s, p] = await Promise.all([
      chamar<{ rules: Regra[] }>('GET', '/api/auto-replies'),
      chamar<{ sectors: { id: string; name: string }[] }>('GET', '/api/sectors'),
      chamar<{ podeRestringir: boolean; mensagensSoDpTi: boolean }>('GET', '/api/conversas/preferencias'),
    ]);
    setRegras(r.dados?.rules ?? []);
    setSetores([{ value: '', label: 'Todos os setores' }, ...(s.dados?.sectors ?? []).map((x) => ({ value: x.name, label: x.name }))]);
    setPreferencias(p.ok ? p.dados : null);
    if (!r.ok) setResultado({ ok: false, message: r.message });
    if (ehTi) {
      const [u, c] = await Promise.all([
        chamar<{ users: LoginDp[] }>('GET', '/api/admin/users'),
        chamar<{ summary: ResumoChat[] }>('GET', '/api/admin/chats'),
      ]);
      setLogins(u.dados?.users ?? []);
      setResumo(c.dados?.summary ?? []);
    }
  }, [ehTi]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function inserirCampo(campo: string) {
    setTextoRegra((atual) => atual.slice(0, selecao.start) + campo + atual.slice(selecao.end));
    const fim = selecao.start + campo.length;
    setSelecao({ start: fim, end: fim });
  }

  async function executar(metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE', caminho: string, corpo: unknown, sucesso: string) {
    const r = await chamar(metodo, caminho, corpo);
    setResultado(r.ok ? { ok: true, message: sucesso } : { ok: false, message: r.message });
    await carregar();
    return r.ok;
  }

  async function salvarRegra() {
    if (await executar('POST', '/api/auto-replies', { sector: setorRegra || null, content: textoRegra.trim(), active: true }, 'Resposta automática salva.')) {
      setTextoRegra('');
    }
  }

  async function alternarSoDpTi(ativo: boolean) {
    const r = await chamar<{ podeRestringir: boolean; mensagensSoDpTi: boolean }>('PUT', '/api/conversas/preferencias', { mensagensSoDpTi: ativo });
    if (!r.ok) {
      setResultado({ ok: false, message: r.message });
      return;
    }
    setPreferencias(r.dados);
    setResultado({
      ok: true,
      message: ativo ? 'Pronto: só o DP e o TI conseguem mandar mensagem para você.' : 'Pronto: todos voltam a conseguir mandar mensagem para você.',
    });
  }

  async function criarLogin() {
    if (await executar('POST', '/api/admin/users', { username: novoUsuario.trim(), name: novoNome.trim(), password: novaSenha }, 'Login criado.')) {
      setNovoUsuario('');
      setNovoNome('');
      setNovaSenha('');
    }
  }

  const campoNumero = (valor: string) => valor.replace(/[^0-9]/g, '');

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Ajustes" subtitle={ehTi ? 'Resposta automática e administração do TI' : 'Resposta automática do chat'} onBack={nav.pop} />
      <Page>
        {ehTi ? (
          <Chips
            value={aba}
            onChange={setAba}
            options={[
              { value: 'respostas', label: 'Resposta automática' },
              { value: 'ti', label: 'TI' },
            ]}
          />
        ) : null}
        <Feedback result={resultado} />

        {aba === 'respostas' ? (
          <>
            {preferencias?.podeRestringir ? (
              <Card>
                <Text style={[styles.titulo, { color: t.text }]}>Minhas mensagens</Text>
                <CheckRow
                  label="Receber mensagens só do DP e do TI"
                  hint="Os demais funcionários deixam de ver você na lista de contatos, não conseguem escrever para você nem colocar você em grupos. Conversas antigas continuam no histórico."
                  value={preferencias.mensagensSoDpTi}
                  onChange={(v) => void alternarSoDpTi(v)}
                />
              </Card>
            ) : null}

            <Card>
              <Text style={[styles.titulo, { color: t.text }]}>Nova resposta automática</Text>
              <Text style={[styles.detalhe, styles.espacoBaixo, { color: t.muted }]}>
                Enviada quando o funcionário escreve para você e ainda não houve resposta.
              </Text>
              <Select label="Setor" value={setorRegra} options={setores} onChange={setSetorRegra} />
              <Text style={[styles.rotulo, { color: t.textSoft }]}>Texto</Text>
              <TextInput
                value={textoRegra}
                onChangeText={setTextoRegra}
                onSelectionChange={(e) => setSelecao(e.nativeEvent.selection)}
                multiline
                maxLength={1000}
                placeholder="Ex.: Olá, {primeiro_nome}! Recebi sua mensagem e respondo assim que possível."
                placeholderTextColor={t.muted}
                style={[styles.area, { color: t.text, borderColor: t.fieldBorder, backgroundColor: t.surface }]}
              />
              <View style={styles.campos}>
                <Text style={[styles.detalhe, { color: t.muted }]}>Inserir no texto:</Text>
                {CAMPOS_RESPOSTA.map(({ campo, descricao }) => (
                  <Pressable
                    key={campo}
                    onPress={() => inserirCampo(campo)}
                    accessibilityLabel={`${campo}: ${descricao}`}
                    style={[styles.campoChip, { borderColor: t.fieldBorder, backgroundColor: t.surface2 }]}>
                    <Text style={[styles.campoTexto, { color: t.link }]}>{campo}</Text>
                  </Pressable>
                ))}
              </View>
              <Button title="Salvar" onPress={() => void salvarRegra()} disabled={!textoRegra.trim()} />
            </Card>

            <SectionTitle>Respostas cadastradas</SectionTitle>
            {regras.length === 0 ? <Text style={{ color: t.muted }}>Nenhuma resposta automática cadastrada.</Text> : null}
            {regras.map((regra) => (
              <Card key={regra.id} style={styles.gap6}>
                <View style={styles.linhaEntre}>
                  <Text style={[styles.titulo, { color: t.text }]}>{regra.sector ?? 'Todos os setores'}</Text>
                  <Tag text={regra.active ? 'Ativa' : 'Desligada'} tone={regra.active ? 'ok' : 'neutral'} />
                </View>
                <Text style={[styles.texto, { color: t.textSoft }]}>{regra.content}</Text>
                <ButtonRow>
                  <Button
                    title={regra.active ? 'Desligar' : 'Ligar'}
                    small
                    variant="secondary"
                    onPress={() =>
                      void executar(
                        'PUT',
                        `/api/auto-replies/${encodeURIComponent(regra.id)}`,
                        { sector: regra.sector, content: regra.content, active: !regra.active },
                        regra.active ? 'Resposta desligada.' : 'Resposta ligada.',
                      )
                    }
                  />
                  <Button
                    title="Excluir"
                    small
                    variant="danger"
                    onPress={() =>
                      pedir({
                        titulo: 'Excluir a resposta automática?',
                        rotulo: 'Excluir',
                        acao: async () => {
                          await executar('DELETE', `/api/auto-replies/${encodeURIComponent(regra.id)}`, undefined, 'Resposta excluída.');
                        },
                      })
                    }
                  />
                </ButtonRow>
              </Card>
            ))}
          </>
        ) : (
          <>
            <Card>
              <Text style={[styles.titulo, styles.espacoBaixo, { color: t.text }]}>Nova conta própria do DP/TI</Text>
              <Field label="Usuário" value={novoUsuario} onChangeText={setNovoUsuario} autoCapitalize="none" autoCorrect={false} />
              <Field label="Nome" value={novoNome} onChangeText={setNovoNome} />
              <Field label="Senha inicial" value={novaSenha} onChangeText={setNovaSenha} autoCapitalize="none" hint="Mínimo de 8 caracteres." />
              <Button
                title="Criar login"
                small
                onPress={() => void criarLogin()}
                disabled={!novoUsuario.trim() || !novoNome.trim() || novaSenha.length < 8}
              />
            </Card>

            <SectionTitle>Contas próprias do DP/TI</SectionTitle>
            {logins.map((login) => {
              const dados = resumo.find((r) => r.dpUserId === login.id);
              return (
                <Card key={login.id} style={styles.gap6}>
                  <View style={styles.linhaEntre}>
                    <Text style={[styles.titulo, { color: t.text }]}>
                      {login.name} ({login.username})
                    </Text>
                    <Tag text={login.superAdmin ? 'TI' : login.status === 'ACTIVE' ? 'Ativo' : 'Inativo'} tone={login.status === 'ACTIVE' ? 'ok' : 'warn'} />
                  </View>
                  <Text style={[styles.detalhe, { color: t.muted }]}>
                    {dados ? `${dados.conversations} conversas · ${dados.messages} mensagens` : 'Sem conversas'}
                  </Text>
                  {!login.superAdmin ? (
                    <ButtonRow>
                      <Button
                        title={login.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                        small
                        variant="secondary"
                        onPress={() =>
                          void executar(
                            'PATCH',
                            `/api/admin/users/${login.id}`,
                            { status: login.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
                            'Situação do login alterada.',
                          )
                        }
                      />
                      {dados && dados.messages > 0 ? (
                        <Button
                          title="Apagar conversas"
                          small
                          variant="danger"
                          onPress={() =>
                            pedir({
                              titulo: `Apagar as conversas de ${login.name}?`,
                              texto: `São ${dados.messages} mensagens, e não dá para desfazer.`,
                              rotulo: 'Apagar',
                              acao: async () => {
                                await executar('POST', '/api/admin/chats/purge', { dpUserId: login.id, olderThanDays: null }, 'Conversas apagadas.');
                              },
                            })
                          }
                        />
                      ) : null}
                      <Button
                        title="Excluir login"
                        small
                        variant="danger"
                        onPress={() =>
                          pedir({
                            titulo: `Excluir o login ${login.username}?`,
                            texto: 'A sessão cai na hora e o nome de usuário fica livre. O histórico é mantido.',
                            rotulo: 'Excluir',
                            acao: async () => {
                              await executar('DELETE', `/api/admin/users/${login.id}`, undefined, 'Login excluído.');
                            },
                          })
                        }
                      />
                    </ButtonRow>
                  ) : null}
                </Card>
              );
            })}

            <SectionTitle>Limpeza de dados</SectionTitle>
            <Card>
              <Text style={[styles.detalhe, styles.espacoBaixo, { color: t.muted }]}>
                Apaga o que já passou do prazo. Deixe o campo vazio para apagar tudo. Não dá para desfazer.
              </Text>
              <Field
                label="Apagar comunicados com mais de (dias)"
                placeholder="vazio = todos"
                value={diasComunicados}
                onChangeText={(v) => setDiasComunicados(campoNumero(v))}
                keyboardType="number-pad"
              />
              <Button
                title="Apagar comunicados"
                small
                variant="danger"
                onPress={() =>
                  pedir({
                    titulo: diasComunicados ? `Apagar comunicados com mais de ${diasComunicados} dias?` : 'Apagar TODOS os comunicados?',
                    texto: 'As leituras vão junto. Não dá para desfazer.',
                    rotulo: 'Apagar',
                    acao: async () => {
                      const r = await chamar<{ removed: number }>('POST', '/api/admin/messages/purge', {
                        olderThanDays: diasComunicados ? Number(diasComunicados) : null,
                      });
                      const removidos = r.dados?.removed ?? 0;
                      setResultado(
                        !r.ok
                          ? { ok: false, message: r.message }
                          : removidos === 0 && diasComunicados
                            ? { ok: true, message: `Nenhum comunicado com mais de ${diasComunicados} dias. Para apagar todos, deixe o campo vazio.` }
                            : { ok: true, message: `${removidos} comunicado(s) apagado(s).` },
                      );
                    },
                  })
                }
              />
              <View style={styles.espaco} />
              <Field
                label="Apagar conversas com mais de (dias)"
                placeholder="vazio = todas"
                value={diasConversas}
                onChangeText={(v) => setDiasConversas(campoNumero(v))}
                keyboardType="number-pad"
              />
              <Button
                title="Apagar conversas"
                small
                variant="danger"
                onPress={() =>
                  pedir({
                    titulo: diasConversas ? `Apagar conversas com mais de ${diasConversas} dias?` : 'Apagar TODAS as conversas do chat?',
                    texto: 'Não dá para desfazer.',
                    rotulo: 'Apagar',
                    acao: async () => {
                      const r = await chamar<{ removed: number }>('POST', '/api/admin/chats/purge', {
                        dpUserId: null,
                        olderThanDays: diasConversas ? Number(diasConversas) : null,
                      });
                      const removidas = r.dados?.removed ?? 0;
                      setResultado(
                        !r.ok
                          ? { ok: false, message: r.message }
                          : removidas === 0 && diasConversas
                            ? { ok: true, message: `Nenhuma mensagem com mais de ${diasConversas} dias. Para apagar todas, deixe o campo vazio.` }
                            : diasConversas
                              ? { ok: true, message: `${removidas} mensagem(ns) apagada(s).` }
                              : { ok: true, message: `Todas as conversas foram apagadas (${removidas} mensagens).` },
                      );
                      await carregar();
                    },
                  })
                }
              />
            </Card>
          </>
        )}
      </Page>
      {dialogo}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap6: { gap: 6 },
  inativo: { opacity: 0.65 },
  linhaEntre: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  linhaCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  titulo: { fontSize: 15.5, fontWeight: '800', flexShrink: 1 },
  texto: { fontSize: 14, lineHeight: 20 },
  detalhe: { fontSize: 13, lineHeight: 18 },
  rotulo: { fontSize: 13.5, fontWeight: '600', marginBottom: 6 },
  espaco: { marginTop: 12 },
  espacoBaixo: { marginBottom: 10 },
  previa: { width: '100%', aspectRatio: 16 / 9, borderRadius: 10 },
  video: { alignItems: 'center', justifyContent: 'center', gap: 6 },
  play: { fontSize: 36, color: '#fff' },
  acaoPerigo: { fontSize: 13.5, fontWeight: '700' },
  ponto: { width: 10, height: 10, borderRadius: 5 },
  ip: { fontFamily: 'monospace', marginTop: 2 },
  area: { borderWidth: 1, borderRadius: 12, minHeight: 110, padding: 12, fontSize: 15, textAlignVertical: 'top' },
  campos: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginVertical: 10 },
  campoChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  campoTexto: { fontFamily: 'monospace', fontSize: 12.5 },
});
