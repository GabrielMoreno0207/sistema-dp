import { useEffect, useRef, useState } from 'react';
import type { AtualizacaoEmAndamento, AvisoMensagem, DpMessage, MuralPost, PopupState } from '../../../shared/types';
import { formatMessageDate, MESSAGE_TYPE_META } from '../lib/message-meta';
import { playAlertSound } from '../lib/sound';
import { Icone } from '../lib/icones';

/** URGENTE: o som se repete enquanto o alerta estiver na tela */
const URGENT_REPEAT_MS = 10_000;

/** Chave do alerta à vista (a mesma que o processo principal usa na fila) */
function chaveDo(item: PopupState['current']): string | null {
  if (!item) return null;
  if (item.tipo === 'COMUNICADO') return item.comunicado.id;
  if (item.tipo === 'MENSAGEM') return item.mensagem.id;
  if (item.tipo === 'MURAL') return `mural:${item.post.id}:${item.post.updatedAt}`;
  return 'atualizacao';
}

/**
 * Alerta no canto da tela, no tamanho de uma notificação, com som.
 *
 * Serve para os comunicados do DP, para as mensagens novas do chat e para o
 * aviso da atualização: o formato é o mesmo, muda o conteúdo e o que o botão
 * principal faz (abrir o comunicado, abrir a conversa ou nada).
 */
export function PopupApp() {
  const [state, setState] = useState<PopupState>({ current: null, position: 0, total: 0 });
  const ultimoTocado = useRef<string | null>(null);

  useEffect(() => {
    void window.dpPopup.getPopupState().then(setState);
    return window.dpPopup.onPopupChange(setState);
  }, []);

  /**
   * A janela acompanha a altura do cartão.
   *
   * Com altura fixa, comunicado com anexo e pedido de ciência não cabia: o
   * título aparecia cortado ao meio e a descrição com a última linha pela
   * metade. Aqui o cartão cresce com o que tem dentro e o processo principal
   * recebe a medida — inclusive quando a fonte termina de carregar e quando o
   * alerta da vez troca, que é o que o ResizeObserver pega.
   */
  useEffect(() => {
    const raiz = document.getElementById('root');
    if (!raiz) return;
    const avisar = () => window.dpPopup.popupAltura(Math.ceil(raiz.getBoundingClientRect().height));
    const observador = new ResizeObserver(avisar);
    observador.observe(raiz);
    avisar();
    return () => observador.disconnect();
  }, []);

  const atual = state.current;
  const chave = chaveDo(atual);
  const urgente = atual?.tipo === 'COMUNICADO' && atual.comunicado.type === 'URGENTE';
  // A atualização não toca som: ninguém precisa ser interrompido por ela
  const comSom = atual !== null && atual.tipo !== 'ATUALIZACAO';

  // Toca o som sempre que um alerta novo aparece
  useEffect(() => {
    if (chave && chave !== ultimoTocado.current) {
      ultimoTocado.current = chave;
      if (comSom) playAlertSound(urgente);
    }
  }, [chave, urgente, comSom]);

  const idUrgente = urgente ? chave : null;
  useEffect(() => {
    if (!idUrgente) return;
    const timer = setInterval(() => playAlertSound(true), URGENT_REPEAT_MS);
    return () => clearInterval(timer);
  }, [idUrgente]);

  if (!atual || !chave) return null;

  const temProxima = state.position < state.total;

  /**
   * Clique que não volta resposta não pode deixar o alerta parado na tela:
   * fechar a janela é o último recurso (o processo principal trata o fechamento
   * como "dispensar", sem perder o resto da fila).
   */
  async function acionar(acao: (id: string) => Promise<void>, id: string): Promise<void> {
    try {
      await acao(id);
    } catch (err) {
      console.error('[alerta] o clique não foi atendido:', err);
      window.close();
    }
  }

  const fechar = () => void acionar(window.dpPopup.popupDismiss, chave);
  const abrir = () => void acionar(window.dpPopup.popupView, chave);

  // Atualização: não há o que abrir nem fila para andar, só tirar da frente
  if (atual.tipo === 'ATUALIZACAO') return <AlertaAtualizacao info={atual.info} onFechar={fechar} />;

  const rodape = (
    <div className="toast__actions">
      {state.total > 1 && (
        <span className="toast__counter">
          {state.position} de {state.total}
        </span>
      )}
      <button className="btn btn--ghost" onClick={fechar}>
        {temProxima ? 'Próxima' : 'Fechar'}
      </button>
      <button className="btn btn--primary" onClick={abrir}>
        {atual.tipo === 'MENSAGEM' ? 'Responder' : 'Visualizar'}
      </button>
    </div>
  );

  if (atual.tipo === 'MENSAGEM') return <AlertaMensagem aviso={atual.mensagem} onFechar={fechar} rodape={rodape} />;
  if (atual.tipo === 'MURAL') return <AlertaMural post={atual.post} onFechar={fechar} rodape={rodape} />;
  return <AlertaComunicado comunicado={atual.comunicado} onFechar={fechar} rodape={rodape} />;
}

