import { useEffect, useRef, useState } from 'react';
import type { AvisoMensagem, DpMessage, PopupState } from '../../../shared/types';
import { formatMessageDate, MESSAGE_TYPE_META } from '../lib/message-meta';
import { playAlertSound } from '../lib/sound';

/** URGENTE: o som se repete enquanto o alerta estiver na tela */
const URGENT_REPEAT_MS = 10_000;

/**
 * Alerta no canto da tela, no tamanho de uma notificação, com som.
 *
 * Serve para os comunicados do DP e para as mensagens novas do chat: o formato
 * é o mesmo, muda o conteúdo e o que o botão principal faz (abrir o comunicado
 * ou abrir a conversa).
 */
export function PopupApp() {
  const [state, setState] = useState<PopupState>({ current: null, position: 0, total: 0 });
  const ultimoTocado = useRef<string | null>(null);

  useEffect(() => {
    void window.dpPopup.getPopupState().then(setState);
    return window.dpPopup.onPopupChange(setState);
  }, []);

  const atual = state.current;
  const chave = atual ? (atual.tipo === 'COMUNICADO' ? atual.comunicado.id : atual.mensagem.id) : null;
  const urgente = atual?.tipo === 'COMUNICADO' && atual.comunicado.type === 'URGENTE';

  // Toca o som sempre que um alerta novo aparece
  useEffect(() => {
    if (chave && chave !== ultimoTocado.current) {
      ultimoTocado.current = chave;
      playAlertSound(urgente);
    }
  }, [chave, urgente]);

  const idUrgente = urgente ? chave : null;
  useEffect(() => {
    if (!idUrgente) return;
    const timer = setInterval(() => playAlertSound(true), URGENT_REPEAT_MS);
    return () => clearInterval(timer);
  }, [idUrgente]);

  if (!atual || !chave) return null;

  const temProxima = state.position < state.total;
  const fechar = () => void window.dpPopup.popupDismiss(chave);
  const abrir = () => void window.dpPopup.popupView(chave);

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
      <span className="toast__icon" aria-hidden>
        {meta.icon}
      </span>

      <div className="toast__body">
        <div className="toast__top">
          <span className="toast__kicker">{urgente ? 'URGENTE · DP' : `${meta.label} · DP`}</span>
          <span className="toast__time">{formatMessageDate(comunicado.createdAt)}</span>
          <button className="toast__close" aria-label="Fechar" title="Fechar" onClick={onFechar}>
            ×
          </button>
        </div>

        <strong className="toast__title">{comunicado.title}</strong>
        <p className="toast__content">{comunicado.content}</p>
        {comunicado.attachments.length > 0 && (
          <p className="toast__attachments">
            📎 {comunicado.attachments.length} anexo{comunicado.attachments.length === 1 ? '' : 's'}
          </p>
        )}

        {rodape}
      </div>
    </div>
  );
}

/** "Livia Santos" na conversa direta; "Equipe da expedição · Carlos" no grupo. */
function AlertaMensagem({ aviso, onFechar, rodape }: AlertaProps & { aviso: AvisoMensagem }) {
  return (
    <div className="toast toast--mensagem" key={aviso.id} role="alert">
      <span className="toast__icon" aria-hidden>
        💬
      </span>

      <div className="toast__body">
        <div className="toast__top">
          <span className="toast__kicker">{aviso.grupo ? 'GRUPO' : 'MENSAGEM'}</span>
          <span className="toast__time">{formatMessageDate(aviso.createdAt)}</span>
          <button className="toast__close" aria-label="Fechar" title="Fechar" onClick={onFechar}>
            ×
          </button>
        </div>

        <strong className="toast__title">{aviso.grupo ?? aviso.autorNome}</strong>
        <p className="toast__content">{aviso.grupo ? `${aviso.autorNome}: ${aviso.resumo}` : aviso.resumo}</p>

        {rodape}
      </div>
    </div>
  );
}
