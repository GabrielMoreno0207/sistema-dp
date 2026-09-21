import { useCallback, useEffect, useState } from 'react';
import { quando } from '../../components/chamados-comuns';

type TipoComunicado = 'COMUNICADO' | 'AVISO' | 'INFORMATIVO' | 'URGENTE';
type Destino = 'ALL' | 'SECTOR' | 'SHIFT' | 'COMPUTER' | 'EMPLOYEE';

const TIPOS: { valor: TipoComunicado; label: string }[] = [
  { valor: 'COMUNICADO', label: 'Comunicado' },
  { valor: 'AVISO', label: 'Aviso' },
  { valor: 'INFORMATIVO', label: 'Informativo' },
  { valor: 'URGENTE', label: 'Urgente' },
];

const DESTINOS: { valor: Destino; label: string }[] = [
  { valor: 'ALL', label: 'Todos os computadores' },
  { valor: 'SECTOR', label: 'Um setor' },
  { valor: 'SHIFT', label: 'Um turno' },
  { valor: 'COMPUTER', label: 'Um computador' },
  { valor: 'EMPLOYEE', label: 'Um funcionário' },
];

interface EnviadoResumo {
  id: string;
  title: string;
  content: string;
  type: TipoComunicado;
  target: Destino;
  targetId: string | null;
  sender: string;
  createdAt: string;
  readCount: number;
  recipientCount: number;
}

/** Quem leu, no formato que a API devolve */
interface Leitura {
  type: string;
  id: string;
  name: string;
  /** Matrícula, ou o identificador do computador */
  detail: string | null;
  sector: string | null;
  /** Em qual computador a leitura aconteceu */
  computer: string | null;
  readAt: string;
}

/** Quem ainda não leu (só para destinos com lista conhecida) */
interface Pendente {
  type: string;
  id: string;
  name: string;
  detail: string | null;
  sector: string | null;
  situation: string;
}

