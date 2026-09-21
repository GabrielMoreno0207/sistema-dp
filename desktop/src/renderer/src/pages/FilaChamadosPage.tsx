import { useCallback, useEffect, useState } from 'react';
import type { ChamadoCompleto, ChamadoResumo, StatusChamado } from '../../../shared/types';
import {
  ConversaChamado,
  EtiquetaPrioridade,
  EtiquetaStatus,
  ROTULO_CATEGORIA,
  ROTULO_STATUS,
  quando,
} from '../components/chamados-comuns';

const PROXIMOS_STATUS: StatusChamado[] = ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO'];

/** Fila do TI: todos os chamados, com a conversa e o andamento. */
export function FilaChamadosPage() {
  const [chamados, setChamados] = useState<ChamadoResumo[]>([]);
  const [aberto, setAberto] = useState<ChamadoCompleto | null>(null);
  const [encerrados, setEncerrados] = useState(false);
  const [resposta, setResposta] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    const resultado = await window.dp.adminFila(encerrados);
    setChamados(resultado.chamados);
    setAviso(resultado.ok ? '' : resultado.message);
  }, [encerrados]);

  useEffect(() => {
    void carregar();
    // A fila é do TI e não chega por socket: recarrega sozinha enquanto a tela está aberta
    const timer = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(timer);
  }, [carregar]);

  async function abrirDetalhe(id: string) {
    const resultado = await window.dp.adminChamadoDetalhe(id);
    if (!resultado.ok || !resultado.chamado) {
      setAviso(resultado.message);
      return;
    }
    setAberto(resultado.chamado);
    if (resultado.chamado.naoLidas > 0) await window.dp.marcarChamadoLido(id);
    await carregar();
  }

  async function responder() {
    if (!aberto || !resposta.trim()) return;
    const resultado = await window.dp.adminResponderChamado(aberto.id, resposta);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setResposta('');
    await abrirDetalhe(aberto.id);
  }

  async function mudarStatus(status: StatusChamado) {
    if (!aberto) return;
    const resultado = await window.dp.adminMudarStatus(aberto.id, status);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    await abrirDetalhe(aberto.id);
  }

  return (
    <div className="page page--fila">
      <header className="page__header">
        <div>
          <h1>Chamados do TI</h1>
          <p className="page__subtitle">
            {chamados.length} {chamados.length === 1 ? 'chamado' : 'chamados'}
            {encerrados ? ' (incluindo encerrados)' : ' em aberto'}
          </p>
        </div>
        <label className="caixa">
          <input type="checkbox" checked={encerrados} onChange={(evento) => setEncerrados(evento.target.checked)} />
          mostrar encerrados
        </label>
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      <div className="fila">
        <div className="fila__lista">
          {chamados.length === 0 ? (
            <p className="page__subtitle">Nenhum chamado por aqui.</p>
          ) : (
            chamados.map((chamado) => (
              <button
                key={chamado.id}
                className={`chamado-item ${aberto?.id === chamado.id ? 'chamado-item--ativo' : ''}`}
                onClick={() => void abrirDetalhe(chamado.id)}
              >
                <span className="chamado-item__numero">#{chamado.numero}</span>
                <span className="chamado-item__texto">
                  <strong>{chamado.titulo}</strong>
                  <span className="chamado-item__detalhe">
                    {chamado.solicitanteNome} · {ROTULO_CATEGORIA[chamado.categoria]} · {quando(chamado.createdAt)}
                  </span>
                </span>
                <span className="chamado-item__lado">
                  <EtiquetaStatus status={chamado.status} />
                  <EtiquetaPrioridade prioridade={chamado.prioridade} />
                  {chamado.mensagensNaoLidas > 0 && <span className="chamado-item__badge">{chamado.mensagensNaoLidas}</span>}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="fila__detalhe">
          {!aberto ? (
            <p className="page__subtitle">Escolha um chamado para ver os detalhes.</p>
          ) : (
            <>
              <h2>
                #{aberto.numero} · {aberto.titulo}
              </h2>
              <p className="page__subtitle">
                {aberto.solicitanteNome}
                {aberto.computadorId && ` · ${aberto.computadorId}`} · {ROTULO_CATEGORIA[aberto.categoria]}
              </p>

              <div className="chamado__cabecalho">
                {PROXIMOS_STATUS.map((status) => (
                  <button
                    key={status}
                    className={`botao ${aberto.status === status ? 'botao--primario' : ''}`}
                    onClick={() => void mudarStatus(status)}
                    disabled={aberto.status === status}
                  >
                    {ROTULO_STATUS[status]}
                  </button>
                ))}
              </div>

              <div className="cartao chamado__descricao">
                <p>{aberto.descricao}</p>
                {aberto.midias.length > 0 && (
                  <div className="chamado__prints">
                    {aberto.midias.map((midia) => (
                      <img key={midia.id} src={`dpmidia://m/${midia.id}`} alt={midia.nome} />
                    ))}
                  </div>
                )}
              </div>

              <ConversaChamado mensagens={aberto.mensagens} souTi />

              {aberto.status !== 'FECHADO' && (
                <div className="chamado__responder">
                  <textarea
                    rows={3}
                    value={resposta}
                    maxLength={2000}
                    placeholder="Responder ao solicitante…"
                    onChange={(evento) => setResposta(evento.target.value)}
                  />
                  <button className="botao botao--primario" onClick={() => void responder()} disabled={!resposta.trim()}>
                    Enviar
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
