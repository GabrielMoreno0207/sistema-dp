import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type {
  ConnectionState,
  ConversaResumo,
  IdentidadeChat,
  MensagemConversa,
  MidiaPublica,
  Participante,
  ReacaoResumo,
} from '../../../shared/types';
import { NovoGrupo } from '../components/NovoGrupo';
import { PainelGrupo } from '../components/PainelGrupo';
import {
  Avatar,
  MensagemDaConversa,
  dataDoDia,
  juntarMensagens,
  outraPessoa,
  resumoDaCitacao,
} from '../components/conversa-comuns';
import { Icone } from '../lib/icones';
import { BarraDeGravacao, useGravador } from '../components/audio';
import { EncaminharMensagem } from '../components/EncaminharMensagem';

/** Sem funcionário logado no PC nem conta do DP, a tela não tem de quem falar. */
interface ConversasPageProps {
  connection: ConnectionState;
  /** Conversa que o alerta de mensagem pediu para abrir (null = nenhuma) */
  conversaPedida: string | null;
  onAbriuPedida(): void;
  onRequestLogin(): void;
}

/** Quando a identidade é do DP/TI não há sala de tempo real para este PC: confere de tempos em tempos. */
const INTERVALO_CONFERENCIA_MS = 20_000;

export function ConversasPage({ connection, conversaPedida, onAbriuPedida, onRequestLogin }: ConversasPageProps) {
  const [identidade, setIdentidade] = useState<IdentidadeChat | null | undefined>(undefined);
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const [contatos, setContatos] = useState<Participante[]>([]);
  const [texto, setTexto] = useState('');
  const [anexo, setAnexo] = useState<MidiaPublica | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [enviandoAudio, setEnviandoAudio] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [criandoGrupo, setCriandoGrupo] = useState(false);
  const [encaminhando, setEncaminhando] = useState<MensagemConversa | null>(null);
  /** Mensagem sendo respondida (aparece citada acima do campo de escrever) */
  const [respondendo, setRespondendo] = useState<MensagemConversa | null>(null);
  // Procurar dentro da conversa aberta
  /** Arquivo sendo arrastado por cima da conversa (mostra a área de soltar) */
  const [arrastando, setArrastando] = useState(false);
  const [procurando, setProcurando] = useState(false);
  const [termoBusca, setTermoBusca] = useState('');
  const [achados, setAchados] = useState<MensagemConversa[] | null>(null);
  const [destacada, setDestacada] = useState<number | null>(null);
  const [busca, setBusca] = useState('');
  const [verGrupo, setVerGrupo] = useState(false);
  const [temMais, setTemMais] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  // Lido dentro dos listeners, que são registrados uma vez só
  const abertaRef = useRef<string | null>(null);
  abertaRef.current = abertaId;

  const online = connection.status === 'connected';
  const aberta = conversas.find((c) => c.id === abertaId) ?? null;

  const carregarLista = useCallback(async () => {
    const resposta = await window.dp.conversasApi<{ conversas: ConversaResumo[] }>('GET', '/api/conversas');
    if (!resposta.ok) {
      setErro(resposta.message);
      return;
    }
    setErro(null);
    setConversas(resposta.dados?.conversas ?? []);
  }, []);

  const carregarMensagens = useCallback(async (conversaId: string) => {
    const resposta = await window.dp.conversasApi<{ mensagens: MensagemConversa[] }>(
      'GET',
      `/api/conversas/${conversaId}/mensagens`,
    );
    if (!resposta.ok) {
      setErro(resposta.message);
      return;
    }
    // Trocou de conversa enquanto a resposta vinha: essa lista não é mais desta tela
    if (abertaRef.current !== conversaId) return;
    const lista = resposta.dados?.mensagens ?? [];
    // Une em vez de trocar: mantém as páginas antigas que a pessoa já carregou
    setMensagens((atual) => juntarMensagens(atual, lista));
    setTemMais(lista.length >= 50);
    await window.dp.conversasApi('POST', `/api/conversas/${conversaId}/lidas`);
  }, []);

  /**
   * O TI apagou conversas: a aberta é lida de novo do zero (juntar manteria o que foi
   * apagado na tela) e, se ela não existe mais, fecha.
   */
  const recarregarDoZero = useCallback(async (conversaId: string) => {
    const resposta = await window.dp.conversasApi<{ mensagens: MensagemConversa[] }>(
      'GET',
      `/api/conversas/${conversaId}/mensagens`,
    );
    if (abertaRef.current !== conversaId) return;
    if (!resposta.ok) {
      abertaRef.current = null;
      setAbertaId(null);
      setMensagens([]);
      return;
    }
    const lista = resposta.dados?.mensagens ?? [];
    setMensagens(lista);
    setTemMais(lista.length >= 50);
  }, []);

  useEffect(() => {
    void window.dp.conversasIdentidade().then(setIdentidade);
    // Entrar ou sair da conta do DP/TI troca quem está conversando
    return window.dp.onAdminChange(() => {
      void window.dp.conversasIdentidade().then((nova) => {
        setIdentidade(nova);
        abertaRef.current = null;
        setAbertaId(null);
        setMensagens([]);
        setConversas([]);
      });
    });
  }, []);

  useEffect(() => {
    if (!identidade) return;
    void carregarLista();
    void window.dp
      .conversasApi<{ contatos: Participante[] }>('GET', '/api/contatos')
      .then((r) => setContatos(r.dados?.contatos ?? []));
  }, [identidade, carregarLista]);

  // Mensagem nova, grupo alterado: o servidor avisa e a tela busca o que mudou
  useEffect(() => {
    if (!identidade) return;
    const parar = window.dp.onConversasChange((conversaId) => {
      void carregarLista();
      const id = abertaRef.current;
      if (!id) return;
      if (conversaId === '*') void recarregarDoZero(id);
      else void carregarMensagens(id);
    });
    // A conta do DP/TI não tem aviso em tempo real neste PC (o socket é do computador)
    if (!identidade.ehDp) return parar;
    const timer = setInterval(() => {
      void carregarLista();
      const id = abertaRef.current;
      if (id) void carregarMensagens(id);
    }, INTERVALO_CONFERENCIA_MS);
    return () => {
      parar();
      clearInterval(timer);
    };
  }, [identidade, carregarLista, carregarMensagens, recarregarDoZero]);

  // Desce até a última mensagem ao abrir a conversa e a cada mensagem nova
  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: 'end' });
  }, [mensagens.length, abertaId]);

  /*
   * O processo principal precisa saber qual conversa está à vista: enquanto ela
   * estiver aberta aqui, mensagem nova dela não vira alerta no canto da tela.
   */
  useEffect(() => {
    window.dp.conversaEmFoco(abertaId);
    return () => window.dp.conversaEmFoco(null);
  }, [abertaId]);

  // Veio do alerta: abre a conversa pedida
  useEffect(() => {
    if (!conversaPedida || !identidade) return;
    void abrir(conversaPedida);
    onAbriuPedida();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaPedida, identidade]);

  // Hook antes dos returns de "carregando"/"entrar": a ordem dos hooks não pode mudar entre um
  // render e outro (colocado depois, a tela de Mensagens ficava em branco). enviarAudio é
  // declarada mais abaixo e só é chamada quando a gravação termina.
  const gravador = useGravador(
    (dados, mimeType, duracaoMs) => void enviarAudio(dados, mimeType, duracaoMs),
    (mensagem) => setErro(mensagem),
  );

  if (identidade === undefined) return <div className="loading">Carregando...</div>;

  if (identidade === null) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1>Mensagens</h1>
            <p className="page__subtitle">Converse com colegas, com o RH e em grupos.</p>
          </div>
        </header>
        <section className="panel panel--muted">
          <h2>Entre para ver suas conversas</h2>
          <p>
            As conversas são pessoais: entre com seu usuário para falar com colegas e com o RH. Os
            comunicados gerais continuam na página Comunicados.
          </p>
          <div className="form__actions form__actions--start">
            <button className="btn btn--primary" onClick={onRequestLogin}>
              Entrar com meu usuário
            </button>
          </div>
        </section>
      </div>
    );
  }

  async function abrir(conversaId: string) {
    // Marca já aqui: a conferência das respostas atrasadas usa este valor
    abertaRef.current = conversaId;
    fecharBusca();
    setAbertaId(conversaId);
    setMensagens([]);
    setTexto('');
    setAnexo(null);
    setErro(null);
    setVerGrupo(false);
    await carregarMensagens(conversaId);
    await carregarLista();
  }

  /** Página anterior de mensagens (botão no topo da conversa) */
  async function carregarAnteriores() {
    if (!abertaId || mensagens.length === 0) return;
    const resposta = await window.dp.conversasApi<{ mensagens: MensagemConversa[] }>(
      'GET',
      `/api/conversas/${abertaId}/mensagens?antes=${mensagens[0].id}`,
    );
    const anteriores = resposta.dados?.mensagens ?? [];
    setTemMais(anteriores.length >= 50);
    if (anteriores.length > 0) setMensagens((atual) => juntarMensagens(atual, anteriores));
  }

  function fecharBusca() {
    setProcurando(false);
    setTermoBusca('');
    setAchados(null);
    setDestacada(null);
  }

  async function procurar(evento?: FormEvent) {
    evento?.preventDefault();
    const texto = termoBusca.trim();
    if (!abertaId || texto.length < 2) return;
    const resposta = await window.dp.conversasApi<{ mensagens: MensagemConversa[] }>(
      'GET',
      `/api/conversas/${abertaId}/buscar?termo=${encodeURIComponent(texto)}`,
    );
    if (!resposta.ok) {
      setErro(resposta.message);
      return;
    }
    setAchados(resposta.dados?.mensagens ?? []);
  }

  /**
   * Pula até a mensagem achada: carrega o trecho que termina nela (o servidor
   * devolve as 50 anteriores), rola até o balão e o destaca por um instante.
   */
  async function irAte(mensagemId: number) {
    if (!abertaId) return;
    if (!mensagens.some((m) => m.id === mensagemId)) {
      const resposta = await window.dp.conversasApi<{ mensagens: MensagemConversa[] }>(
        'GET',
        `/api/conversas/${abertaId}/mensagens?antes=${mensagemId + 1}`,
      );
      const trecho = resposta.dados?.mensagens ?? [];
      if (trecho.length > 0) setMensagens((atual) => juntarMensagens(atual, trecho));
    }
    setDestacada(mensagemId);
    // Espera o balão existir na tela para poder rolar até ele
    setTimeout(() => {
      document.getElementById(`mensagem-${mensagemId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  }

  async function enviar(evento?: FormEvent) {
    evento?.preventDefault();
    const conteudo = texto.trim();
    if (!abertaId || (!conteudo && !anexo) || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await window.dp.conversasApi<{ mensagem: MensagemConversa }>(
        'POST',
        `/api/conversas/${abertaId}/mensagens`,
        { conteudo, midiaId: anexo?.id ?? null, respondeA: respondendo?.id ?? null },
      );
      if (!resposta.ok) {
        setErro(resposta.message);
        return;
      }
      setTexto('');
      setAnexo(null);
      setRespondendo(null);
      const nova = resposta.dados?.mensagem;
      if (nova) setMensagens((atual) => juntarMensagens(atual, [nova]));
      await carregarLista();
    } finally {
      setEnviando(false);
    }
  }

  /** Prepara a resposta: a citação aparece acima do campo e some ao enviar. */
  function responder(mensagem: MensagemConversa) {
    setRespondendo(mensagem);
    setProcurando(false);
    document.querySelector<HTMLTextAreaElement>('.chat__input')?.focus();
  }

  /** Mensagem de voz: sobe o áudio e já envia (sem passar pelo campo de anexo) */
  async function enviarAudio(dados: ArrayBuffer, mimeType: string, duracaoMs: number) {
    const conversaId = abertaId;
    if (!conversaId) return;
    setErro(null);
    setEnviandoAudio(true);
    try {
      const envio = await window.dp.conversasEnviarAudio(dados, mimeType, duracaoMs);
      if (!envio.ok || !envio.midia) {
        setErro(envio.message || 'Não foi possível enviar a mensagem de voz.');
        return;
      }
      const resposta = await window.dp.conversasApi<{ mensagem: MensagemConversa }>(
        'POST',
        `/api/conversas/${conversaId}/mensagens`,
        { conteudo: '', midiaId: envio.midia.id, respondeA: respondendo?.id ?? null },
      );
      if (!resposta.ok) {
        setErro(resposta.message);
        return;
      }
      setRespondendo(null);
      const nova = resposta.dados?.mensagem;
      if (nova && conversaId === abertaRef.current) setMensagens((atual) => juntarMensagens(atual, [nova]));
      await carregarLista();
    } finally {
      setEnviandoAudio(false);
    }
  }

  /**
   * Ctrl+V no campo: imagem da área de transferência (print, copiada do navegador)
   * ou arquivo copiado no Explorer vira anexo, igual ao clipe. Texto cola normal.
   */
  async function colar(evento: ClipboardEvent<HTMLTextAreaElement>) {
    if (!abertaId || !online) return;
    const arquivo = [...evento.clipboardData.files][0];
    if (!arquivo) return; // só texto: deixa o navegador colar
    evento.preventDefault();
    if (anexo) setAviso('A imagem colada substituiu o anexo anterior.');
    setErro(null);
    setEnviandoAnexo(true);
    try {
      // Arquivo copiado no Explorer tem caminho no disco: sobe como o arrastar
      const caminho = window.dp.caminhoDoArquivo(arquivo);
      const resultado = caminho
        ? await window.dp.conversasSoltarArquivo(caminho)
        : arquivo.type.startsWith('image/')
          ? await window.dp.conversasColarImagem(await arquivo.arrayBuffer(), arquivo.type)
          : { ok: false, midia: null, message: 'Só dá para colar imagem ou arquivo.' };
      if (!resultado.ok) {
        if (resultado.message) setErro(resultado.message);
        return;
      }
      setAnexo(resultado.midia);
    } finally {
      setEnviandoAnexo(false);
    }
  }

  async function anexar() {
    setErro(null);
    const resultado = await window.dp.conversasAnexar();
    if (!resultado.ok) {
      if (resultado.message) setErro(resultado.message);
      return;
    }
    setAnexo(resultado.midia);
  }

  /**
   * Arquivo arrastado do Windows para dentro da conversa: sobe na hora e fica
   * no campo como anexo, igual ao que o botão do clipe faz.
   */
  async function soltarArquivo(evento: DragEvent<HTMLElement>) {
    evento.preventDefault();
    setArrastando(false);
    if (!abertaId || !online) return;

    const arquivos = [...evento.dataTransfer.files];
    if (arquivos.length === 0) return;
    if (arquivos.length > 1) setAviso('Só o primeiro arquivo foi enviado: vai um de cada vez.');

    setErro(null);
    setEnviandoAnexo(true);
    try {
      const caminho = window.dp.caminhoDoArquivo(arquivos[0]);
      if (!caminho) {
        setErro('Não consegui ler esse arquivo. Use o clipe para escolher.');
        return;
      }
      const resultado = await window.dp.conversasSoltarArquivo(caminho);
      if (!resultado.ok) {
        if (resultado.message) setErro(resultado.message);
        return;
      }
      setAnexo(resultado.midia);
    } finally {
      setEnviandoAnexo(false);
    }
  }

  /** Só reage a arquivo: arrastar texto de outro lugar não muda nada na tela. */
  function temArquivo(evento: DragEvent<HTMLElement>): boolean {
    return [...evento.dataTransfer.types].includes('Files');
  }

  /** Reage à mensagem (null = tira). A tela já mostra o resultado; os outros recebem o aviso do servidor. */
  async function reagir(mensagemId: number, emoji: string | null) {
    const resposta = await window.dp.conversasApi<{ reacoes: ReacaoResumo[] }>(
      'PUT',
      `/api/conversas/mensagens/${mensagemId}/reacao`,
      { emoji },
    );
    if (!resposta.ok) {
      setErro(resposta.message);
      return;
    }
    const reacoes = resposta.dados?.reacoes ?? [];
    setMensagens((atual) => atual.map((m) => (m.id === mensagemId ? { ...m, reacoes } : m)));
  }

  async function apagar(mensagemId: number) {
    const resposta = await window.dp.conversasApi('DELETE', `/api/conversas/mensagens/${mensagemId}`);
    if (!resposta.ok) {
      setErro(resposta.message);
      return;
    }
    if (abertaId) await carregarMensagens(abertaId);
    await carregarLista();
  }

  /**
   * Clique em alguém que ainda não tem conversa: o servidor abre a conversa
   * direta (ou devolve a que já existia) e ela entra na lista.
   */
  async function abrirComPessoa(pessoaId: string) {
    setErro(null);
    const resposta = await window.dp.conversasApi<ConversaResumo>('POST', '/api/conversas/direta', {
      comUsuarioId: pessoaId,
    });
    if (!resposta.ok || !resposta.dados) {
      setErro(resposta.message || 'Não foi possível abrir a conversa.');
      return;
    }
    await carregarLista();
    await abrir(resposta.dados.id);
  }

  function aoDigitar(evento: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      void enviar();
    }
  }

  /** Grupo criado: entra na lista e já abre */
  async function aoCriar(conversa: ConversaResumo) {
    setCriandoGrupo(false);
    await carregarLista();
    await abrir(conversa.id);
  }

  const termo = busca.trim().toLowerCase();

  function combina(...campos: (string | null)[]): boolean {
    if (!termo) return true;
    return campos.some((campo) => (campo ?? '').toLowerCase().includes(termo));
  }

  // Quem já tem conversa direta não precisa aparecer de novo na lista de pessoas
  const jaTemConversa = new Set(
    conversas
      .filter((conversa) => conversa.tipo === 'DIRETA')
      .flatMap((conversa) => conversa.participantes.map((pessoa) => pessoa.id)),
  );
  const conversasVisiveis = conversas.filter((conversa) =>
    combina(conversa.titulo, ...conversa.participantes.map((pessoa) => pessoa.nome)),
  );
  const pessoasSemConversa = contatos
    .filter((pessoa) => !jaTemConversa.has(pessoa.id))
    .filter((pessoa) => combina(pessoa.nome, pessoa.setor, pessoa.matricula))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  let diaAnterior = '';

  return (
    <div className="chat-layout">
      <aside className="contacts">
        <header className="contacts__header">
          <h1>Mensagens</h1>
          <p className="page__subtitle">
            Conversando como <strong>{identidade.nome}</strong>
            {identidade.ehDp && ' (RH)'}
          </p>
          <div className="contacts__acoes">
            <input
              className="contacts__busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar pessoa ou grupo"
              aria-label="Procurar pessoa ou grupo"
            />
            <button className="btn btn--sm" onClick={() => setCriandoGrupo(true)}>
              + Grupo
            </button>
          </div>
        </header>

        {conversasVisiveis.length === 0 && pessoasSemConversa.length === 0 ? (
          <div className="empty-state">
            <Icone nome="mensagens" tamanho={28} />
            <p>
              {termo
                ? 'Ninguém encontrado com esse termo.'
                : online
                  ? 'Ninguém mais tem conta no sistema ainda.'
                  : 'As conversas aparecem quando o app estiver Conectado.'}
            </p>
          </div>
        ) : (
          <ul className="contacts__list">
            {conversasVisiveis.length > 0 && <li className="contacts__secao">Conversas</li>}
            {conversasVisiveis.map((conversa) => (
              <li key={conversa.id}>
                <button
                  className={`contact ${conversa.id === abertaId ? 'contact--active' : ''} ${
                    conversa.naoLidas > 0 ? 'contact--unread' : ''
                  }`}
                  onClick={() => void abrir(conversa.id)}
                >
                  <Avatar
                    nome={conversa.titulo}
                    fotoMidiaId={outraPessoa(conversa, identidade.id)?.fotoMidiaId}
                    grupo={conversa.tipo === 'GRUPO'}
                  />
                  <span className="contact__main">
                    <span className="contact__top">
                      <span className="contact__name">{conversa.titulo}</span>
                      {conversa.ultimaMensagem && (
                        <span className="contact__time">{dataDoDia(conversa.ultimaMensagem.createdAt)}</span>
                      )}
                    </span>
                    <span className="contact__preview">
                      {conversa.ultimaMensagem
                        ? `${conversa.ultimaMensagem.autorNome === identidade.nome ? 'Você: ' : conversa.tipo === 'GRUPO' ? `${conversa.ultimaMensagem.autorNome}: ` : ''}${
                            conversa.ultimaMensagem.tipo === 'MIDIA'
                              ? conversa.ultimaMensagem.conteudo || 'arquivo'
                              : conversa.ultimaMensagem.conteudo
                          }`
                        : conversa.tipo === 'GRUPO'
                          ? `${conversa.participantes.length} participantes`
                          : 'Clique para conversar'}
                    </span>
                  </span>
                  {conversa.naoLidas > 0 && <span className="contact__badge">{conversa.naoLidas}</span>}
                </button>
              </li>
            ))}

            {pessoasSemConversa.length > 0 && <li className="contacts__secao">Pessoas</li>}
            {pessoasSemConversa.map((pessoa) => (
              <li key={pessoa.id}>
                <button className="contact" onClick={() => void abrirComPessoa(pessoa.id)}>
                  <Avatar nome={pessoa.nome} fotoMidiaId={pessoa.fotoMidiaId} />
                  <span className="contact__main">
                    <span className="contact__top">
                      <span className="contact__name">{pessoa.nome}</span>
                    </span>
                    <span className="contact__preview">
                      {pessoa.ehDp ? 'RH' : (pessoa.setor ?? 'Sem setor')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section
        className={`chat ${arrastando ? 'chat--soltar' : ''}`}
        onDragOver={(evento) => {
          if (!aberta || !temArquivo(evento)) return;
          evento.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={(evento) => {
          // Sai de um filho para outro também dispara: só some ao sair da área toda
          if (evento.currentTarget.contains(evento.relatedTarget as Node | null)) return;
          setArrastando(false);
        }}
        onDrop={(evento) => void soltarArquivo(evento)}
      >
        {arrastando && aberta && (
          <div className="chat__soltar-aviso">
            <Icone nome="anexo" tamanho={30} />
            <strong>Solte para enviar em {aberta.titulo}</strong>
            <span>Imagem, vídeo ou documento</span>
          </div>
        )}
        {!aberta ? (
          <div className="empty-state empty-state--detail">
            <Icone nome="mensagens" tamanho={28} />
            <p>Escolha uma pessoa ou um grupo à esquerda para começar.</p>
            {erro && <p className="feedback feedback--error">{erro}</p>}
          </div>
        ) : (
          <>
            <header className="chat__header">
              <Avatar
                nome={aberta.titulo}
                fotoMidiaId={outraPessoa(aberta, identidade.id)?.fotoMidiaId}
                grupo={aberta.tipo === 'GRUPO'}
                classe="chat__avatar"
              />
              <div className="chat__header-texto">
                <h1>{aberta.titulo}</h1>
                <p className="page__subtitle">
                  {aberta.tipo === 'GRUPO'
                    ? `${aberta.participantes.length} participantes`
                    : `Conversa individual entre você e ${aberta.titulo}.`}
                </p>
              </div>
              <button
                className="btn btn--sm"
                onClick={() => (procurando ? fecharBusca() : setProcurando(true))}
                title="Procurar nesta conversa"
              >
                <Icone nome="procurar" />
              </button>
              {aberta.tipo === 'GRUPO' && (
                <button className="btn btn--sm" onClick={() => setVerGrupo((v) => !v)}>
                  {verGrupo ? 'Fechar' : 'Participantes'}
                </button>
              )}
            </header>

            {procurando && (
              <div className="busca-conversa">
                <form className="busca-conversa__linha" onSubmit={(e) => void procurar(e)}>
                  <input
                    className="busca-conversa__campo"
                    value={termoBusca}
                    onChange={(e) => setTermoBusca(e.target.value)}
                    placeholder="Procurar nesta conversa"
                    autoFocus
                  />
                  <button type="submit" className="btn btn--sm btn--primary" disabled={termoBusca.trim().length < 2}>
                    Procurar
                  </button>
                  <button type="button" className="btn btn--sm" onClick={fecharBusca}>
                    <Icone nome="fechar" tamanho={14} />
                  </button>
                </form>

                {achados !== null && (
                  <ul className="busca-conversa__lista">
                    {achados.length === 0 && <li className="busca-conversa__vazio">Nenhuma mensagem com esse texto.</li>}
                    {achados.map((achada) => (
                      <li key={achada.id}>
                        <button className="busca-conversa__achado" onClick={() => void irAte(achada.id)}>
                          <span className="busca-conversa__quem">
                            {achada.autorId === identidade.id ? 'Você' : achada.autorNome}
                          </span>
                          <span className="busca-conversa__texto">{achada.conteudo}</span>
                          <span className="busca-conversa__quando">{dataDoDia(achada.createdAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {verGrupo && aberta.tipo === 'GRUPO' && (
              <PainelGrupo
                conversa={aberta}
                contatos={contatos}
                euId={identidade.id}
                onMudou={async () => {
                  await carregarLista();
                  if (abertaId) await carregarMensagens(abertaId);
                }}
                onSaiu={async () => {
                  setVerGrupo(false);
                  setAbertaId(null);
                  setMensagens([]);
                  await carregarLista();
                }}
                onErro={setErro}
                onAviso={setAviso}
              />
            )}

            <div className="chat__messages" role="log" aria-live="polite">
              {temMais && mensagens.length > 0 && (
                <div className="chat__mais">
                  <button className="btn btn--sm" onClick={() => void carregarAnteriores()}>
                    Carregar mensagens anteriores
                  </button>
                </div>
              )}
              {mensagens.length === 0 && (
                <div className="empty-state">
                  <Icone nome="mensagens" tamanho={28} />
                  <p>Nenhuma mensagem ainda. Escreva abaixo para começar.</p>
                </div>
              )}
              {mensagens.map((mensagem) => {
                const dia = dataDoDia(mensagem.createdAt, true);
                const mostrarDia = dia !== diaAnterior;
                diaAnterior = dia;
                return (
                  <Fragment key={mensagem.id}>
                    {mostrarDia && <div className="chat__day">{dia}</div>}
                    <MensagemDaConversa
                      destacada={mensagem.id === destacada}
                      mensagem={mensagem}
                      minha={mensagem.autorId === identidade.id}
                      emGrupo={aberta.tipo === 'GRUPO'}
                      lida={aberta.lidaAte !== null && aberta.lidaAte >= mensagem.createdAt}
                      onApagar={() => void apagar(mensagem.id)}
                      onEncaminhar={() => setEncaminhando(mensagem)}
                      onResponder={() => responder(mensagem)}
                      onIrAte={(id) => void irAte(id)}
                      onReagir={(emoji) => void reagir(mensagem.id, emoji)}
                      onErro={setErro}
                      onAviso={setAviso}
                    />
                  </Fragment>
                );
              })}
              <div ref={fimRef} />
            </div>

            <form className="chat__composer" onSubmit={(e) => void enviar(e)}>
              {!online && (
                <p className="chat__offline">
                  Sem conexão com o servidor: a mensagem só pode ser enviada com o app Conectado.
                </p>
              )}
              {erro && <p className="feedback feedback--error chat__error">{erro}</p>}
              {aviso && <p className="feedback feedback--ok chat__error">{aviso}</p>}
              {respondendo && (
                <div className="chat__respondendo">
                  <span className="chat__respondendo-corpo">
                    <span className="chat__respondendo-autor">
                      <Icone nome="responder" tamanho={13} /> {respondendo.autorNome}
                    </span>
                    <span className="chat__respondendo-texto">{resumoDaCitacao(respondendo)}</span>
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setRespondendo(null)}
                    aria-label="Cancelar resposta"
                    title="Cancelar resposta"
                  >
                    <Icone nome="fechar" />
                  </button>
                </div>
              )}
              {enviandoAnexo && <p className="chat__anexo">Enviando o arquivo...</p>}
              {enviandoAudio && <p className="chat__anexo">Enviando a mensagem de voz...</p>}
              {anexo && (
                <p className="chat__anexo">
                  <Icone nome="anexo" /> {anexo.nome}
                  <button type="button" className="btn btn--sm" onClick={() => setAnexo(null)}>
                    Remover
                  </button>
                </p>
              )}
              {gravador.estado === 'gravando' ? (
                <BarraDeGravacao
                  decorrido={gravador.decorrido}
                  onCancelar={() => gravador.terminar(false)}
                  onEnviar={() => gravador.terminar(true)}
                />
              ) : (
              <div className="chat__input-row">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void anexar()}
                  disabled={!online}
                  title="Anexar imagem, vídeo ou documento"
                  aria-label="Anexar arquivo"
                >
                  <Icone nome="anexo" />
                </button>
                <textarea
                  className="chat__input"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={aoDigitar}
                  onPaste={(e) => void colar(e)}
                  placeholder={`Escreva para ${aberta.titulo}... (Enter envia, Shift+Enter quebra a linha)`}
                  maxLength={4000}
                  rows={2}
                />
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={enviando || (!texto.trim() && !anexo) || !online}
                >
                  {enviando ? 'Enviando...' : 'Enviar'}
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void gravador.comecar()}
                  disabled={!online || enviandoAudio || gravador.estado !== 'parado'}
                  title="Gravar mensagem de voz"
                  aria-label="Gravar mensagem de voz"
                >
                  <Icone nome="microfone" />
                </button>
              </div>
              )}
            </form>
          </>
        )}
      </section>

      {encaminhando && (
        <EncaminharMensagem
          mensagem={encaminhando}
          conversas={conversas}
          contatos={contatos}
          meuId={identidade.id}
          onFechar={() => setEncaminhando(null)}
          onEncaminhada={(quantos) => {
            setEncaminhando(null);
            setAviso(`Encaminhada para ${quantos} ${quantos === 1 ? 'conversa' : 'conversas'}.`);
            void carregarLista();
          }}
        />
      )}

      {criandoGrupo && (
        <NovoGrupo
          contatos={contatos}
          onFechar={() => setCriandoGrupo(false)}
          onCriado={(conversa) => void aoCriar(conversa)}
        />
      )}
    </div>
  );
}
