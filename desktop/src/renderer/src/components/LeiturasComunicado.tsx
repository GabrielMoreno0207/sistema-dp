import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { quando } from './chamados-comuns';
import { Avatar } from './conversa-comuns';
import { Icone } from '../lib/icones';

/** Quem leu, no formato que a API devolve */
export interface Leitura {
  type: string;
  id: string;
  name: string;
  /** Usuário, ou o identificador do computador */
  detail: string | null;
  sector: string | null;
  /** Em qual computador a leitura aconteceu */
  computer: string | null;
  readAt: string;
  /** Quando confirmou "li e estou ciente" (null = só abriu) */
  cienteEm: string | null;
}

/** Quem ainda não leu (só para destinos com lista conhecida) */
export interface Pendente {
  type: string;
  id: string;
  name: string;
  detail: string | null;
  sector: string | null;
  situation: string;
}

/**
 * O comunicado cuja audiência estamos olhando. Tipado só com o que a janela
 * usa, para a página poder passar o resumo que já tem em mãos.
 */
export interface ComunicadoDaJanela {
  id: string;
  title: string;
  sender: string;
  createdAt: string;
  exigeCiencia: boolean;
  recipientCount: number;
}

type Aba = 'leram' | 'pendentes' | 'sem-ciencia';
type Ordem = 'hora' | 'nome' | 'setor';

const SEM_SETOR = 'Sem setor';

/** "há 4 min", "há 3 h", "há 2 dias" — o relógio exato fica no title. */
function haQuanto(iso: string): string {
  const quanto = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(quanto)) return '';
  const minutos = Math.floor(quanto / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? um : muitos;
}

/** Acento e caixa não devem atrapalhar quem digita no campo de procurar. */
function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Agrupa a lista por setor, em ordem alfabética, para os subtítulos. */
function porSetor<T extends { sector: string | null; name: string }>(itens: T[]): [string, T[]][] {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const setor = item.sector ?? SEM_SETOR;
    const atual = grupos.get(setor);
    if (atual) atual.push(item);
    else grupos.set(setor, [item]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === SEM_SETOR ? 1 : b === SEM_SETOR ? -1 : a.localeCompare(b, 'pt-BR')))
    .map(([setor, lista]) => [setor, [...lista].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))] as [string, T[]]);
}

/**
 * Quem viu o comunicado: os números em cima, a lista embaixo, separada em
 * "já leram", "não leram" e — quando o comunicado pede ciência — "sem
 * confirmar". Dá para procurar pelo nome, ordenar, agrupar por setor, copiar
 * a lista e lembrar quem ficou para trás.
 */
