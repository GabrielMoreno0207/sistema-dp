import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EventoAgenda } from '../../../shared/types';
import { Icone } from '../lib/icones';

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Cores que a pessoa escolhe para o evento (as mesmas do editor de atalho). */
const CORES = ['#17b3a3', '#3f8fd0', '#6c63c7', '#2ea36f', '#d98324', '#c0554d'];

/** Data local no formato AAAA-MM-DD (o calendário não trabalha com fuso). */
function chaveDoDia(data: Date): string {
  const mes = `${data.getMonth() + 1}`.padStart(2, '0');
  const dia = `${data.getDate()}`.padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function porExtenso(chave: string): string {
  const [ano, mes, dia] = chave.split('-').map(Number);
  return `${`${dia}`.padStart(2, '0')} de ${MESES[mes - 1]} de ${ano}`;
}

/** Os 42 quadrados do mês: começa no domingo e termina completando a semana. */
function diasDaGrade(ano: number, mes: number): Date[] {
  const primeiro = new Date(ano, mes, 1);
  const inicio = new Date(ano, mes, 1 - primeiro.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
}

interface CalendarioProps {
  /** Id de quem está usando o aplicativo (define o que dá para apagar) */
  meuId: string | null;
  /** O TI apaga qualquer evento, inclusive os publicados por outra pessoa */
  ehTi: boolean;
  /** true quando quem está no aplicativo é do DP/TI (pode publicar para todos) */
  podePublicar: boolean;
  /** Sem ninguém identificado no PC a agenda fica fechada */
  disponivel: boolean;
}

/**
 * Calendário do mês com as anotações de cada um e os eventos da empresa.
 *
 * O dia escolhido abre a lista ao lado, onde dá para anotar um evento novo. O
 * DP e o TI têm a opção de publicar para todo mundo (aparece com etiqueta).
 */
export function Calendario({ meuId, ehTi, podePublicar, disponivel }: CalendarioProps) {
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

  const ano = mesVisivel.getFullYear();
  const mes = mesVisivel.getMonth();

  const carregar = useCallback(async () => {
    if (!disponivel) return;
    // Pega a grade inteira: o mês mais as pontas das semanas vizinhas
    const grade = diasDaGrade(ano, mes);
    const resposta = await window.dp.agendaApi<{ eventos: EventoAgenda[] }>(
      'GET',
      `/api/eventos?de=${chaveDoDia(grade[0])}&ate=${chaveDoDia(grade[grade.length - 1])}`,
    );
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setAviso('');
    setEventos(resposta.dados?.eventos ?? []);
  }, [ano, mes, disponivel]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, EventoAgenda[]>();
    for (const evento of eventos) {
      const doDia = mapa.get(evento.dia) ?? [];
      doDia.push(evento);
      mapa.set(evento.dia, doDia);
    }
    return mapa;
  }, [eventos]);

  const doDiaEscolhido = porDia.get(escolhido) ?? [];

  function irParaMes(passo: number) {
    setMesVisivel(new Date(ano, mes + passo, 1));
  }

  function voltarParaHoje() {
    setMesVisivel(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    setEscolhido(chaveDoDia(hoje));
  }

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!titulo.trim() || salvando) return;
    setSalvando(true);
    const resposta = await window.dp.agendaApi('POST', '/api/eventos', {
      titulo: titulo.trim(),
      dia: escolhido,
      hora: hora || null,
      cor,
      escopo: paraTodos ? 'GERAL' : 'PESSOAL',
    });
    setSalvando(false);
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setTitulo('');
    setHora('');
    setParaTodos(false);
    setCriando(false);
    await carregar();
  }

  async function apagar(id: string) {
    const resposta = await window.dp.agendaApi('DELETE', `/api/eventos/${id}`);
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    await carregar();
  }

  if (!disponivel) {
    return (
      <section className="agenda">
        <h2 className="agenda__titulo">Calendário</h2>
        <div className="cartao agenda__fechada">
          <Icone nome="agenda" tamanho={22} />
          <span>Entre com a sua matrícula para usar o calendário.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="agenda">
      <h2 className="agenda__titulo">Calendário</h2>

      <div className="cartao agenda__caixa">
        <div className="agenda__mes">
          <header className="agenda__cabecalho">
            <button className="btn btn--sm" onClick={() => irParaMes(-1)} aria-label="Mês anterior">
              <Icone nome="anterior" tamanho={15} />
            </button>
            <strong className="agenda__nome-do-mes">
              {MESES[mes][0].toUpperCase() + MESES[mes].slice(1)} de {ano}
            </strong>
            <button className="btn btn--sm" onClick={() => irParaMes(1)} aria-label="Próximo mês">
              <Icone nome="proximo" tamanho={15} />
            </button>
            <span className="modal__espaco" />
            <button className="btn btn--sm" onClick={voltarParaHoje}>
              Hoje
            </button>
          </header>

          <div className="agenda__semana">
            {DIAS_DA_SEMANA.map((dia) => (
              <span key={dia} className="agenda__dia-da-semana">
                {dia}
              </span>
            ))}
          </div>

          <div className="agenda__grade">
            {diasDaGrade(ano, mes).map((data) => {
              const chave = chaveDoDia(data);
              const doMes = data.getMonth() === mes;
              const doDia = porDia.get(chave) ?? [];
              const classes = ['agenda__dia'];
              if (!doMes) classes.push('agenda__dia--fora');
              if (chave === chaveDoDia(hoje)) classes.push('agenda__dia--hoje');
              if (chave === escolhido) classes.push('agenda__dia--escolhido');

              return (
                <button key={chave} className={classes.join(' ')} onClick={() => setEscolhido(chave)}>
                  <span className="agenda__numero">{data.getDate()}</span>
                  {doDia.length > 0 && (
                    <span className="agenda__marcas">
                      {doDia.slice(0, 3).map((evento) => (
                        <span key={evento.id} className="agenda__marca" style={{ background: evento.cor }} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="agenda__lado">
          <header className="agenda__lado-topo">
            <strong>{porExtenso(escolhido)}</strong>
            <button className="btn btn--sm btn--primary" onClick={() => setCriando((v) => !v)}>
              {criando ? 'Cancelar' : '+ Evento'}
            </button>
          </header>

          {criando && (
            <form className="agenda__form" onSubmit={(e) => void salvar(e)}>
              <input
                className="agenda__campo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="O que acontece nesse dia?"
                maxLength={120}
                autoFocus
              />
              <div className="agenda__linha">
                <input
                  className="agenda__campo agenda__campo--hora"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  placeholder="hh:mm"
                  maxLength={5}
                  aria-label="Hora (opcional)"
                />
                <span className="agenda__cores">
                  {CORES.map((opcao) => (
                    <button
                      key={opcao}
                      type="button"
                      className={`agenda__cor ${cor === opcao ? 'agenda__cor--ativa' : ''}`}
                      style={{ background: opcao }}
                      onClick={() => setCor(opcao)}
                      aria-label={`Cor ${opcao}`}
                    />
                  ))}
                </span>
              </div>
              {podePublicar && (
                <label className="caixa">
                  <input type="checkbox" checked={paraTodos} onChange={(e) => setParaTodos(e.target.checked)} />
                  publicar para toda a empresa
                </label>
              )}
              <button type="submit" className="btn btn--primary" disabled={!titulo.trim() || salvando}>
                {salvando ? 'Salvando...' : 'Salvar evento'}
              </button>
            </form>
          )}

          {aviso && <p className="feedback feedback--error">{aviso}</p>}

          <ul className="agenda__lista">
            {doDiaEscolhido.length === 0 && !criando && <li className="agenda__vazio">Nada marcado nesse dia.</li>}
            {doDiaEscolhido.map((evento) => (
              <li key={evento.id} className="agenda__evento">
                <span className="agenda__evento-cor" style={{ background: evento.cor }} />
                <span className="agenda__evento-texto">
                  <strong>
                    {evento.hora && <span className="agenda__evento-hora">{evento.hora}</span>}
                    {evento.titulo}
                  </strong>
                  <small>
                    {evento.escopo === 'GERAL' ? `Empresa · ${evento.criadoPorNome}` : 'Sua anotação'}
                  </small>
                </span>
                {(evento.criadoPor === meuId || ehTi) && (
                  <button
                    className="link-btn link-btn--perigo"
                    onClick={() => void apagar(evento.id)}
                    title="Apagar evento"
                  >
                    apagar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
