import { useCallback, useEffect, useState } from 'react';
import type { ChamadoCompleto, ChamadoNota, ChamadoResumo, StatusChamado } from '../../../shared/types';
import {
  ConversaChamado,
  EtiquetaPrioridade,
  EtiquetaSetor,
  EtiquetaStatus,
  EtiquetaTeste,
  ICONE_CATEGORIA,
  LinhaDoTempo,
  Responsavel,
  ROTULO_CATEGORIA,
  ROTULO_STATUS,
  quando,
} from '../components/chamados-comuns';
import { Icone } from '../lib/icones';

const PROXIMOS_STATUS: StatusChamado[] = ['ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO'];

/**
 * Fila do TI: todos os chamados, com a conversa e o andamento.
 *
 * `meuId` é quem está usando a tela — serve para saber se o chamado já é meu
 * ou se está com outra pessoa, que é quando aparece o botão de assumir.
 */
export function FilaChamadosPage({ meuId }: { meuId: string | null }) {
  const [chamados, setChamados] = useState<ChamadoResumo[]>([]);
  const [aberto, setAberto] = useState<ChamadoCompleto | null>(null);
  const [encerrados, setEncerrados] = useState(false);
  const [resposta, setResposta] = useState('');
  const [aviso, setAviso] = useState('');
  const [aceitando, setAceitando] = useState(false);
  /** Apagar e assumir pedem confirmação no próprio botão, sem caixa do Windows */
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [confirmandoAssumir, setConfirmandoAssumir] = useState(false);

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
    setConfirmandoApagar(false);
    setConfirmandoAssumir(false);
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

  /**
   * Pegar o chamado para si.
   *
   * Sem `assumir`, o servidor recusa quando já tem outra pessoa cuidando — é a
   * proteção contra o clique sem querer. Com `assumir`, a troca acontece e fica
   * registrada numa nota interna.
   */
  async function aceitar(assumir = false) {
    if (!aberto || aceitando) return;
    setAceitando(true);
    setAviso('');
    const resultado = await window.dp.adminAceitarChamado(aberto.id, assumir);
    setAceitando(false);
    setConfirmandoAssumir(false);
    if (!resultado.ok) setAviso(resultado.message);
    await abrirDetalhe(aberto.id);
  }

  /** Some de vez com um chamado de teste (os de verdade não oferecem o botão). */
  async function apagar() {
    if (!aberto) return;
    const resultado = await window.dp.adminApagarChamado(aberto.id);
    setConfirmandoApagar(false);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setAberto(null);
    await carregar();
  }

  // Chamado sem dono primeiro: é o que o time precisa ver para alguém pegar.
  // Os de teste vão para o fim: não são pedido de ninguém.
  const ordenados = [...chamados].sort((a, b) => {
    if (a.teste !== b.teste) return a.teste ? 1 : -1;
    const livreA = a.responsavelId === null ? 0 : 1;
    const livreB = b.responsavelId === null ? 0 : 1;
    if (livreA !== livreB) return livreA - livreB;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const livres = ordenados.filter((c) => c.responsavelId === null && c.status !== 'FECHADO' && !c.teste).length;

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
        <div className="fila__ferramentas">
          {/* O número que decide o dia do TI fica em destaque, não escondido na linha de apoio */}
          {livres > 0 && (
            <span className="fila__contador">
              <Icone nome="aceitar" tamanho={15} />
              {livres} {livres === 1 ? 'chamado esperando' : 'chamados esperando'} alguém aceitar
            </span>
          )}
          <label className="caixa">
            <input type="checkbox" checked={encerrados} onChange={(evento) => setEncerrados(evento.target.checked)} />
            mostrar encerrados
          </label>
        </div>
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      <div className="fila">
        <div className="fila__lista">
          {ordenados.length === 0 ? (
            <p className="fila__vazio">
              <Icone nome="vazio" tamanho={26} /> Nenhum chamado por aqui.
            </p>
          ) : (
            ordenados.map((chamado) => {
              const livre = chamado.responsavelId === null && chamado.status !== 'FECHADO';
              const meu = chamado.responsavelId !== null && chamado.responsavelId === meuId;
              return (
                <button
                  key={chamado.id}
                  className={`chamado-item ${aberto?.id === chamado.id ? 'chamado-item--ativo' : ''} ${
                    livre && !chamado.teste ? 'chamado-item--livre' : ''
                  } ${meu ? 'chamado-item--meu' : ''} ${chamado.teste ? 'chamado-item--teste' : ''}`}
                  onClick={() => void abrirDetalhe(chamado.id)}
                >
                  {/* Coluna fixa: o ícone e o número ocupam a mesma largura em todos
                      os itens, então os títulos começam todos na mesma linha vertical */}
                  <span className="chamado-item__coluna">
                    <span className="chamado-item__icone" aria-hidden>
                      <Icone nome={ICONE_CATEGORIA[chamado.categoria]} tamanho={20} />
                    </span>
                    <span className="chamado-item__numero">#{chamado.numero}</span>
                  </span>

                  <span className="chamado-item__texto">
                    <strong className="chamado-item__titulo">{chamado.titulo}</strong>
                    {/* Quem pediu e de onde: o setor é o que diz para onde o TI vai */}
                    <span className="chamado-item__quem">
                      <EtiquetaSetor setor={chamado.solicitanteSetor} />
                      <span className="chamado-item__nome">{chamado.solicitanteNome}</span>
                    </span>
                    <span className="chamado-item__detalhe">
                      {ROTULO_CATEGORIA[chamado.categoria]} · {quando(chamado.createdAt)}
                    </span>
                  </span>

                  <span className="chamado-item__lado">
                    <EtiquetaStatus status={chamado.status} />
                    <EtiquetaPrioridade prioridade={chamado.prioridade} />
                    {chamado.teste && <EtiquetaTeste />}
                    {chamado.mensagensNaoLidas > 0 && (
                      <span className="chamado-item__badge" title="Mensagens novas do solicitante">
                        {chamado.mensagensNaoLidas}
                      </span>
                    )}
                  </span>

                  {/* Rodapé separado: quem está atendendo é a resposta que o TI
                      procura em cada linha, e sozinha numa faixa ela se lê de relance */}
                  <span className="chamado-item__rodape">
                    <Responsavel nome={chamado.responsavelNome} />
                    {livre && !chamado.teste && <span className="chamado-item__pegar">abrir para aceitar</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="fila__detalhe">
          {!aberto ? (
            <p className="fila__nada">
              <Icone nome="fila" tamanho={30} />
              Escolha um chamado na lista para ver os detalhes.
            </p>
          ) : (
            <>
              <header className="fila__titulo">
                <span className="fila__titulo-icone" aria-hidden>
                  <Icone nome={ICONE_CATEGORIA[aberto.categoria]} tamanho={22} />
                </span>
                <span className="fila__titulo-texto">
                  <h2>
                    <span className="fila__numero">#{aberto.numero}</span> {aberto.titulo}
                  </h2>
                  {/* Dois grupos: quem pediu e os dados do chamado. Quando o painel
                      fica estreito eles viram duas linhas, e os pontos de separação
                      somem — soltos no fim da linha pareciam erro de digitação. */}
                  <p className="fila__identificacao">
                    <span className="fila__quem">
                      <EtiquetaSetor setor={aberto.solicitanteSetor} />
                      <span>{aberto.solicitanteNome}</span>
                    </span>
                    <span className="fila__fatos">
                      <span>{ROTULO_CATEGORIA[aberto.categoria]}</span>
                      <span className="fila__ponto">·</span>
                      <span>aberto em {quando(aberto.createdAt)}</span>
                      {aberto.computadorId && (
                        <>
                          <span className="fila__ponto">·</span>
                          <span>PC {aberto.computadorId}</span>
                        </>
                      )}
                    </span>
                  </p>
                </span>
                <span className="fila__marcas">
                  {aberto.teste && <EtiquetaTeste />}
                  <EtiquetaPrioridade prioridade={aberto.prioridade} />
                  <EtiquetaStatus status={aberto.status} />
                </span>
              </header>

              {/* Sem dono: a ação principal é pegar o chamado, antes de qualquer outra */}
              {aberto.responsavelId === null && aberto.status !== 'FECHADO' ? (
                <div className="cartao aceitar-chamado">
                  <div>
                    <strong>Este chamado ainda não tem responsável.</strong>
                    <p>Ao aceitar, seu nome aparece para {aberto.solicitanteNome} e para o resto do TI.</p>
                  </div>
                  <button className="botao botao--primario" onClick={() => void aceitar(false)} disabled={aceitando}>
                    <Icone nome="aceitar" tamanho={17} /> {aceitando ? 'Aceitando…' : 'Aceitar chamado'}
                  </button>
                </div>
              ) : (
                <div className="cartao chamado__andamento">
                  <LinhaDoTempo status={aberto.status} responsavelNome={aberto.responsavelNome} />
                  <div className="chamado__cabecalho">
                    <Responsavel nome={aberto.responsavelNome} />
                    {/* Está com outra pessoa do TI: dá para puxar para si, de propósito */}
                    {aberto.responsavelId !== null && aberto.responsavelId !== meuId && aberto.status !== 'FECHADO' ? (
                      confirmandoAssumir ? (
                        <span className="assumir">
                          <span>Passar para você? {aberto.responsavelNome} deixa de ser responsável.</span>
                          <button className="botao botao--pequeno" onClick={() => setConfirmandoAssumir(false)}>
                            Cancelar
                          </button>
                          <button
                            className="botao botao--primario botao--pequeno"
                            onClick={() => void aceitar(true)}
                            disabled={aceitando}
                          >
                            {aceitando ? 'Assumindo…' : 'Assumir'}
                          </button>
                        </span>
                      ) : (
                        <button className="botao botao--pequeno" onClick={() => setConfirmandoAssumir(true)}>
                          <Icone nome="aceitar" tamanho={15} /> Assumir o chamado
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              )}

              <section className="bloco">
                <h3 className="bloco__titulo">
                  <Icone nome="ampulheta" tamanho={14} /> Situação
                </h3>
                <div className="segmentado" role="group" aria-label="Mudar a situação do chamado">
                  {PROXIMOS_STATUS.map((status) => (
                    <button
                      key={status}
                      className={`botao ${aberto.status === status ? 'botao--atual' : ''}`}
                      onClick={() => void mudarStatus(status)}
                      disabled={aberto.status === status}
                    >
                      {ROTULO_STATUS[status]}
                    </button>
                  ))}
                </div>
              </section>

              <section className="bloco">
                <h3 className="bloco__titulo">
                  <Icone nome="arquivo" tamanho={14} /> O que a pessoa escreveu
                </h3>
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
              </section>

              {/* Entre a descrição e a conversa: é aqui que o TI olha antes de
                  continuar um atendimento que outra pessoa começou */}
              <NotasDoTi
                notas={aberto.notas}
                onAnotar={async (conteudo) => {
                  const resultado = await window.dp.adminAnotarChamado(aberto.id, conteudo);
                  if (!resultado.ok) {
                    setAviso(resultado.message);
                    return false;
                  }
                  await abrirDetalhe(aberto.id);
                  return true;
                }}
              />

              <section className="bloco">
                <h3 className="bloco__titulo">
                  <Icone nome="mensagens" tamanho={14} /> Conversa com {aberto.solicitanteNome.split(' ')[0]}
                </h3>
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
              </section>

              {/* Só os de teste somem de vez: chamado de gente de verdade fica no histórico */}
              {aberto.teste && (
                <div className="fila__apagar">
                  {confirmandoApagar ? (
                    <>
                      <span>Apagar o chamado #{aberto.numero} de vez? Não dá para desfazer.</span>
                      <button className="botao botao--pequeno" onClick={() => setConfirmandoApagar(false)}>
                        Cancelar
                      </button>
                      <button className="botao botao--perigo botao--pequeno" onClick={() => void apagar()}>
                        Apagar
                      </button>
                    </>
                  ) : (
                    <button className="botao botao--perigo botao--pequeno" onClick={() => setConfirmandoApagar(true)}>
                      <Icone nome="lixeira" tamanho={15} /> Apagar chamado de teste
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Notas internas do TI.
 *
 * Caderninho do time dentro do chamado: o que já foi tentado, o que descobriu,
 * onde parou. Quem abriu o chamado não vê nada disto — nem na tela dele nem na
 * resposta do servidor —, e é por isso que dá para escrever aqui o que não
 * cabe na conversa com a pessoa.
 */
function NotasDoTi({ notas, onAnotar }: { notas: ChamadoNota[]; onAnotar(conteudo: string): Promise<boolean> }) {
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const limpo = texto.trim();
    if (!limpo) return;
    setSalvando(true);
    const deu = await onAnotar(limpo);
    setSalvando(false);
    if (deu) setTexto('');
  }

  return (
    <section className="notas">
      <header className="notas__topo">
        <h3 className="bloco__titulo">
          <Icone nome="lista" tamanho={14} /> Notas do TI
        </h3>
        <span className="notas__aviso">só o TI vê</span>
      </header>

      {notas.length === 0 ? (
        <p className="notas__vazio">
          Nenhuma nota ainda. Escreva aqui o que outra pessoa do TI precisaria saber para continuar.
        </p>
      ) : (
        <ol className="notas__lista">
          {notas.map((nota) => (
            <li key={nota.id} className="nota">
              <span className="nota__cabecalho">
                <strong>{nota.autorNome}</strong> · {quando(nota.createdAt)}
              </span>
              <p className="nota__texto">{nota.conteudo}</p>
            </li>
          ))}
        </ol>
      )}

      <div className="notas__escrever">
        <textarea
          rows={2}
          value={texto}
          maxLength={2000}
          placeholder="Ex.: disco cheio, limpei os temporários. Se voltar, trocar o HD."
          onChange={(evento) => setTexto(evento.target.value)}
        />
        <button className="botao" onClick={() => void salvar()} disabled={salvando || !texto.trim()}>
          {salvando ? 'Salvando…' : 'Guardar nota'}
        </button>
      </div>
    </section>
  );
}