interface AlertaProps {
  onFechar(): void;
  rodape: React.ReactNode;
}

function AlertaComunicado({ comunicado, onFechar, rodape }: AlertaProps & { comunicado: DpMessage }) {
  const meta = MESSAGE_TYPE_META[comunicado.type];
  const urgente = comunicado.type === 'URGENTE';

  return (
    <div className={`toast toast--${meta.tone}`} key={comunicado.id} role="alert">
      <span className="toast__icon">
        <Icone nome={meta.icone} />
      </span>

      <div className="toast__body">
        <div className="toast__top">
          <span className="toast__kicker">{urgente ? 'URGENTE · RH' : `${meta.label} · RH`}</span>
          <span className="toast__time">{formatMessageDate(comunicado.createdAt)}</span>
          <button className="toast__close" aria-label="Fechar" title="Fechar" onClick={onFechar}>
            <Icone nome="fechar" tamanho={14} />
          </button>
        </div>

        <strong className="toast__title">{comunicado.title}</strong>
        <p className="toast__content">{comunicado.content}</p>
        {comunicado.attachments.length > 0 && (
          <p className="toast__attachments">
            <Icone nome="anexo" /> {comunicado.attachments.length} anexo{comunicado.attachments.length === 1 ? '' : 's'}
          </p>
        )}
        {comunicado.exigeCiencia && !comunicado.cienteEm && (
          <p className="toast__ciencia">
            <Icone nome="ciencia" tamanho={13} /> Abra o comunicado para confirmar que leu
          </p>
        )}

        {rodape}
      </div>
    </div>
  );
}

/**
 * Mural novo ou alterado. Formato de comunicado, porque é o que ele é para quem
 * recebe: o recado mudou e vale a pena olhar. "Visualizar" leva à tela inicial.
 */
function AlertaMural({ post, onFechar, rodape }: AlertaProps & { post: MuralPost }) {
  return (
    <div className="toast toast--mural" key={post.id} role="alert">
      <span className="toast__icon">
        <Icone nome="mural" />
      </span>

      <div className="toast__body">
        <div className="toast__top">
          <span className="toast__kicker">Mural · RH</span>
          <span className="toast__time">{formatMessageDate(post.updatedAt || post.createdAt)}</span>
          <button className="toast__close" aria-label="Fechar" title="Fechar" onClick={onFechar}>
            <Icone nome="fechar" tamanho={14} />
          </button>
        </div>

        <strong className="toast__title">Conteúdo do Mural atualizado</strong>
        <p className="toast__content">{post.titulo}</p>

        {rodape}
      </div>
    </div>
  );
}

/** "Livia Santos" na conversa direta; "Equipe da expedição · Carlos" no grupo. */
function AlertaMensagem({ aviso, onFechar, rodape }: AlertaProps & { aviso: AvisoMensagem }) {
  return (
    <div className="toast toast--mensagem" key={aviso.id} role="alert">
      <span className="toast__icon">
        <Icone nome="mensagens" />
      </span>

      <div className="toast__body">
        <div className="toast__top">
          <span className="toast__kicker">{aviso.grupo ? 'GRUPO' : 'MENSAGEM'}</span>
          <span className="toast__time">{formatMessageDate(aviso.createdAt)}</span>
          <button className="toast__close" aria-label="Fechar" title="Fechar" onClick={onFechar}>
            <Icone nome="fechar" tamanho={14} />
          </button>
        </div>

        <strong className="toast__title">{aviso.grupo ?? aviso.autorNome}</strong>
        <p className="toast__content">{aviso.grupo ? `${aviso.autorNome}: ${aviso.resumo}` : aviso.resumo}</p>

        {rodape}
      </div>
    </div>
  );
}

/**
 * Aviso de que a versão nova está sendo instalada.
 *
 * Ficava numa tela preta por cima de tudo, no meio da janela: quem estava
 * trabalhando levava um susto e perdia o que tinha à frente. Virou alerta de
 * canto, igual aos outros, porque não há nada a decidir aqui — só saber que o
 * aplicativo vai sumir por um minuto e voltar.
 */
function AlertaAtualizacao({ info, onFechar }: { info: AtualizacaoEmAndamento; onFechar(): void }) {
  return (
    <div className="toast toast--atualizacao" role="alert">
      <span className="toast__icon">
        <Icone nome="atualizar" />
      </span>

      <div className="toast__body">
        <div className="toast__top">
          <span className="toast__kicker">Atualização do sistema</span>
          <span className="toast__time">versão {info.versao}</span>
          <button className="toast__close" aria-label="Fechar" title="Fechar" onClick={onFechar}>
            <Icone nome="fechar" tamanho={14} />
          </button>
        </div>

        <strong className="toast__title">O Comunica Trinys vai reabrir</strong>
        <p className="toast__content">
          Ele fecha e abre sozinho para instalar a versão nova. Leva menos de um minuto.
        </p>
        <p className="toast__dica">Se não voltar sozinho, abra pelo ícone da área de trabalho.</p>

        <div className="toast__actions">
          <button className="btn btn--ghost" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
