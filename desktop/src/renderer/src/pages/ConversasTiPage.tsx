import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AcessoTi, ConversaResumo, ExclusaoTi, MensagemConversa } from '../../../shared/types';
import { Avatar, MensagemDaConversa, dataDoDia, horaDoDia, setorDaPessoa } from '../components/conversa-comuns';
import { Icone } from '../lib/icones';

/**
 * Área do TI: todas as conversas do sistema, em leitura.
 *
 * Foi a condição combinada para liberar o acesso — cada vez que o TI abre uma
 * conversa, o servidor registra quem abriu e quando, e esse registro aparece
 * aqui mesmo, na aba "Acessos".
 *
 * A conta do TI abre a tela, mas não as conversas: antes de qualquer leitura a
 * tela pede a senha do TI (a mesma que encerra o aplicativo). O servidor é que
 * confere e libera, por meia hora e só para esta sessão — deixar o aplicativo
 * aberto com a conta do TI não entrega as conversas a quem passar na máquina.
 */
export function ConversasTiPage() {
  const [liberado, setLiberado] = useState(false);
  const [senha, setSenha] = useState('');
  const [conferindo, setConferindo] = useState(false);
  const [erroSenha, setErroSenha] = useState('');
  const [valeAte, setValeAte] = useState('');
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [aberta, setAberta] = useState<ConversaResumo | null>(null);
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const [acessos, setAcessos] = useState<AcessoTi[]>([]);
  const [verAcessos, setVerAcessos] = useState(false);
  const [exclusoes, setExclusoes] = useState<ExclusaoTi[]>([]);
  const [verExclusoes, setVerExclusoes] = useState(false);
  const [aviso, setAviso] = useState('');
  const [baixando, setBaixando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  /** Volta a pedir a senha e tira da tela o que já tinha sido lido. */
  const trancar = useCallback((motivo: string) => {
    setLiberado(false);
    setValeAte('');
    setConversas([]);
    setAberta(null);
    setMensagens([]);
    setAcessos([]);
    setExclusoes([]);
    setVerAcessos(false);
    setVerExclusoes(false);
    setConfirmando(null);
    setAviso('');
    setErroSenha(motivo);
  }, []);

  /** Chamada da área do TI: 423 = a liberação venceu, a tela pede a senha de novo. */
  const pedir = useCallback(
    async function <T>(metodo: 'GET' | 'DELETE', caminho: string) {
      const resposta = await window.dp.conversasApi<T>(metodo, caminho);
      if (!resposta.ok && resposta.status === 423) {
        trancar('A liberação venceu. Digite a senha do TI de novo para continuar.');
      }
      return resposta;
    },
    [trancar],
  );

  const carregar = useCallback(async () => {
    const resposta = await pedir<{ conversas: ConversaResumo[] }>('GET', '/api/admin/conversas');
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setAviso('');
    setConversas(resposta.dados?.conversas ?? []);
  }, [pedir]);

  // A lista só é buscada depois da senha: sem ela o servidor responderia 423
  useEffect(() => {
    if (liberado) void carregar();
  }, [carregar, liberado]);

  // Sair da tela tranca de novo no servidor: a liberação não fica valendo sozinha
  useEffect(
    () => () => {
      void window.dp.conversasApi('DELETE', '/api/admin/conversas/liberar');
    },
    [],
  );

  // A liberação vence sozinha: a tela acompanha e pede a senha na hora certa
  useEffect(() => {
    if (!valeAte) return;
    const restante = new Date(valeAte).getTime() - Date.now();
    if (restante <= 0) {
      trancar('A liberação venceu. Digite a senha do TI de novo para continuar.');
      return;
    }
    const relogio = setTimeout(
      () => trancar('A liberação venceu. Digite a senha do TI de novo para continuar.'),
      restante,
    );
    return () => clearTimeout(relogio);
  }, [valeAte, trancar]);

  async function destrancar(evento: FormEvent) {
    evento.preventDefault();
    if (!senha || conferindo) return;
    setConferindo(true);
    setErroSenha('');
    const resposta = await window.dp.conversasApi<{ validoAte: string }>('POST', '/api/admin/conversas/liberar', {
      senha,
    });
    setConferindo(false);
    setSenha('');
    if (!resposta.ok) {
      setErroSenha(resposta.message || 'Senha do TI incorreta.');
      return;
    }
    setValeAte(resposta.dados?.validoAte ?? '');
    setLiberado(true);
  }

  async function trancarAgora() {
    await window.dp.conversasApi('DELETE', '/api/admin/conversas/liberar');
    trancar('Área trancada. Digite a senha do TI para abrir de novo.');
  }

  async function abrir(conversa: ConversaResumo) {
    setAberta(conversa);
    setMensagens([]);
    const resposta = await pedir<{ mensagens: MensagemConversa[] }>(
      'GET',
      `/api/admin/conversas/${conversa.id}/mensagens`,
    );
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setMensagens(resposta.dados?.mensagens ?? []);
  }

  async function verRegistro() {
    const resposta = await pedir<{ acessos: AcessoTi[] }>('GET', '/api/admin/conversas/acessos');
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setAcessos(resposta.dados?.acessos ?? []);
    setVerAcessos(true);
  }

  async function verExclusoesRegistradas() {
    const resposta = await pedir<{ apagadas: ExclusaoTi[] }>('GET', '/api/admin/conversas/apagadas');
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setExclusoes(resposta.dados?.apagadas ?? []);
    setVerExclusoes(true);
  }

  /**
   * Baixa a conversa inteira, com as mensagens apagadas. O servidor monta o
   * arquivo (e registra o acesso) e o aplicativo abre a janela de salvar.
   */
  async function baixar(conversa: ConversaResumo) {
    setBaixando(true);
    const resposta = await pedir<{ nome: string; html: string }>('GET', `/api/admin/conversas/${conversa.id}/exportar`);
    if (!resposta.ok || !resposta.dados) {
      setBaixando(false);
      setAviso(resposta.message || 'Não foi possível montar o arquivo da conversa.');
      return;
    }
    const salvo = await window.dp.conversasSalvarArquivo(resposta.dados.nome, resposta.dados.html);
    setBaixando(false);
    // Cancelou a janela de salvar: a mensagem vem vazia de propósito
    if (salvo.message) setAviso(salvo.message);
  }

  async function apagar(conversaId: string) {
    const resposta = await pedir('DELETE', `/api/admin/conversas/${conversaId}`);
    setConfirmando(null);
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    if (aberta?.id === conversaId) {
      setAberta(null);
      setMensagens([]);
    }
    setAviso('Conversa apagada.');
    await carregar();
  }

  // Trancada: nada é buscado do servidor até a senha ser conferida
  if (!liberado) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1>Conversas (TI)</h1>
            <p className="page__subtitle">Área protegida: as conversas só abrem com a senha do TI.</p>
          </div>
        </header>

        <form className="tranca-ti" onSubmit={(e) => void destrancar(e)}>
          <span className="tranca-ti__icone">
            <Icone nome="auditoria" tamanho={26} />
          </span>
          <p className="tranca-ti__texto">
            Ler a conversa de um funcionário pede a <strong>senha do TI</strong> — a mesma que encerra o aplicativo.
            A liberação vale 30 minutos nesta máquina e cada leitura continua ficando registrada com o seu nome.
          </p>

          <label className="field field--spaced">
            <span>Senha do TI</span>
            <input
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              maxLength={128}
              autoFocus
              autoComplete="current-password"
            />
          </label>

          {erroSenha && <p className="feedback feedback--error">{erroSenha}</p>}

          <button type="submit" className="btn btn--primary" disabled={!senha || conferindo}>
            {conferindo ? 'Conferindo...' : 'Destrancar'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Conversas (TI)</h1>
          <p className="page__subtitle">
            Todas as conversas do sistema. Cada leitura fica registrada com o seu nome e a data.
          </p>
        </div>
        <div className="page__acoes">
          <button className="btn btn--sm" onClick={() => void carregar()}>
            Atualizar
          </button>
          <button className="btn btn--sm" onClick={() => void verRegistro()}>
            Acessos
          </button>
          <button className="btn btn--sm" onClick={() => void verExclusoesRegistradas()}>
            Apagadas
          </button>
          <button
            className="btn btn--sm"
            onClick={() => void trancarAgora()}
            title="Fecha a área: a próxima leitura pede a senha do TI de novo"
          >
            Trancar
          </button>
        </div>
      </header>

      {aviso && <p className="feedback">{aviso}</p>}

      <div className="chat-layout chat-layout--ti">
        <aside className="contacts">
          <ul className="contacts__list">
            {conversas.length === 0 && (
              <li className="escolha-pessoas__vazio">Nenhuma conversa registrada até agora.</li>
            )}
            {conversas.map((conversa) => (
              <li key={conversa.id}>
                <button
                  className={`contact ${conversa.id === aberta?.id ? 'contact--active' : ''}`}
                  onClick={() => void abrir(conversa)}
                >
                  <Avatar
                    nome={conversa.participantes[0]?.nome ?? '?'}
                    fotoMidiaId={conversa.participantes[0]?.fotoMidiaId}
                    grupo={conversa.tipo === 'GRUPO'}
                  />
                  <span className="contact__main">
                    <span className="contact__top">
                      <span className="contact__name">
                        {conversa.tipo === 'GRUPO'
                          ? (conversa.nome ?? 'Grupo')
                          : conversa.participantes.map((p) => p.nome).join(' e ')}
                      </span>
                      <span className="contact__time">{dataDoDia(conversa.updatedAt)}</span>
                    </span>
                    <span className="contact__preview">
                      {conversa.tipo === 'GRUPO'
                        ? `${conversa.participantes.length} participantes`
                        : // Os setores dos dois lados: os nomes nem sempre dizem de onde cada um é
                          conversa.participantes.map(setorDaPessoa).join(' e ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="chat">
          {!aberta ? (
            <div className="empty-state empty-state--detail">
              <Icone nome="auditoria" tamanho={28} />
              <p>Escolha uma conversa para ler. A abertura fica registrada.</p>
            </div>
          ) : (
            <>
              <header className="chat__header">
                <div className="chat__header-texto">
                  <h1>
                    {aberta.tipo === 'GRUPO'
                      ? (aberta.nome ?? 'Grupo')
                      : aberta.participantes.map((p) => p.nome).join(' e ')}
                  </h1>
                  <p className="page__subtitle">
                    {aberta.participantes.map((p) => p.nome).join(', ')} · criada em{' '}
                    {new Date(aberta.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                {confirmando === aberta.id ? (
                  <>
                    <button className="btn btn--sm btn--perigo" onClick={() => void apagar(aberta.id)}>
                      Confirmar exclusão
                    </button>
                    <button className="btn btn--sm" onClick={() => setConfirmando(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn--sm btn--primary"
                      onClick={() => void baixar(aberta)}
                      disabled={baixando}
                      title="Arquivo HTML com a conversa inteira, inclusive o que foi apagado"
                    >
                      {baixando ? 'Montando...' : 'Baixar conversa'}
                    </button>
                    <button className="btn btn--sm btn--perigo" onClick={() => setConfirmando(aberta.id)}>
                      Apagar conversa
                    </button>
                  </>
                )}
              </header>

              <div className="chat__messages">
                {mensagens.length === 0 && (
                  <div className="empty-state">
                    <Icone nome="mensagens" tamanho={28} />
                    <p>Sem mensagens nesta conversa.</p>
                  </div>
                )}
                {mensagens.map((mensagem) => (
                  <MensagemDaConversa
                    key={mensagem.id}
                    mensagem={mensagem}
                    minha={false}
                    emGrupo
                    onErro={setAviso}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {verAcessos && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__caixa">
            <h2 className="modal__titulo">Leituras feitas pelo TI</h2>
            <ul className="grupo__lista">
              {acessos.length === 0 && <li className="escolha-pessoas__vazio">Nenhuma leitura registrada.</li>}
              {acessos.map((acesso, indice) => (
                <li key={`${acesso.conversaId}-${indice}`} className="grupo__pessoa">
                  <span className="escolha-pessoa__texto">
                    <strong>{acesso.usuarioNome}</strong>
                    <small>
                      {acesso.conversaId} · {new Date(acesso.createdAt).toLocaleDateString('pt-BR')} às{' '}
                      {horaDoDia(acesso.createdAt)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            <div className="modal__rodape">
              <span className="modal__espaco" />
              <button className="btn" onClick={() => setVerAcessos(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {verExclusoes && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__caixa">
            <h2 className="modal__titulo">Mensagens apagadas</h2>
            <p className="page__subtitle">
              Quem apagou, quando e com quem estava conversando. O texto está no arquivo da conversa: abra a conversa e
              use <strong>Baixar conversa</strong>.
            </p>
            <ul className="grupo__lista">
              {exclusoes.length === 0 && <li className="escolha-pessoas__vazio">Nenhuma mensagem apagada até agora.</li>}
              {exclusoes.map((exclusao) => (
                <li key={exclusao.mensagemId} className="grupo__pessoa">
                  <span className="escolha-pessoa__texto">
                    <strong>
                      {exclusao.apagadaPorOutro
                        ? `${exclusao.apagadaPorNome ?? 'TI'} apagou uma mensagem de ${exclusao.autorNome}`
                        : `${exclusao.autorNome} apagou uma mensagem`}
                    </strong>
                    <small>
                      {new Date(exclusao.apagadaEm).toLocaleDateString('pt-BR')} às {horaDoDia(exclusao.apagadaEm)} ·{' '}
                      {exclusao.comQuem}
                      {' · '}
                      {/* Sem texto guardado = apagada antes desta versão */}
                      {exclusao.temTexto ? 'texto guardado' : 'sem texto guardado'}
                      {exclusao.temAnexo && ' · com anexo'}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
            <div className="modal__rodape">
              <span className="modal__espaco" />
              <button className="btn" onClick={() => setVerExclusoes(false)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
