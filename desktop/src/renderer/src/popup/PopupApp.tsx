import { useEffect, useRef, useState } from 'react';
import type { PopupState } from '../../../shared/types';
import { formatMessageDate, MESSAGE_TYPE_META } from '../lib/message-meta';
import { playAlertSound } from '../lib/sound';

/** URGENTE: o som se repete enquanto o alerta estiver na tela */
const URGENT_REPEAT_MS = 10_000;

/**
 * Alerta de nova mensagem, no tamanho de uma notificação, com som.
 * Fica visível até o funcionário clicar em "Visualizar" ou "Fechar".
 */
export function PopupApp() {
  const [state, setState] = useState<PopupState>({ current: null, position: 0, total: 0 });
  const lastAlerted = useRef<string | null>(null);

  useEffect(() => {
    void window.dpPopup.getPopupState().then(setState);
    return window.dpPopup.onPopupChange(setState);
  }, []);

  // Toca o som sempre que uma mensagem nova aparece no popup
  const current = state.current;
  useEffect(() => {
    if (current && current.id !== lastAlerted.current) {
      lastAlerted.current = current.id;
      playAlertSound(current.type === 'URGENTE');
    }
  }, [current]);

  const urgentId = current?.type === 'URGENTE' ? current.id : null;
  useEffect(() => {
    if (!urgentId) return;
    const timer = setInterval(() => playAlertSound(true), URGENT_REPEAT_MS);
    return () => clearInterval(timer);
  }, [urgentId]);

  if (!current) return null;
  const meta = MESSAGE_TYPE_META[current.type];
  const urgent = current.type === 'URGENTE';
  const hasNext = state.position < state.total;
  const dismiss = () => void window.dpPopup.popupDismiss(current.id);

  return (
    <div className={`toast toast--${meta.tone}`} key={current.id} role="alert">
      <span className="toast__icon" aria-hidden>
        {meta.icon}
      </span>

      <div className="toast__body">
        <div className="toast__top">
          <span className="toast__kicker">{urgent ? 'URGENTE · DP' : `${meta.label} · DP`}</span>
          <span className="toast__time">{formatMessageDate(current.createdAt)}</span>
          <button className="toast__close" aria-label="Fechar" title="Fechar" onClick={dismiss}>
            ×
          </button>
        </div>

        <strong className="toast__title">{current.title}</strong>
        <p className="toast__content">{current.content}</p>
        {current.attachments.length > 0 && (
          <p className="toast__attachments">
            📎 {current.attachments.length} anexo{current.attachments.length === 1 ? '' : 's'}
          </p>
        )}

        <div className="toast__actions">
          {state.total > 1 && (
            <span className="toast__counter">
              {state.position} de {state.total}
            </span>
          )}
          <button className="btn btn--ghost" onClick={dismiss}>
            {hasNext ? 'Próxima' : 'Fechar'}
          </button>
          <button className="btn btn--primary" onClick={() => void window.dpPopup.popupView(current.id)}>
            Visualizar
          </button>
        </div>
      </div>
    </div>
  );
}