export function LeiturasComunicado({
  comunicado,
  destino,
  tipoLabel,
  onFechar,
  onAviso,
}: {
  comunicado: ComunicadoDaJanela;
  /** Destino já escrito por extenso pela página ("Um setor: Expedição") */
  destino: string;
  /** Tipo já escrito por extenso ("Aviso") */
  tipoLabel: string;
  onFechar: () => void;
  onAviso: (texto: string) => void;
}) {
  const [lista, setLista] = useState<Leitura[]>([]);
  const [pendentes, setPendentes] = useState<Pendente[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>('leram');
  const [ordem, setOrdem] = useState<Ordem>('hora');
  const [procura, setProcura] = useState('');
  const [avisando, setAvisando] = useState(false);
  const campoProcura = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const resultado = await window.dp.adminApi<{ reads: Leitura[]; pending: Pendente[] | null }>(
      'GET',
      `/api/messages/${encodeURIComponent(comunicado.id)}/reads`,
    );
    setCarregando(false);
    if (!resultado.ok || !resultado.dados) {
      setErro(resultado.message);
      return;
    }
    setErro('');
    setLista(resultado.dados.reads ?? []);
    setPendentes(resultado.dados.pending);
  }, [comunicado.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Esc fecha, como nas outras janelas do aplicativo
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  // O foco começa no campo de procurar: em comunicado para todos, é por onde
  // se acha alguém sem rolar a lista inteira
  useEffect(() => {
    if (!carregando) campoProcura.current?.focus();
  }, [carregando]);

  const semCiencia = useMemo(
    () => (comunicado.exigeCiencia ? lista.filter((l) => !l.cienteEm) : []),
    [comunicado.exigeCiencia, lista],
  );
  const naoLeram = pendentes ?? [];
  const confirmaram = lista.length - semCiencia.length;
  // Com a lista de pendentes em mãos ela é a verdade; sem ela, vale a conta do servidor
  const total = pendentes ? lista.length + naoLeram.length : Math.max(comunicado.recipientCount, lista.length);
  const porcento = total === 0 ? 0 : Math.round((lista.length / total) * 100);
  const faltam = naoLeram.length + semCiencia.length;

  // Sem hora de leitura, a aba dos pendentes cai no nome
  const ordemVisivel: Ordem = aba === 'pendentes' && ordem === 'hora' ? 'nome' : ordem;
  const filtro = semAcento(procura.trim());
  const combina = useCallback(
    (campos: (string | null)[]) => !filtro || campos.some((c) => c && semAcento(c).includes(filtro)),
    [filtro],
  );

  const leramFiltrados = useMemo(() => {
    const base = (aba === 'sem-ciencia' ? semCiencia : lista).filter((l) =>
      combina([l.name, l.detail, l.sector, l.computer]),
    );
    if (ordem === 'hora') return [...base].sort((a, b) => b.readAt.localeCompare(a.readAt));
    return [...base].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [aba, lista, semCiencia, combina, ordem]);

  const pendentesFiltrados = useMemo(
    () => naoLeram.filter((p) => combina([p.name, p.detail, p.sector, p.situation])),
    [naoLeram, combina],
  );

  /** Faz o alerta do comunicado voltar à tela de quem ainda não leu. */
  async function avisarPendentes(): Promise<void> {
    setAvisando(true);
    const resultado = await window.dp.adminApi<{ avisados: number }>(
      'POST',
      `/api/messages/${encodeURIComponent(comunicado.id)}/avisar-pendentes`,
    );
    setAvisando(false);
    if (!resultado.ok || !resultado.dados) {
      setErro(resultado.message);
      return;
    }
    const quantos = resultado.dados.avisados;
    onAviso(
      quantos === 0
        ? 'Ninguém para lembrar: todo mundo já leu (e confirmou, quando o comunicado pede).'
        : `Lembrete enviado para ${quantos} ${plural(quantos, 'pessoa', 'pessoas')}. O alerta volta à tela de quem estiver com o aplicativo aberto.`,
    );
    onFechar();
  }

  /** Leva a aba que está à vista para a área de transferência, em texto. */
  async function copiarAba(): Promise<void> {
    const linhas =
      aba === 'pendentes'
        ? pendentesFiltrados.map((p) => [p.name, p.sector, p.detail, p.situation].filter(Boolean).join(' · '))
        : leramFiltrados.map((l) =>
            [
              l.name,
              l.sector,
              l.computer ? `no ${l.computer}` : null,
              `leu em ${quando(l.readAt)}`,
              comunicado.exigeCiencia ? (l.cienteEm ? `ciente em ${quando(l.cienteEm)}` : 'sem confirmação') : null,
            ]
              .filter(Boolean)
              .join(' · '),
          );
    if (linhas.length === 0) {
      setErro('Nada para copiar nesta aba.');
      return;
    }
    const titulo = aba === 'pendentes' ? 'Ainda não leram' : aba === 'sem-ciencia' ? 'Leram sem confirmar' : 'Já leram';
    const resultado = await window.dp.copiarTexto(
      [`${comunicado.title} — ${titulo} (${linhas.length})`, '', ...linhas].join('\r\n'),
    );
    onAviso(
      resultado.ok ? `Lista copiada: ${linhas.length} ${plural(linhas.length, 'nome', 'nomes')}.` : resultado.message,
    );
  }

  const abas: { valor: Aba; rotulo: string; quantos: number }[] = [
    { valor: 'leram', rotulo: 'Já leram', quantos: lista.length },
    { valor: 'pendentes', rotulo: 'Não leram', quantos: naoLeram.length },
    ...(comunicado.exigeCiencia
      ? [{ valor: 'sem-ciencia' as Aba, rotulo: 'Sem confirmar', quantos: semCiencia.length }]
      : []),
  ];

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Leituras de ${comunicado.title}`}
      onClick={onFechar}
    >
      <div className="modal__caixa modal__caixa--leituras" onClick={(evento) => evento.stopPropagation()}>
        <header className="leituras__cabecalho">
          <div className="leituras__identificacao">
            <h2 className="leituras__nome">{comunicado.title}</h2>
            <p className="leituras__legenda">
              {tipoLabel} · {destino} · enviado {quando(comunicado.createdAt)} por {comunicado.sender}
            </p>
          </div>
          <button className="leituras__fechar" onClick={onFechar} title="Fechar (Esc)" aria-label="Fechar">
            <Icone nome="fechar" tamanho={16} />
          </button>
        </header>

        <section className="leituras__resumo">
          <div className="leituras__medidor">
            <div className="leituras__medidor-topo">
              <strong className="leituras__grande">
                {lista.length} <span className="leituras__de">de {total}</span>
              </strong>
              <span className="leituras__porcento">{porcento}%</span>
            </div>
            <div className="leituras__trilha">
              <span className="leituras__barra" style={{ width: `${porcento}%` }} />
            </div>
            <p className="leituras__legenda">
              {total > 0 && lista.length === total
                ? 'Todo mundo já abriu o comunicado.'
                : pendentes
                  ? `${plural(lista.length, 'abriu', 'abriram')} o comunicado`
                  : 'abriram o comunicado (este destino não tem lista de pendentes)'}
            </p>
          </div>
          <div className="leituras__numeros">
            <div className="leituras__numero">
              <span className="leituras__numero-valor">{naoLeram.length}</span>
              <span className="leituras__numero-rotulo">não {plural(naoLeram.length, 'leu', 'leram')}</span>
            </div>
            {comunicado.exigeCiencia && (
              <>
                <div className="leituras__numero">
                  <span className="leituras__numero-valor leituras__numero-valor--ok">{confirmaram}</span>
                  <span className="leituras__numero-rotulo">
                    <Icone nome="ciencia" tamanho={11} /> {plural(confirmaram, 'confirmou', 'confirmaram')}
                  </span>
                </div>
                <div className="leituras__numero">
                  <span className="leituras__numero-valor leituras__numero-valor--aviso">{semCiencia.length}</span>
                  <span className="leituras__numero-rotulo">sem confirmar</span>
                </div>
              </>
            )}
          </div>
        </section>

        <div className="leituras__ferramentas">
          <div className="abas abas--linha leituras__abas">
            {abas.map((item) => (
              <button
                key={item.valor}
                className={`login-aba ${aba === item.valor ? 'login-aba--ativa' : ''}`}
                onClick={() => setAba(item.valor)}
              >
                {item.rotulo} <span className="leituras__contador">{item.quantos}</span>
              </button>
            ))}
          </div>
          <div className="leituras__controles">
            <input
              ref={campoProcura}
              className="leituras__procura"
              type="search"
              aria-label="Procurar por nome, setor ou computador"
              placeholder="Procurar…"
              value={procura}
              onChange={(evento) => setProcura(evento.target.value)}
            />
            <select
              className="leituras__ordem"
              value={ordemVisivel}
              onChange={(evento) => setOrdem(evento.target.value as Ordem)}
              aria-label="Como ordenar a lista"
            >
              {/* Quem não leu não tem hora de leitura: lá a escolha é nome ou setor */}
              {aba !== 'pendentes' && <option value="hora">Mais recentes</option>}
              <option value="nome">Por nome</option>
              <option value="setor">Agrupar por setor</option>
            </select>
            <button className="leituras__fechar" onClick={() => void carregar()} title="Atualizar" aria-label="Atualizar">
              <Icone nome="atualizar" tamanho={15} />
            </button>
          </div>
        </div>

        {erro && <p className="leituras__erro">{erro}</p>}

        <div className="leituras">
          {carregando ? (
            <p className="leituras__vazio">Carregando…</p>
          ) : aba === 'pendentes' ? (
            <ListaPendentes
              itens={pendentesFiltrados}
              agrupar={ordemVisivel === 'setor'}
              temFiltro={filtro.length > 0}
            />
          ) : (
            <ListaLeram
              itens={leramFiltrados}
              agrupar={ordem === 'setor'}
              exigeCiencia={comunicado.exigeCiencia}
              aba={aba}
              temFiltro={filtro.length > 0}
            />
          )}
        </div>

        <footer className="modal__rodape">
          <button className="botao" onClick={() => void copiarAba()}>
            <Icone nome="copiar" tamanho={14} /> Copiar lista
          </button>
          <span className="modal__espaco" />
          {faltam > 0 && (
            <button className="botao botao--primario" onClick={() => void avisarPendentes()} disabled={avisando}>
              <Icone nome="sino" tamanho={14} />{' '}
              {avisando
                ? 'Avisando…'
                : naoLeram.length === 0
                  ? `Avisar ${semCiencia.length} que falta confirmar`
                  : `Avisar ${faltam} ${plural(faltam, 'pessoa', 'pessoas')}`}
            </button>
          )}
          <button className="botao" onClick={onFechar}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Uma pessoa (ou computador) que leu. */
function ItemLeu({
  leitura,
  exigeCiencia,
  agrupado,
}: {
  leitura: Leitura;
  exigeCiencia: boolean;
  agrupado: boolean;
}) {
  const ehComputador = leitura.type === 'COMPUTER';
  return (
    <div className="leituras__item">
      {ehComputador ? (
        <span className="leituras__avatar leituras__avatar--pc">
          <Icone nome="computador" tamanho={15} />
        </span>
      ) : (
        <Avatar nome={leitura.name} classe="leituras__avatar" />
      )}
      <div className="leituras__texto">
        <span className="leituras__quem">{leitura.name}</span>
        <span className="leituras__onde">
          {[
            leitura.detail,
            agrupado ? null : leitura.sector,
            !ehComputador && leitura.computer ? `no ${leitura.computer}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </span>
      </div>
      <div className="leituras__lado">
        <span className="leituras__quando" title={quando(leitura.readAt)}>
          {haQuanto(leitura.readAt)}
        </span>
        {exigeCiencia &&
          (leitura.cienteEm ? (
            <span className="etiqueta etiqueta--ok" title={`Confirmou em ${quando(leitura.cienteEm)}`}>
              <Icone nome="ciencia" tamanho={11} /> ciente
            </span>
          ) : (
            <span className="etiqueta etiqueta--aviso">só abriu</span>
          ))}
      </div>
    </div>
  );
}

function ListaLeram({
  itens,
  agrupar,
  exigeCiencia,
  aba,
  temFiltro,
}: {
  itens: Leitura[];
  agrupar: boolean;
  exigeCiencia: boolean;
  aba: Aba;
  temFiltro: boolean;
}) {
  if (itens.length === 0) {
    return (
      <p className="leituras__vazio">
        {temFiltro
          ? 'Ninguém com esse nome nesta aba.'
          : aba === 'sem-ciencia'
            ? 'Todo mundo que leu já confirmou a ciência.'
            : 'Ninguém leu ainda.'}
      </p>
    );
  }
  if (!agrupar) {
    return (
      <>
        {itens.map((leitura) => (
          <ItemLeu key={leitura.id} leitura={leitura} exigeCiencia={exigeCiencia} agrupado={false} />
        ))}
      </>
    );
  }
  return (
    <>
      {porSetor(itens).map(([setor, doSetor]) => (
        <div key={setor} className="leituras__grupo">
          <h3 className="leituras__setor">
            {setor} <span className="leituras__contador">{doSetor.length}</span>
          </h3>
          {doSetor.map((leitura) => (
            <ItemLeu key={leitura.id} leitura={leitura} exigeCiencia={exigeCiencia} agrupado />
          ))}
        </div>
      ))}
    </>
  );
}

/** Uma pessoa (ou computador) que ainda não leu. */
function ItemPendente({ pendente, agrupado }: { pendente: Pendente; agrupado: boolean }) {
  const ehComputador = pendente.type === 'COMPUTER';
  // Agrupado por setor, repetir o setor em cada linha só atrapalha a leitura
  const onde = [pendente.detail, agrupado ? null : pendente.sector].filter(Boolean).join(' · ');
  return (
    <div className="leituras__item">
      {ehComputador ? (
        <span className="leituras__avatar leituras__avatar--pc">
          <Icone nome="computador" tamanho={15} />
        </span>
      ) : (
        <Avatar nome={pendente.name} classe="leituras__avatar leituras__avatar--apagado" />
      )}
      <div className="leituras__texto">
        <span className="leituras__quem">{pendente.name}</span>
        <span className="leituras__onde">{onde || '—'}</span>
      </div>
      <div className="leituras__lado">
        {/* "Ativo" é o comum e não diz nada; Inativo, Excluído e o PC ligado/desligado, sim */}
        {pendente.situation !== 'Ativo' && (
          <span className="leituras__situacao">
            {ehComputador && <span className={`ponto ${pendente.situation === 'Online' ? 'ponto--online' : ''}`} />}
            {pendente.situation}
          </span>
        )}
      </div>
    </div>
  );
}

function ListaPendentes({ itens, agrupar, temFiltro }: { itens: Pendente[]; agrupar: boolean; temFiltro: boolean }) {
  if (itens.length === 0) {
    return <p className="leituras__vazio">{temFiltro ? 'Ninguém com esse nome nesta aba.' : 'Todo mundo já leu.'}</p>;
  }
  if (!agrupar) {
    return (
      <>
        {[...itens]
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          .map((pendente) => (
            <ItemPendente key={pendente.id} pendente={pendente} agrupado={false} />
          ))}
      </>
    );
  }
  return (
    <>
      {porSetor(itens).map(([setor, doSetor]) => (
        <div key={setor} className="leituras__grupo">
          <h3 className="leituras__setor">
            {setor} <span className="leituras__contador">{doSetor.length}</span>
          </h3>
          {doSetor.map((pendente) => (
            <ItemPendente key={pendente.id} pendente={pendente} agrupado />
          ))}
        </div>
      ))}
    </>
  );
}
