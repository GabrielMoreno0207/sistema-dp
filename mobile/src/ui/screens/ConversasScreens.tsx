/**
 * Mensagens: conversas diretas e grupos, como no app do computador.
 * Lista → conversa (com anexos, responder, encaminhar, apagar e procurar),
 * nova conversa, novo grupo, painel do grupo, encaminhar e ver imagem.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  abrirMidia,
  enviarMidia,
  escolherArquivo,
  tirarFoto,
  TIPOS_MIDIA_ARQUIVO,
  TIPOS_MIDIA_IMAGEM,
  TIPOS_MIDIA_VIDEO,
} from '../../core/arquivos';
import { comecarGravacao, descartarGravacao, pararAudio, tempoLegivel, terminarGravacao } from '../../core/audio';
import { chamar, conversaEmFoco, syncConversas } from '../../core/connection';
import { useApp } from '../../core/store';
import {
  LIMITES,
  type ConversaResumo,
  type MensagemConversa,
  type MidiaPublica,
  type Participante,
  type ReacaoResumo,
} from '../../core/types';
import { SeletorDeReacao } from '../reacoes';
import {
  Avatar,
  Banner,
  Button,
  Card,
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
  Sheet,
  SheetItem,
  Tag,
  useListStyle,
} from '../components';
import { Balao, juntarMensagens, outraPessoa, previaDaConversa, resumoDaCitacao, SeparadorDeDia } from '../conversa-comuns';
import { useNav } from '../nav';
import { formatListDate, useLayout, useTheme } from '../theme';

function combina(termo: string, ...campos: (string | null | undefined)[]): boolean {
  const procurado = termo.trim().toLowerCase();
  return !procurado || campos.some((c) => (c ?? '').toLowerCase().includes(procurado));
}

/** Com quem dá para conversar (colegas e DP) */
function useContatos(): { contatos: Participante[]; carregando: boolean; erro: string } {
  const [contatos, setContatos] = useState<Participante[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let ativo = true;
    void chamar<{ contatos: Participante[] }>('GET', '/api/contatos').then((r) => {
      if (!ativo) return;
      setCarregando(false);
      if (r.ok) setContatos(r.dados?.contatos ?? []);
      else setErro(r.message);
    });
    return () => {
      ativo = false;
    };
  }, []);
  return { contatos, carregando, erro };
}

function detalheDaPessoa(p: Participante): string {
  if (p.ehDp) return 'RH';
  return p.setor ?? 'Sem setor';
}

// ---------------------------------------------------------------- lista

