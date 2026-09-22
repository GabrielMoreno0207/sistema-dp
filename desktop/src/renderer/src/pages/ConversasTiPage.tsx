import { useCallback, useEffect, useState } from 'react';
import type { AcessoTi, ConversaResumo, MensagemConversa } from '../../../shared/types';
import { Avatar, MensagemDaConversa, dataDoDia, horaDoDia } from '../components/conversa-comuns';
import { Icone } from '../lib/icones';

/**
 * Área do TI: todas as conversas do sistema, em leitura.
 *
 * Foi a condição combinada para liberar o acesso — cada vez que o TI abre uma
 * conversa, o servidor registra quem abriu e quando, e esse registro aparece
 * aqui mesmo, na aba "Acessos".
 */
export function ConversasTiPage() {
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [aberta, setAberta] = useState<ConversaResumo | null>(null);
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const [acessos, setAcessos] = useState<AcessoTi[]>([]);
  const [verAcessos, setVerAcessos] = useState(false);
  const [aviso, setAviso] = useState('');
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const resposta = await window.dp.conversasApi<{ conversas: ConversaResumo[] }>('GET', '/api/admin/conversas');
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setAviso('');
    setConversas(resposta.dados?.conversas ?? []);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function abrir(conversa: ConversaResumo) {
    setAberta(conversa);
    setMensagens([]);
    const resposta = await window.dp.conversasApi<{ mensagens: MensagemConversa[] }>(
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
    const resposta = await window.dp.conversasApi<{ acessos: AcessoTi[] }>('GET', '/api/admin/conversas/acessos');
    if (!resposta.ok) {
      setAviso(resposta.message);
      return;
    }
    setAcessos(resposta.dados?.acessos ?? []);
    setVerAcessos(true);
  }

  async function apagar(conversaId: string) {
    const resposta = await window.dp.conversasApi('DELETE', `/api/admin/conversas/${conversaId}`);
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
                        : 'Conversa direta'}
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
                  <button className="btn btn--sm btn--perigo" onClick={() => setConfirmando(aberta.id)}>
                    Apagar conversa
                  </button>
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
    </div>
  );
}
