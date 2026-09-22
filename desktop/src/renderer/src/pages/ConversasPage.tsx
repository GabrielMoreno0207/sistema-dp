import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type {
  ConnectionState,
  ConversaResumo,
  IdentidadeChat,
  MensagemConversa,
  MidiaPublica,
  Participante,
} from '../../../shared/types';
import { NovoGrupo } from '../components/NovoGrupo';
import { PainelGrupo } from '../components/PainelGrupo';
import { Avatar, MensagemDaConversa, dataDoDia, juntarMensagens, outraPessoa } from '../components/conversa-comuns';
import { Icone } from '../lib/icones';
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
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [criandoGrupo, setCriandoGrupo] = useState(false);
  const [encaminhando, setEncaminhando] = useState<MensagemConversa | null>(null);
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
    const parar = window.dp.onConversasChange(() => {
      void carregarLista();
      const id = abertaRef.current;
      if (id) void carregarMensagens(id);
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
  }, [identidade, carregarLista, carregarMensagens]);

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

  if (identidade === undefined) return <div className="loading">Carregando...</div>;

  if (identidade === null) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1>Mensagens</h1>
            <p className="page__subtitle">Converse com colegas, com o DP e em grupos.</p>
          </div>
        </header>
        <section className="panel panel--muted">
          <h2>Entre para ver suas conversas</h2>
          <p>
            As conversas são pessoais: entre com sua matrícula para falar com colegas e com o Departamento Pessoal. Os
            comunicados gerais continuam na página Comunicados.
          </p>
          <div className="form__actions form__actions--start">
            <button className="btn btn--primary" onClick={onRequestLogin}>
              Entrar com minha matrícula
            </button>
          </div>
        </section>
      </div>
    );
  }

  async function abrir(conversaId: string) {
    // Marca já aqui: a conferência das respostas atrasadas usa este valor
    abertaRef.current = conversaId;
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
        { conteudo, midiaId: anexo?.id ?? null },
      );
      if (!resposta.ok) {
        setErro(resposta.message);
        return;
      }
      setTexto('');
      setAnexo(null);
      const nova = resposta.dados?.mensagem;
      if (nova) setMensagens((atual) => juntarMensagens(atual, [nova]));
      await carregarLista();
    } finally {
      setEnviando(false);
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
            {identidade.ehDp && ' (DP)'}
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
                      {pessoa.ehDp ? 'Departamento Pessoal' : (pessoa.setor ?? 'Sem setor')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="chat">
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
              {aberta.tipo === 'GRUPO' && (
                <button className="btn btn--sm" onClick={() => setVerGrupo((v) => !v)}>
                  {verGrupo ? 'Fechar' : 'Participantes'}
                </button>
              )}
            </header>

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
                      mensagem={mensagem}
                      minha={mensagem.autorId === identidade.id}
                      emGrupo={aberta.tipo === 'GRUPO'}
                      onApagar={() => void apagar(mensagem.id)}
                      onEncaminhar={() => setEncaminhando(mensagem)}
                      onErro={setErro}
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
              {anexo && (
                <p className="chat__anexo">
                  <Icone nome="anexo" /> {anexo.nome}
                  <button type="button" className="btn btn--sm" onClick={() => setAnexo(null)}>
                    Remover
                  </button>
                </p>
              )}
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
              </div>
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