export function ConversasScreen() {
  const t = useTheme();
  const nav = useNav();
  const listStyle = useListStyle();
  const { conversas, conversasNaoLidas, employee } = useApp();
  const [busca, setBusca] = useState('');
  const [atualizando, setAtualizando] = useState(false);
  const meuId = employee?.id ?? '';

  const filtradas = conversas.filter((c) => combina(busca, c.titulo, ...c.participantes.map((p) => p.nome)));

  async function atualizar() {
    setAtualizando(true);
    await syncConversas();
    setAtualizando(false);
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header
        title="Mensagens"
        subtitle={conversasNaoLidas > 0 ? `${conversasNaoLidas} não lida${conversasNaoLidas === 1 ? '' : 's'}` : 'Converse com colegas e com o RH'}
        right={<HeaderButton label="+ Nova" onPress={() => nav.push({ name: 'novaConversa' })} accessibilityLabel="Nova conversa" />}
      />
      <FlatList
        data={filtradas}
        keyExtractor={(c) => c.id}
        contentContainerStyle={listStyle}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => void atualizar()} colors={[t.primary]} />}
        ListHeaderComponent={conversas.length > 4 ? <SearchBox value={busca} onChangeText={setBusca} placeholder="Procurar conversa" /> : undefined}
        ListEmptyComponent={
          <Empty
            icon="💬"
            text={busca ? 'Nenhuma conversa com esse nome.' : 'Nenhuma conversa ainda. Comece uma com um colega ou com o RH.'}
            action={busca ? undefined : { title: 'Nova conversa', onPress: () => nav.push({ name: 'novaConversa' }) }}
          />
        }
        renderItem={({ item: c }) => {
          const outro = outraPessoa(c, meuId);
          const naoLidas = c.naoLidas > 0;
          return (
            <Pressable
              onPress={() => nav.push({ name: 'conversa', conversaId: c.id })}
              style={({ pressed }) => [styles.itemConversa, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.85 : 1 }]}>
              <Avatar nome={c.titulo} fotoMidiaId={outro?.fotoMidiaId} grupo={c.tipo === 'GRUPO'} size={46} />
              <View style={styles.flex}>
                <View style={styles.linhaEntre}>
                  <Text style={[styles.nome, { color: t.text }]} numberOfLines={1}>
                    {c.titulo}
                  </Text>
                  {c.ultimaMensagem ? (
                    <Text style={[styles.hora, { color: naoLidas ? t.link : t.muted }]}>{formatListDate(c.ultimaMensagem.createdAt)}</Text>
                  ) : null}
                </View>
                <View style={styles.linhaEntre}>
                  <Text
                    style={[styles.previa, { color: naoLidas ? t.text : t.muted, fontWeight: naoLidas ? '700' : '400' }]}
                    numberOfLines={1}>
                    {previaDaConversa(c, employee?.name ?? '')}
                  </Text>
                  {naoLidas ? (
                    <View style={[styles.contador, { backgroundColor: t.primary }]}>
                      <Text style={[styles.contadorTexto, { color: t.onPrimary }]}>{c.naoLidas > 99 ? '99+' : c.naoLidas}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------- nova conversa e novo grupo

function LinhaPessoa({ pessoa, onPress, marcada }: { pessoa: Participante; onPress: () => void; marcada?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={marcada === undefined ? 'button' : 'checkbox'}
      accessibilityState={marcada === undefined ? undefined : { checked: marcada }}
      style={({ pressed }) => [styles.itemConversa, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: marcada ? t.primary : t.border }]}>
      <Avatar nome={pessoa.nome} fotoMidiaId={pessoa.fotoMidiaId} size={42} />
      <View style={styles.flex}>
        <Text style={[styles.nome, { color: t.text }]} numberOfLines={1}>
          {pessoa.nome}
        </Text>
        <Text style={[styles.previa, { color: t.muted }]} numberOfLines={1}>
          {detalheDaPessoa(pessoa)}
        </Text>
      </View>
      {marcada !== undefined ? (
        <View style={[styles.marca, { borderColor: marcada ? t.primary : t.fieldBorder, backgroundColor: marcada ? t.primary : 'transparent' }]}>
          {marcada ? <Text style={{ color: t.onPrimary, fontWeight: '900' }}>✓</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function NovaConversaScreen() {
  const t = useTheme();
  const nav = useNav();
  const listStyle = useListStyle();
  const { contatos, carregando, erro } = useContatos();
  const [busca, setBusca] = useState('');
  const [abrindo, setAbrindo] = useState(false);
  const [falha, setFalha] = useState('');

  async function abrirCom(pessoa: Participante) {
    if (abrindo) return;
    setAbrindo(true);
    setFalha('');
    const r = await chamar<ConversaResumo>('POST', '/api/conversas/direta', { comUsuarioId: pessoa.id });
    setAbrindo(false);
    if (!r.ok || !r.dados) {
      setFalha(r.message);
      return;
    }
    void syncConversas();
    nav.pop();
    nav.push({ name: 'conversa', conversaId: r.dados.id });
  }

  const filtrados = contatos.filter((p) => combina(busca, p.nome, p.setor, p.matricula, p.ehDp ? 'RH Recursos Humanos DP Departamento Pessoal' : ''));

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Nova conversa" subtitle="Escolha com quem falar" onBack={nav.pop} />
      <FlatList
        data={filtrados}
        keyExtractor={(p) => p.id}
        contentContainerStyle={listStyle}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.cabecalhoLista}>
            <SearchBox value={busca} onChangeText={setBusca} placeholder="Procurar por nome, setor ou usuário" />
            <Pressable
              onPress={() => {
                nav.pop();
                nav.push({ name: 'novoGrupo' });
              }}
              style={({ pressed }) => [styles.itemConversa, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.border }]}>
              <Avatar nome="Grupo" grupo size={42} />
              <Text style={[styles.nome, { color: t.link }]}>Criar um grupo</Text>
            </Pressable>
            {falha || erro ? <Banner tone="danger" text={falha || erro} /> : null}
            {abrindo ? <ActivityIndicator color={t.primary} /> : null}
          </View>
        }
        ListEmptyComponent={carregando ? <Loading /> : <Empty icon="🔎" text="Ninguém encontrado." />}
        renderItem={({ item }) => <LinhaPessoa pessoa={item} onPress={() => void abrirCom(item)} />}
      />
    </View>
  );
}

export function NovoGrupoScreen() {
  const t = useTheme();
  const nav = useNav();
  const listStyle = useListStyle();
  const { contatos, carregando, erro } = useContatos();
  const [busca, setBusca] = useState('');
  const [nome, setNome] = useState('');
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState('');

  function alternar(id: string) {
    setEscolhidos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function criar() {
    if (!nome.trim() || escolhidos.length === 0 || salvando) return;
    setSalvando(true);
    setFalha('');
    const r = await chamar<ConversaResumo>('POST', '/api/conversas/grupo', { nome: nome.trim(), membros: escolhidos });
    setSalvando(false);
    if (!r.ok || !r.dados) {
      setFalha(r.message);
      return;
    }
    void syncConversas();
    nav.pop();
    nav.push({ name: 'conversa', conversaId: r.dados.id });
  }

  const filtrados = contatos.filter((p) => combina(busca, p.nome, p.setor, p.matricula));

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Novo grupo" subtitle={`${escolhidos.length} escolhida${escolhidos.length === 1 ? '' : 's'}`} onBack={nav.pop} />
      <FlatList
        data={filtrados}
        keyExtractor={(p) => p.id}
        contentContainerStyle={listStyle}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.cabecalhoLista}>
            <Field label="Nome do grupo" value={nome} onChangeText={setNome} maxLength={LIMITES.nomeGrupo} placeholder="Ex.: Turno da manhã" />
            <SearchBox value={busca} onChangeText={setBusca} placeholder="Procurar pessoas" />
            {falha || erro ? <Banner tone="danger" text={falha || erro} /> : null}
          </View>
        }
        ListEmptyComponent={carregando ? <Loading /> : <Empty icon="🔎" text="Ninguém encontrado." />}
        renderItem={({ item }) => <LinhaPessoa pessoa={item} marcada={escolhidos.includes(item.id)} onPress={() => alternar(item.id)} />}
        ListFooterComponent={
          <Button
            title={salvando ? 'Criando...' : 'Criar grupo'}
            onPress={() => void criar()}
            disabled={!nome.trim() || escolhidos.length === 0}
            loading={salvando}
            style={styles.botaoFim}
          />
        }
      />
    </View>
  );
}

// ---------------------------------------------------------------- conversa

type Linha = { tipo: 'msg'; mensagem: MensagemConversa } | { tipo: 'dia'; iso: string; chave: string };

/** Mensagens com separador de dia, já na ordem da lista invertida (mais nova primeiro) */
function linhasDaConversa(mensagens: MensagemConversa[]): Linha[] {
  const linhas: Linha[] = [];
  let diaAnterior = '';
  for (const m of mensagens) {
    const dia = new Date(m.createdAt).toDateString();
    if (dia !== diaAnterior) {
      linhas.push({ tipo: 'dia', iso: m.createdAt, chave: `dia-${m.id}` });
      diaAnterior = dia;
    }
    linhas.push({ tipo: 'msg', mensagem: m });
  }
  return linhas.reverse();
}

export function ConversaScreen({ conversaId }: { conversaId: string }) {
  const t = useTheme();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const { maxWidth } = useLayout();
  const { conversas, employee, conversaVersao, limpezaConversas } = useApp();
  const meuId = employee?.id ?? '';
  const lista = useRef<FlatList<Linha>>(null);
  const carregouUmaVez = useRef(false);

  const daLista = conversas.find((c) => c.id === conversaId) ?? null;
  const [conversa, setConversa] = useState<ConversaResumo | null>(daLista);
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [temMais, setTemMais] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [texto, setTexto] = useState('');
  const [anexo, setAnexo] = useState<MidiaPublica | null>(null);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  // Mensagem de voz: gravando = hora em que começou (null = não está gravando)
  const [gravandoDesde, setGravandoDesde] = useState<number | null>(null);
  const [decorrido, setDecorrido] = useState(0);
  const [enviandoAudio, setEnviandoAudio] = useState(false);
  const gravandoRef = useRef(false);
  /** Hora em que a última gravação terminou (um toque duplo não começa outra) */
  const fimDaGravacao = useRef(0);
  const iniciandoRef = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const [respondendo, setRespondendo] = useState<MensagemConversa | null>(null);
  const [acoesDe, setAcoesDe] = useState<MensagemConversa | null>(null);
  const [apagando, setApagando] = useState<MensagemConversa | null>(null);
  const [escolhendoAnexo, setEscolhendoAnexo] = useState(false);
  const [erro, setErro] = useState('');
  const [procurando, setProcurando] = useState(false);
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<MensagemConversa[] | null>(null);
  const [destacada, setDestacada] = useState<number | null>(null);

  const versao = conversaVersao[conversaId] ?? 0;

  // Enquanto a conversa está na tela, não notifica e marca como lida
  useEffect(() => {
    conversaEmFoco(conversaId);
    return () => conversaEmFoco(null);
  }, [conversaId]);

  useEffect(() => {
    if (daLista) setConversa(daLista);
  }, [daLista]);

  const carregarRecentes = useCallback(async () => {
    const [det, msgs] = await Promise.all([
      chamar<ConversaResumo>('GET', `/api/conversas/${conversaId}`),
      chamar<{ mensagens: MensagemConversa[] }>('GET', `/api/conversas/${conversaId}/mensagens`),
    ]);
    setCarregando(false);
    if (det.ok && det.dados) setConversa(det.dados);
    if (!msgs.ok) {
      setErro(msgs.message);
      return;
    }
    const novas = msgs.dados?.mensagens ?? [];
    // Na primeira carga a página cheia indica que há mensagens mais antigas
    if (!carregouUmaVez.current) {
      carregouUmaVez.current = true;
      setTemMais(novas.length >= LIMITES.paginaMensagens);
    }
    setMensagens((atuais) => juntarMensagens(atuais, novas));
  }, [conversaId]);

  // Abre e recarrega a cada aviso do servidor ("conversa:atualizada")
  useEffect(() => {
    void carregarRecentes();
  }, [carregarRecentes, versao]);

  // O TI apagou conversas: lê de novo do zero (juntar manteria o apagado na tela);
  // se esta conversa não existe mais, volta para a lista
  const limpezaInicial = useRef(limpezaConversas);
  useEffect(() => {
    if (limpezaConversas === limpezaInicial.current) return;
    limpezaInicial.current = limpezaConversas;
    void chamar<{ mensagens: MensagemConversa[] }>('GET', `/api/conversas/${conversaId}/mensagens`).then((r) => {
      if (!r.ok) {
        nav.pop();
        return;
      }
      const lista = r.dados?.mensagens ?? [];
      setMensagens(lista);
      setTemMais(lista.length >= LIMITES.paginaMensagens);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limpezaConversas]);

  async function carregarAnteriores() {
    if (!temMais || carregandoMais || mensagens.length === 0) return;
    setCarregandoMais(true);
    const r = await chamar<{ mensagens: MensagemConversa[] }>('GET', `/api/conversas/${conversaId}/mensagens?antes=${mensagens[0].id}`);
    setCarregandoMais(false);
    if (!r.ok) return;
    const antigas = r.dados?.mensagens ?? [];
    setTemMais(antigas.length >= LIMITES.paginaMensagens);
    setMensagens((atuais) => juntarMensagens(atuais, antigas));
  }

  const linhas = useMemo(() => linhasDaConversa(mensagens), [mensagens]);

  /** Pula até a mensagem: carrega o trecho que termina nela, rola até o balão e destaca */
  async function irAte(mensagemId: number) {
    let atuais = mensagens;
    if (!atuais.some((m) => m.id === mensagemId)) {
      const r = await chamar<{ mensagens: MensagemConversa[] }>('GET', `/api/conversas/${conversaId}/mensagens?antes=${mensagemId + 1}`);
      const trecho = r.dados?.mensagens ?? [];
      atuais = juntarMensagens(atuais, trecho);
      setMensagens(atuais);
      setTemMais(true);
    }
    setDestacada(mensagemId);
    setTimeout(() => setDestacada(null), 2500);
    const indice = linhasDaConversa(atuais).findIndex((l) => l.tipo === 'msg' && l.mensagem.id === mensagemId);
    if (indice >= 0) setTimeout(() => lista.current?.scrollToIndex({ index: indice, viewPosition: 0.5, animated: true }), 120);
  }

  async function procurar() {
    if (termo.trim().length < 2) {
      setErro('Escreva pelo menos 2 letras para procurar.');
      return;
    }
    const r = await chamar<{ mensagens: MensagemConversa[] }>(
      'GET',
      `/api/conversas/${conversaId}/buscar?termo=${encodeURIComponent(termo.trim())}`,
    );
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    setErro('');
    setAchados(r.dados?.mensagens ?? []);
  }

  function fecharBusca() {
    setProcurando(false);
    setTermo('');
    setAchados(null);
  }

  async function anexar(origem: 'galeria' | 'camera' | 'documento') {
    setEscolhendoAnexo(false);
    const escolha =
      origem === 'camera'
        ? await tirarFoto()
        : await escolherArquivo(origem === 'galeria' ? [...TIPOS_MIDIA_IMAGEM, ...TIPOS_MIDIA_VIDEO] : TIPOS_MIDIA_ARQUIVO);
    if (escolha.erro) setErro(escolha.erro);
    if (!escolha.arquivo) return;
    setEnviandoAnexo(true);
    setErro('');
    const envio = await enviarMidia(escolha.arquivo);
    setEnviandoAnexo(false);
    if (envio.midia) setAnexo(envio.midia);
    else setErro(envio.message);
  }

  async function enviar() {
    const conteudo = texto.trim();
    if ((!conteudo && !anexo) || enviando) return;
    setEnviando(true);
    setErro('');
    const r = await chamar<{ mensagem: MensagemConversa }>('POST', `/api/conversas/${conversaId}/mensagens`, {
      conteudo,
      midiaId: anexo?.id ?? null,
      respondeA: respondendo?.id ?? null,
    });
    setEnviando(false);
    if (!r.ok || !r.dados) {
      setErro(r.message);
      return;
    }
    setTexto('');
    setAnexo(null);
    setRespondendo(null);
    setMensagens((atuais) => juntarMensagens(atuais, [r.dados!.mensagem]));
    lista.current?.scrollToOffset({ offset: 0, animated: true });
    void syncConversas();
  }

  async function gravar() {
    if (gravandoRef.current || iniciandoRef.current || Date.now() - fimDaGravacao.current < 800) return;
    setErro('');
    iniciandoRef.current = true;
    const motivo = await comecarGravacao().finally(() => {
      iniciandoRef.current = false;
    });
    if (motivo) {
      setErro(motivo);
      return;
    }
    gravandoRef.current = true;
    setDecorrido(0);
    setGravandoDesde(Date.now());
  }

  function descartar() {
    gravandoRef.current = false;
    fimDaGravacao.current = Date.now();
    setGravandoDesde(null);
    descartarGravacao();
  }

  /** Para a gravação, sobe o áudio e já envia a mensagem */
  async function enviarGravacao() {
    if (!gravandoRef.current) return;
    gravandoRef.current = false;
    fimDaGravacao.current = Date.now();
    setGravandoDesde(null);
    setEnviandoAudio(true);
    setErro('');
    try {
      const envio = await terminarGravacao();
      if (!envio.midia) {
        if (envio.message) setErro(envio.message);
        return;
      }
      const r = await chamar<{ mensagem: MensagemConversa }>('POST', `/api/conversas/${conversaId}/mensagens`, {
        conteudo: '',
        midiaId: envio.midia.id,
        respondeA: respondendo?.id ?? null,
      });
      if (!r.ok || !r.dados) {
        setErro(r.message);
        return;
      }
      setRespondendo(null);
      setMensagens((atuais) => juntarMensagens(atuais, [r.dados!.mensagem]));
      lista.current?.scrollToOffset({ offset: 0, animated: true });
      void syncConversas();
    } finally {
      setEnviandoAudio(false);
    }
  }

  // Relógio da gravação; passou de 15 minutos, envia sozinho
  useEffect(() => {
    if (gravandoDesde === null) return;
    const relogio = setInterval(() => {
      const passou = Date.now() - gravandoDesde;
      setDecorrido(passou);
      if (passou >= 15 * 60 * 1000) void enviarGravacao();
    }, 250);
    return () => clearInterval(relogio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravandoDesde]);

  // Saiu da conversa: descarta a gravação e para o áudio que estiver tocando
  useEffect(
    () => () => {
      if (gravandoRef.current) descartarGravacao();
      gravandoRef.current = false;
      pararAudio();
    },
    [],
  );

  /** Reage à mensagem (null = tira). A tela já mostra; os outros recebem o aviso do servidor. */
  async function reagir(mensagemId: number, emoji: string | null) {
    const r = await chamar<{ reacoes: ReacaoResumo[] }>('PUT', `/api/conversas/mensagens/${mensagemId}/reacao`, { emoji });
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    const reacoes = r.dados?.reacoes ?? [];
    setMensagens((atuais) => atuais.map((m) => (m.id === mensagemId ? { ...m, reacoes } : m)));
  }

  async function apagar(mensagem: MensagemConversa) {
    const r = await chamar('DELETE', `/api/conversas/mensagens/${mensagem.id}`);
    setApagando(null);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    setMensagens((atuais) => atuais.map((m) => (m.id === mensagem.id ? { ...m, apagadaEm: new Date().toISOString(), conteudo: '', midia: null } : m)));
  }

  const emGrupo = conversa?.tipo === 'GRUPO';
  const outro = conversa ? outraPessoa(conversa, meuId) : null;
  const subtitulo = !conversa
    ? ''
    : emGrupo
      ? `${conversa.participantes.length} participantes`
      : outro
        ? detalheDaPessoa(outro)
        : '';
  const lidaAte = conversa?.lidaAte ?? null;
  const podeEnviar = (texto.trim().length > 0 || anexo !== null) && !enviando && !enviandoAnexo;
  // Campo vazio e sem anexo: o botão redondo grava mensagem de voz
  const botaoGrava = texto.trim().length === 0 && anexo === null && !enviando;

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header
        title={conversa?.titulo ?? 'Conversa'}
        subtitle={subtitulo}
        onBack={nav.pop}
        right={
          <View style={styles.acoesCabecalho}>
            <HeaderButton label="🔍" onPress={() => (procurando ? fecharBusca() : setProcurando(true))} accessibilityLabel="Procurar na conversa" />
            {emGrupo ? <HeaderButton label="ⓘ" onPress={() => nav.push({ name: 'grupo', conversaId })} accessibilityLabel="Dados do grupo" /> : null}
          </View>
        }
      />

      {procurando ? (
        <View style={[styles.barraBusca, { backgroundColor: t.surface, borderColor: t.border }]}>
          <TextInput
            value={termo}
            onChangeText={setTermo}
            placeholder="Procurar nesta conversa"
            placeholderTextColor={t.muted}
            style={[styles.campoBusca, { color: t.text, borderColor: t.fieldBorder }]}
            returnKeyType="search"
            onSubmitEditing={() => void procurar()}
            autoFocus
          />
          <Button title="Buscar" small onPress={() => void procurar()} />
        </View>
      ) : null}

      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {achados ? (
          <FlatList
            data={achados}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={[styles.achados, { maxWidth }]}
            ListHeaderComponent={
              <Text style={[styles.previa, { color: t.muted }]}>
                {achados.length === 0 ? 'Nada encontrado.' : `${achados.length} resultado${achados.length === 1 ? '' : 's'} · toque para ir até a mensagem`}
              </Text>
            }
            renderItem={({ item }) => (
              <Card
                onPress={() => {
                  fecharBusca();
                  void irAte(item.id);
                }}>
                <Text style={[styles.nome, { color: t.link }]}>{item.autorNome}</Text>
                <Text style={[styles.previa, { color: t.text }]} numberOfLines={3}>
                  {item.conteudo || item.midia?.nome}
                </Text>
                <Text style={[styles.hora, { color: t.muted }]}>{formatListDate(item.createdAt)}</Text>
              </Card>
            )}
          />
        ) : carregando ? (
          <Loading />
        ) : linhas.length === 0 ? (
          // Fora da lista invertida: dentro dela o Android espelha o texto
          <View style={styles.flex}>
            <Empty icon="👋" text="Nenhuma mensagem ainda. Diga olá!" />
          </View>
        ) : (
          <FlatList
            ref={lista}
            inverted
            data={linhas}
            keyExtractor={(l) => (l.tipo === 'msg' ? String(l.mensagem.id) : l.chave)}
            contentContainerStyle={styles.mensagens}
            onEndReached={() => void carregarAnteriores()}
            onEndReachedThreshold={0.3}
            onScrollToIndexFailed={(info) => {
              lista.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => lista.current?.scrollToIndex({ index: info.index, viewPosition: 0.5 }), 200);
            }}
            ListFooterComponent={carregandoMais ? <ActivityIndicator color={t.primary} style={styles.maisAntigas} /> : undefined}
            renderItem={({ item }) =>
              item.tipo === 'dia' ? (
                <SeparadorDeDia iso={item.iso} />
              ) : (
                <Balao
                  mensagem={item.mensagem}
                  minha={item.mensagem.autorId === meuId}
                  emGrupo={emGrupo}
                  lida={lidaAte !== null && item.mensagem.createdAt <= lidaAte}
                  destacada={destacada === item.mensagem.id}
                  onAcoes={() => setAcoesDe(item.mensagem)}
                  onIrAte={(id) => void irAte(id)}
                  onReagir={(emoji) => void reagir(item.mensagem.id, emoji)}
                  onErro={setErro}
                />
              )
            }
          />
        )}

        {erro ? (
          <Pressable onPress={() => setErro('')} style={[styles.erro, { backgroundColor: t.errorBg }]}>
            <Text style={[styles.erroTexto, { color: t.errorText }]}>{erro}</Text>
          </Pressable>
        ) : null}

        {respondendo ? (
          <View style={[styles.respondendo, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={[styles.citacaoBarra, { backgroundColor: t.primary }]} />
            <View style={styles.flex}>
              <Text style={[styles.nome, { color: t.link }]} numberOfLines={1}>
                Respondendo {respondendo.autorNome}
              </Text>
              <Text style={[styles.previa, { color: t.textSoft }]} numberOfLines={1}>
                {resumoDaCitacao(respondendo)}
              </Text>
            </View>
            <Pressable onPress={() => setRespondendo(null)} hitSlop={10} accessibilityLabel="Cancelar resposta">
              <Text style={[styles.fechar, { color: t.muted }]}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        {enviandoAudio ? (
          <View style={[styles.respondendo, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Text style={styles.iconeAnexo}>🎤</Text>
            <Text style={[styles.previa, styles.flex, { color: t.text }]}>Enviando a mensagem de voz...</Text>
            <ActivityIndicator color={t.primary} />
          </View>
        ) : null}

        {anexo || enviandoAnexo ? (
          <View style={[styles.respondendo, { backgroundColor: t.surface, borderColor: t.border }]}>
            {anexo?.tipo === 'IMAGEM' ? <MidiaImage midiaId={anexo.id} style={styles.previaAnexo} /> : <Text style={styles.iconeAnexo}>📎</Text>}
            <Text style={[styles.previa, styles.flex, { color: t.text }]} numberOfLines={1}>
              {enviandoAnexo ? 'Enviando o arquivo...' : anexo?.nome}
            </Text>
            {enviandoAnexo ? (
              <ActivityIndicator color={t.primary} />
            ) : (
              <Pressable onPress={() => setAnexo(null)} hitSlop={10} accessibilityLabel="Tirar o anexo">
                <Text style={[styles.fechar, { color: t.muted }]}>✕</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {gravandoDesde !== null ? (
          <View
            key="gravando"
            style={[styles.escrever, styles.gravando, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: Math.max(insets.bottom, 8) }]}
            accessibilityLiveRegion="polite">
            <Pressable
              onPress={descartar}
              style={[styles.botaoRedondo, { backgroundColor: t.surface2 }]}
              accessibilityLabel="Descartar a gravação">
              <Text style={styles.iconeBotao}>🗑️</Text>
            </Pressable>
            <View style={styles.gravandoInfo}>
              <View style={[styles.pontoGravando, { backgroundColor: t.danger }]} />
              <Text style={[styles.gravandoTexto, { color: t.text }]}>Gravando {tempoLegivel(decorrido)}</Text>
            </View>
            <Pressable
              onPress={() => void enviarGravacao()}
              style={[styles.botaoRedondo, { backgroundColor: t.primary }]}
              accessibilityLabel="Parar e enviar a mensagem de voz">
              <Text style={[styles.iconeEnviar, { color: t.onPrimary }]}>➤</Text>
            </Pressable>
          </View>
        ) : (
        // key diferente da barra de gravação: o ➤ e o 🎤 ficam no mesmo lugar, e reaproveitar
        // o botão fazia o toque em "enviar" começar outra gravação
        <View key="escrever" style={[styles.escrever, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: Math.max(insets.bottom, 8) }]}>
          <Pressable
            onPress={() => setEscolhendoAnexo(true)}
            disabled={enviandoAnexo}
            style={[styles.botaoRedondo, { backgroundColor: t.surface2 }]}
            accessibilityLabel="Anexar foto, vídeo ou documento">
            <Text style={styles.iconeBotao}>📎</Text>
          </Pressable>
          <TextInput
            value={texto}
            onChangeText={setTexto}
            placeholder="Escreva uma mensagem"
            placeholderTextColor={t.muted}
            multiline
            maxLength={LIMITES.conteudoMensagem}
            style={[styles.campo, { backgroundColor: t.bg, color: t.text, borderColor: t.fieldBorder }]}
          />
          {botaoGrava ? (
            <Pressable
              onPress={() => void gravar()}
              disabled={enviandoAudio}
              style={[styles.botaoRedondo, { backgroundColor: t.primary, opacity: enviandoAudio ? 0.5 : 1 }]}
              accessibilityLabel="Gravar mensagem de voz">
              <Text style={styles.iconeBotao}>🎤</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => void enviar()}
              disabled={!podeEnviar}
              style={[styles.botaoRedondo, { backgroundColor: podeEnviar ? t.primary : t.surface2 }]}
              accessibilityLabel="Enviar">
              {enviando ? <ActivityIndicator color={t.onPrimary} /> : <Text style={[styles.iconeEnviar, { color: podeEnviar ? t.onPrimary : t.muted }]}>➤</Text>}
            </Pressable>
          )}
        </View>
        )}
      </KeyboardAvoidingView>

      <Sheet visible={escolhendoAnexo} onClose={() => setEscolhendoAnexo(false)} title="Anexar">
        <SheetItem icon="🖼️" label="Foto ou vídeo" hint="Da galeria do celular" onPress={() => void anexar('galeria')} />
        <SheetItem icon="📷" label="Tirar foto" onPress={() => void anexar('camera')} />
        <SheetItem icon="📄" label="Documento" hint="PDF, Word, Excel, texto" onPress={() => void anexar('documento')} />
      </Sheet>

      <Sheet visible={acoesDe !== null} onClose={() => setAcoesDe(null)}>
        {acoesDe ? (
          <>
            <SeletorDeReacao
              minha={acoesDe.reacoes?.find((r) => r.minha)?.emoji ?? null}
              onEscolher={(emoji) => {
                const id = acoesDe.id;
                setAcoesDe(null);
                void reagir(id, emoji);
              }}
            />
            <SheetItem
              icon="↩️"
              label="Responder"
              onPress={() => {
                setRespondendo(acoesDe);
                setAcoesDe(null);
              }}
            />
            <SheetItem
              icon="↪️"
              label="Encaminhar"
              onPress={() => {
                const m = acoesDe;
                setAcoesDe(null);
                nav.push({ name: 'encaminhar', mensagem: m });
              }}
            />
            {acoesDe.midia ? (
              <SheetItem
                icon="📂"
                label="Abrir no celular"
                onPress={() => {
                  const midia = acoesDe.midia!;
                  setAcoesDe(null);
                  void abrirMidia(midia).then((r) => !r.ok && setErro(r.message));
                }}
              />
            ) : null}
            {acoesDe.autorId === meuId ? (
              <SheetItem
                icon="🗑️"
                label="Apagar mensagem"
                danger
                onPress={() => {
                  setApagando(acoesDe);
                  setAcoesDe(null);
                }}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>

      <Confirm
        visible={apagando !== null}
        title="Apagar a mensagem?"
        message="Ela some para todos da conversa e fica escrito “mensagem apagada”."
        confirmLabel="Apagar"
        danger
        onCancel={() => setApagando(null)}
        onConfirm={() => apagando && void apagar(apagando)}
      />
    </View>
  );
}

// ---------------------------------------------------------------- grupo

export function GrupoScreen({ conversaId }: { conversaId: string }) {
  const t = useTheme();
  const nav = useNav();
  const { employee } = useApp();
  const meuId = employee?.id ?? '';
  const { contatos } = useContatos();
  const [conversa, setConversa] = useState<ConversaResumo | null>(null);
  const [nome, setNome] = useState('');
  const [adicionando, setAdicionando] = useState(false);
  const [removendo, setRemovendo] = useState<Participante | null>(null);
  const [saindo, setSaindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; message: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamar<ConversaResumo>('GET', `/api/conversas/${conversaId}`);
    if (r.ok && r.dados) {
      setConversa(r.dados);
      setNome(r.dados.nome ?? '');
    } else setResultado({ ok: false, message: r.message });
  }, [conversaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function acao(metodo: 'POST' | 'PUT' | 'DELETE', caminho: string, corpo: unknown, sucesso: string): Promise<boolean> {
    setOcupado(true);
    const r = await chamar(metodo, caminho, corpo);
    setOcupado(false);
    setResultado(r.ok ? { ok: true, message: sucesso } : { ok: false, message: r.message });
    if (r.ok) {
      await carregar();
      void syncConversas();
    }
    return r.ok;
  }

  if (!conversa) {
    return (
      <View style={[styles.flex, { backgroundColor: t.bg }]}>
        <Header title="Grupo" onBack={nav.pop} />
        {resultado ? <Feedback result={resultado} /> : <Loading />}
      </View>
    );
  }

  const souAdmin = conversa.meuPapel === 'ADMIN';
  const dentro = new Set(conversa.participantes.map((p) => p.id));
  const deFora = contatos.filter((c) => !dentro.has(c.id));

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title={conversa.titulo} subtitle={`${conversa.participantes.length} participantes`} onBack={nav.pop} />
      <Page>
        {souAdmin ? (
          <Card>
            <Field label="Nome do grupo" value={nome} onChangeText={setNome} maxLength={LIMITES.nomeGrupo} />
            <Button
              title="Salvar nome"
              small
              variant="secondary"
              disabled={!nome.trim() || nome.trim() === conversa.nome || ocupado}
              onPress={() => void acao('PUT', `/api/conversas/${conversaId}/nome`, { nome: nome.trim() }, 'Nome do grupo alterado.')}
            />
          </Card>
        ) : null}
        <Feedback result={resultado} />

        <SectionTitle right={souAdmin ? <Button title="+ Adicionar" small variant="ghost" onPress={() => setAdicionando(true)} /> : undefined}>
          Participantes
        </SectionTitle>
        {conversa.participantes.map((p) => (
          <View key={p.id} style={[styles.itemConversa, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Avatar nome={p.nome} fotoMidiaId={p.fotoMidiaId} size={40} />
            <View style={styles.flex}>
              <Text style={[styles.nome, { color: t.text }]} numberOfLines={1}>
                {p.id === meuId ? `${p.nome} (você)` : p.nome}
              </Text>
              <Text style={[styles.previa, { color: t.muted }]}>{detalheDaPessoa(p)}</Text>
            </View>
            {p.id === conversa.criadoPor ? <Tag text="Criou o grupo" tone="info" /> : null}
            {souAdmin && p.id !== meuId ? (
              <Pressable onPress={() => setRemovendo(p)} hitSlop={8} accessibilityLabel={`Tirar ${p.nome} do grupo`}>
                <Text style={[styles.remover, { color: t.dangerText }]}>tirar</Text>
              </Pressable>
            ) : null}
          </View>
        ))}

        <Button title="Sair do grupo" variant="danger" onPress={() => setSaindo(true)} />
      </Page>

      <Sheet visible={adicionando} onClose={() => setAdicionando(false)} title="Adicionar ao grupo">
        {deFora.length === 0 ? <Text style={[styles.semNinguem, { color: t.muted }]}>Todo mundo já está no grupo.</Text> : null}
        {deFora.map((p) => (
          <SheetItem
            key={p.id}
            label={p.nome}
            hint={detalheDaPessoa(p)}
            onPress={() => {
              setAdicionando(false);
              void acao('POST', `/api/conversas/${conversaId}/membros`, { usuarioId: p.id }, `${p.nome} entrou no grupo.`);
            }}
          />
        ))}
      </Sheet>

      <Confirm
        visible={removendo !== null}
        title={`Tirar ${removendo?.nome ?? ''} do grupo?`}
        confirmLabel="Tirar"
        danger
        loading={ocupado}
        onCancel={() => setRemovendo(null)}
        onConfirm={() => {
          const p = removendo;
          setRemovendo(null);
          if (p) void acao('DELETE', `/api/conversas/${conversaId}/membros/${p.id}`, undefined, `${p.nome} saiu do grupo.`);
        }}
      />
      <Confirm
        visible={saindo}
        title="Sair do grupo?"
        message="Você deixa de receber as mensagens deste grupo."
        confirmLabel="Sair"
        danger
        loading={ocupado}
        onCancel={() => setSaindo(false)}
        onConfirm={() => {
          setSaindo(false);
          void chamar('POST', `/api/conversas/${conversaId}/sair`).then((r) => {
            if (!r.ok) {
              setResultado({ ok: false, message: r.message });
              return;
            }
            void syncConversas();
            nav.goTab('mensagens');
          });
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------- encaminhar

interface Destino {
  chave: string;
  nome: string;
  detalhe: string;
  conversaId?: string;
  pessoaId?: string;
  grupo: boolean;
  fotoMidiaId?: string | null;
}

export function EncaminharScreen({ mensagem }: { mensagem: MensagemConversa }) {
  const t = useTheme();
  const nav = useNav();
  const listStyle = useListStyle();
  const { conversas, employee } = useApp();
  const meuId = employee?.id ?? '';
  const { contatos } = useContatos();
  const [busca, setBusca] = useState('');
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; message: string } | null>(null);

  const destinos = useMemo<Destino[]>(() => {
    const comConversa = new Set<string>();
    const saida: Destino[] = [];
    for (const c of conversas) {
      const outro = outraPessoa(c, meuId);
      if (outro) comConversa.add(outro.id);
      saida.push({
        chave: `conversa:${c.id}`,
        nome: c.titulo,
        detalhe: c.tipo === 'GRUPO' ? `${c.participantes.length} participantes` : 'Conversa',
        conversaId: c.id,
        grupo: c.tipo === 'GRUPO',
        fotoMidiaId: outro?.fotoMidiaId,
      });
    }
    for (const p of contatos) {
      if (comConversa.has(p.id)) continue;
      saida.push({ chave: `pessoa:${p.id}`, nome: p.nome, detalhe: detalheDaPessoa(p), pessoaId: p.id, grupo: false, fotoMidiaId: p.fotoMidiaId });
    }
    return saida;
  }, [conversas, contatos, meuId]);

  const filtrados = destinos.filter((d) => combina(busca, d.nome, d.detalhe));

  async function encaminhar() {
    if (escolhidos.length === 0 || enviando) return;
    setEnviando(true);
    setResultado(null);
    let enviadas = 0;
    let falha = '';
    for (const chave of escolhidos) {
      const destino = destinos.find((d) => d.chave === chave);
      if (!destino) continue;
      let conversaId = destino.conversaId;
      if (!conversaId && destino.pessoaId) {
        const aberta = await chamar<ConversaResumo>('POST', '/api/conversas/direta', { comUsuarioId: destino.pessoaId });
        if (!aberta.ok || !aberta.dados) {
          falha = aberta.message || `Não foi possível abrir a conversa com ${destino.nome}.`;
          continue;
        }
        conversaId = aberta.dados.id;
      }
      if (!conversaId) continue;
      const r = await chamar('POST', `/api/conversas/${conversaId}/mensagens`, {
        conteudo: mensagem.conteudo,
        midiaId: mensagem.midiaId,
        encaminhada: true,
      });
      if (r.ok) enviadas += 1;
      else falha = r.message;
    }
    setEnviando(false);
    void syncConversas();
    if (enviadas > 0 && !falha) {
      nav.pop();
      return;
    }
    setResultado({ ok: enviadas > 0, message: falha || 'Nada foi encaminhado.' });
  }

  return (
    <View style={[styles.flex, { backgroundColor: t.bg }]}>
      <Header title="Encaminhar" subtitle={`${escolhidos.length} escolhida${escolhidos.length === 1 ? '' : 's'}`} onBack={nav.pop} />
      <FlatList
        data={filtrados}
        keyExtractor={(d) => d.chave}
        contentContainerStyle={listStyle}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.cabecalhoLista}>
            <Card>
              <Text style={[styles.previa, { color: t.textSoft }]} numberOfLines={3}>
                {mensagem.conteudo || `📎 ${mensagem.midia?.nome ?? 'arquivo'}`}
              </Text>
            </Card>
            <SearchBox value={busca} onChangeText={setBusca} placeholder="Procurar conversa ou pessoa" />
            <Feedback result={resultado} />
          </View>
        }
        renderItem={({ item: d }) => {
          const marcada = escolhidos.includes(d.chave);
          return (
            <Pressable
              onPress={() => setEscolhidos((a) => (marcada ? a.filter((x) => x !== d.chave) : [...a, d.chave]))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: marcada }}
              style={[styles.itemConversa, { backgroundColor: t.surface, borderColor: marcada ? t.primary : t.border }]}>
              <Avatar nome={d.nome} fotoMidiaId={d.fotoMidiaId} grupo={d.grupo} size={40} />
              <View style={styles.flex}>
                <Text style={[styles.nome, { color: t.text }]} numberOfLines={1}>
                  {d.nome}
                </Text>
                <Text style={[styles.previa, { color: t.muted }]}>{d.detalhe}</Text>
              </View>
              <View style={[styles.marca, { borderColor: marcada ? t.primary : t.fieldBorder, backgroundColor: marcada ? t.primary : 'transparent' }]}>
                {marcada ? <Text style={{ color: t.onPrimary, fontWeight: '900' }}>✓</Text> : null}
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <Button title="Encaminhar" onPress={() => void encaminhar()} disabled={escolhidos.length === 0} loading={enviando} style={styles.botaoFim} />
        }
      />
    </View>
  );
}

// ---------------------------------------------------------------- imagem

export function ImagemScreen({ midia }: { midia: Pick<MidiaPublica, 'id' | 'nome' | 'mimeType'> }) {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState('');

  async function abrirNoCelular() {
    setAbrindo(true);
    const r = await abrirMidia(midia);
    setAbrindo(false);
    if (!r.ok) setErro(r.message);
  }

  return (
    <View style={[styles.flex, styles.visor, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.visorBarra}>
        <Pressable onPress={nav.pop} hitSlop={12} accessibilityLabel="Fechar">
          <Text style={styles.visorFechar}>✕</Text>
        </Pressable>
        <Text style={styles.visorNome} numberOfLines={1}>
          {midia.nome}
        </Text>
        <Pressable onPress={() => void abrirNoCelular()} disabled={abrindo} style={styles.visorBotao}>
          {abrindo ? <ActivityIndicator color="#fff" /> : <Text style={styles.visorBotaoTexto}>Abrir no celular</Text>}
        </Pressable>
      </View>
      <MidiaImage midiaId={midia.id} style={styles.flex} resizeMode="contain" />
      {erro ? <Text style={styles.visorErro}>{erro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  linhaEntre: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemConversa: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 12 },
  nome: { fontSize: 15.5, fontWeight: '700', flexShrink: 1 },
  previa: { fontSize: 13.5, flexShrink: 1 },
  hora: { fontSize: 12 },
  contador: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  contadorTexto: { fontSize: 12, fontWeight: '800' },
  cabecalhoLista: { gap: 10, marginBottom: 4 },
  marca: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  botaoFim: { marginTop: 8 },
  acoesCabecalho: { flexDirection: 'row', gap: 8 },
  barraBusca: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1 },
  campoBusca: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 40, fontSize: 15 },
  achados: { width: '100%', alignSelf: 'center', padding: 12, gap: 10 },
  mensagens: { paddingVertical: 10 },
  maisAntigas: { marginVertical: 12 },
  erro: { paddingHorizontal: 14, paddingVertical: 10 },
  erroTexto: { fontSize: 13.5 },
  respondendo: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  citacaoBarra: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  fechar: { fontSize: 18, paddingHorizontal: 4 },
  previaAnexo: { width: 40, height: 40, borderRadius: 6 },
  iconeAnexo: { fontSize: 22 },
  escrever: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 8, paddingTop: 8, borderTopWidth: 1 },
  botaoRedondo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  gravando: { alignItems: 'center' },
  gravandoInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
  pontoGravando: { width: 10, height: 10, borderRadius: 5 },
  gravandoTexto: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  iconeBotao: { fontSize: 20 },
  iconeEnviar: { fontSize: 20, fontWeight: '800' },
  campo: { flex: 1, minHeight: 44, maxHeight: 130, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15.5 },
  remover: { fontSize: 13.5, fontWeight: '700', paddingHorizontal: 6 },
  semNinguem: { padding: 20, fontSize: 14 },
  visor: { backgroundColor: '#05080b' },
  visorBarra: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  visorFechar: { color: '#f2f5f8', fontSize: 22, paddingHorizontal: 4 },
  visorNome: { flex: 1, color: '#f2f5f8', fontSize: 14 },
  visorBotao: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  visorBotaoTexto: { color: '#f2f5f8', fontSize: 13.5, fontWeight: '700' },
  visorErro: { color: '#ffa1a1', textAlign: 'center', padding: 12 },
});