/** Novo comunicado e histórico de enviados, dentro do aplicativo. */
export function ComunicadosAdminPage({ ehTi }: { ehTi: boolean }) {
  const [aba, setAba] = useState<'novo' | 'enviados'>('novo');
  const [enviados, setEnviados] = useState<EnviadoResumo[]>([]);
  const [leituras, setLeituras] = useState<{ titulo: string; lista: Leitura[]; pendentes: Pendente[] } | null>(null);
  const [aviso, setAviso] = useState('');

  // formulário
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<TipoComunicado>('COMUNICADO');
  const [destino, setDestino] = useState<Destino>('ALL');
  const [destinoId, setDestinoId] = useState('');
  const [opcoes, setOpcoes] = useState<{ valor: string; label: string }[]>([]);
  const [anexos, setAnexos] = useState<{ id: string; name: string; size: number }[]>([]);
  const [enviando, setEnviando] = useState(false);

  const carregarEnviados = useCallback(async () => {
    const resultado = await window.dp.adminApi<{ messages: EnviadoResumo[] }>('GET', '/api/messages?limit=100');
    if (!resultado.ok || !resultado.dados) {
      setAviso(resultado.message);
      return;
    }
    setEnviados(resultado.dados.messages);
  }, []);

  useEffect(() => {
    if (aba === 'enviados') void carregarEnviados();
  }, [aba, carregarEnviados]);

  // As opções de destino vêm do servidor conforme o tipo escolhido
  useEffect(() => {
    async function carregarOpcoes() {
      setDestinoId('');
      if (destino === 'ALL') {
        setOpcoes([]);
        return;
      }
      if (destino === 'SECTOR') {
        const r = await window.dp.adminApi<{ sectors: { id: string; name: string }[] }>('GET', '/api/sectors');
        setOpcoes((r.dados?.sectors ?? []).map((s) => ({ valor: s.name, label: s.name })));
        return;
      }
      if (destino === 'COMPUTER') {
        const r = await window.dp.adminApi<{ computers: { computerId: string; hostname: string }[] }>('GET', '/api/computers');
        setOpcoes((r.dados?.computers ?? []).map((c) => ({ valor: c.computerId, label: `${c.hostname} (${c.computerId})` })));
        return;
      }
      const r = await window.dp.adminApi<{ employees: { id: string; name: string; registration: string; shift: string | null }[] }>(
        'GET',
        '/api/employees',
      );
      const lista = r.dados?.employees ?? [];
      if (destino === 'EMPLOYEE') {
        setOpcoes(lista.map((e) => ({ valor: e.id, label: `${e.name} (${e.registration})` })));
      } else {
        const turnos = [...new Set(lista.map((e) => e.shift).filter((t): t is string => Boolean(t)))];
        setOpcoes(turnos.map((t) => ({ valor: t, label: t })));
      }
    }
    void carregarOpcoes();
  }, [destino]);

  async function anexar() {
    const resultado = await window.dp.adminAnexar();
    if (!resultado.ok) {
      if (resultado.message) setAviso(resultado.message);
      return;
    }
    setAnexos((atuais) => [...atuais, ...resultado.anexos].slice(0, 5));
  }

  async function enviar() {
    if (destino !== 'ALL' && !destinoId) {
      setAviso('Escolha o destino.');
      return;
    }
    setEnviando(true);
    setAviso('');
    const resultado = await window.dp.adminApi('POST', '/api/messages', {
      title: titulo,
      content: texto,
      type: tipo,
      target: destino,
      ...(destino === 'ALL' ? {} : { targetId: destinoId }),
      ...(anexos.length > 0 ? { attachmentIds: anexos.map((a) => a.id) } : {}),
    });
    setEnviando(false);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setTitulo('');
    setTexto('');
    setAnexos([]);
    setAviso('Comunicado enviado.');
  }

  async function verLeituras(comunicado: EnviadoResumo) {
    const resultado = await window.dp.adminApi<{ reads: Leitura[]; pending: Pendente[] | null }>(
      'GET',
      `/api/messages/${encodeURIComponent(comunicado.id)}/reads`,
    );
    if (!resultado.ok || !resultado.dados) {
      setAviso(resultado.message);
      return;
    }
    setLeituras({
      titulo: comunicado.title,
      lista: resultado.dados.reads ?? [],
      pendentes: resultado.dados.pending ?? [],
    });
  }

  /** Apagar comunicado é função da conta do TI. */
  async function apagarComunicado(comunicado: EnviadoResumo) {
    const resultado = await window.dp.adminApi('DELETE', `/api/admin/messages/${encodeURIComponent(comunicado.id)}`);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setAviso(`Comunicado ${comunicado.id} apagado.`);
    await carregarEnviados();
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Comunicados</h1>
          <p className="page__subtitle">Envie avisos para os computadores e acompanhe quem já leu.</p>
        </div>
        <div className="login-card__abas abas--linha">
          <button className={`login-aba ${aba === 'novo' ? 'login-aba--ativa' : ''}`} onClick={() => setAba('novo')}>
            Novo comunicado
          </button>
          <button className={`login-aba ${aba === 'enviados' ? 'login-aba--ativa' : ''}`} onClick={() => setAba('enviados')}>
            Enviados
          </button>
        </div>
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      {aba === 'novo' ? (
        <div className="novo-comunicado">
        <div className="cartao formulario">
          <label htmlFor="com-titulo">Título</label>
          <input id="com-titulo" value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} />

          <label htmlFor="com-texto">Mensagem</label>
          <textarea id="com-texto" rows={7} value={texto} maxLength={5000} onChange={(e) => setTexto(e.target.value)} />

          <div className="formulario__linha">
            <div>
              <label htmlFor="com-tipo">Tipo</label>
              <select id="com-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoComunicado)}>
                {TIPOS.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="com-destino">Destino</label>
              <select id="com-destino" value={destino} onChange={(e) => setDestino(e.target.value as Destino)}>
                {DESTINOS.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </div>
            {destino !== 'ALL' && (
              <div>
                <label htmlFor="com-destino-id">Qual</label>
                <select id="com-destino-id" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {opcoes.map((opcao) => (
                    <option key={opcao.valor} value={opcao.valor}>
                      {opcao.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="formulario__anexos">
            <button className="botao" onClick={() => void anexar()} disabled={anexos.length >= 5}>
              Anexar arquivos ({anexos.length}/5)
            </button>
            {anexos.map((anexo) => (
              <span key={anexo.id} className="anexo-chip">
                {anexo.name}
                <button onClick={() => setAnexos((atuais) => atuais.filter((a) => a.id !== anexo.id))} aria-label="Remover">
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="formulario__acoes">
            <button
              className="botao botao--primario"
              onClick={() => void enviar()}
              disabled={enviando || !titulo.trim() || !texto.trim()}
            >
              {enviando ? 'Enviando…' : 'Enviar comunicado'}
            </button>
          </div>
        </div>

        <aside className="cartao previa-alerta">
          <h2 className="formulario__titulo">Prévia do alerta</h2>
          <p className="page__subtitle">É assim que aparece no canto da tela dos funcionários, com som.</p>
          <div className="previa-alerta__tela">
            <div className={`previa-toast previa-toast--${tipo.toLowerCase()}`}>
              <div className="previa-toast__cabecalho">
                <span className="previa-toast__tipo">
                  {TIPOS.find((t) => t.valor === tipo)?.label.toUpperCase()} · DP
                </span>
                <span className="previa-toast__hora">agora</span>
              </div>
              <strong className="previa-toast__titulo">{titulo.trim() || 'Título da mensagem'}</strong>
              <p className="previa-toast__texto">{texto.trim() || 'O texto da mensagem aparece aqui.'}</p>
              {anexos.length > 0 && (
                <span className="previa-toast__anexos">
                  {anexos.length} {anexos.length === 1 ? 'anexo' : 'anexos'}
                </span>
              )}
              <div className="previa-toast__acoes">
                <span className="previa-toast__botao">Fechar</span>
                <span className="previa-toast__botao previa-toast__botao--principal">Visualizar</span>
              </div>
            </div>
          </div>
        </aside>
        </div>
      ) : (
        <div className="tabela-caixa">
          <table className="tabela">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tipo</th>
                <th>Título</th>
                <th>Destino</th>
                <th>Enviado</th>
                <th>Leituras</th>
                {ehTi && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {enviados.length === 0 ? (
                <tr>
                  <td colSpan={ehTi ? 7 : 6} className="tabela__vazia">
                    Nenhum comunicado enviado ainda.
                  </td>
                </tr>
              ) : (
                enviados.map((comunicado) => (
                  <tr key={comunicado.id}>
                    <td>{comunicado.id}</td>
                    <td>
                      <span className={`etiqueta etiqueta--${comunicado.type.toLowerCase()}`}>
                        {TIPOS.find((t) => t.valor === comunicado.type)?.label ?? comunicado.type}
                      </span>
                    </td>
                    <td>{comunicado.title}</td>
                    <td>
                      {DESTINOS.find((d) => d.valor === comunicado.target)?.label ?? comunicado.target}
                      {comunicado.targetId ? `: ${comunicado.targetId}` : ''}
                    </td>
                    <td>{quando(comunicado.createdAt)}</td>
                    <td>
                      <button className="link-btn" onClick={() => void verLeituras(comunicado)}>
                        {comunicado.readCount} de {comunicado.recipientCount}
                      </button>
                    </td>
                    {ehTi && (
                      <td className="tabela__acoes">
                        <button className="link-btn link-btn--perigo" onClick={() => void apagarComunicado(comunicado)}>
                          apagar
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {leituras && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setLeituras(null)}>
          <div className="modal__caixa" onClick={(evento) => evento.stopPropagation()}>
            <h2 className="modal__titulo">{leituras.titulo}</h2>

            <h3 className="leituras__titulo">Já leram ({leituras.lista.length})</h3>
            {leituras.lista.length === 0 ? (
              <p className="page__subtitle">Ninguém leu ainda.</p>
            ) : (
              <div className="leituras">
                {leituras.lista.map((leitura) => (
                  <div key={leitura.id} className="leituras__item">
                    <strong>{leitura.name}</strong>
                    <span className="page__subtitle">
                      {[
                        leitura.detail,
                        leitura.sector,
                        leitura.computer ? `no ${leitura.computer}` : null,
                        quando(leitura.readAt),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {leituras.pendentes.length > 0 && (
              <>
                <h3 className="leituras__titulo">Ainda não leram ({leituras.pendentes.length})</h3>
                <div className="leituras">
                  {leituras.pendentes.map((pendente) => (
                    <div key={pendente.id} className="leituras__item leituras__item--pendente">
                      <strong>{pendente.name}</strong>
                      <span className="page__subtitle">
                        {[pendente.detail, pendente.sector, pendente.situation].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <footer className="modal__rodape">
              <span className="modal__espaco" />
              <button className="botao" onClick={() => setLeituras(null)}>
                Fechar
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
