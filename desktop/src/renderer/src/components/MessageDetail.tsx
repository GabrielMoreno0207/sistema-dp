import { useState } from 'react';
import type { DpMessage } from '../../../shared/types';
import { MESSAGE_TYPE_META } from '../lib/message-meta';
import { MessageAttachments } from './MessageAttachments';
import { Icone } from '../lib/icones';

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
}

/** Selo de destino para mensagens que não são para todos */
const TARGET_LABELS: Record<string, string> = {
  EMPLOYEE: 'Para você',
  SECTOR: 'Para o seu setor',
  SHIFT: 'Para o seu turno',
  COMPUTER: 'Para este computador',
};

export function MessageDetail({ message, onClose }: { message: DpMessage; onClose(): void }) {
  const meta = MESSAGE_TYPE_META[message.type];
  const targetLabel = TARGET_LABELS[message.target];
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmarCiencia(): Promise<void> {
    setConfirmando(true);
    setErro('');
    const resultado = await window.dp.confirmarCiencia(message.id);
    if (!resultado.ok) setErro(resultado.message);
    setConfirmando(false);
  }

  return (
    <article className={`detail tone-${meta.tone}`}>
      <header className="detail__header">
        <span className="detail__tags">
          <span className="detail__type">
            <Icone nome={meta.icone} /> {meta.label}
          </span>
          {targetLabel && <span className="detail__target">{targetLabel}</span>}
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar mensagem" title="Fechar">
          <Icone nome="fechar" />
        </button>
      </header>

      <h2 className="detail__title">{message.title}</h2>
      <p className="detail__meta">
        De <strong>{message.sender}</strong> · {formatFullDate(message.createdAt)}
      </p>

      <div className="detail__content">{message.content}</div>

      <MessageAttachments messageId={message.id} attachments={message.attachments} />

      {message.exigeCiencia && (
        <div className={`ciencia ${message.cienteEm ? 'ciencia--feita' : ''}`}>
          <Icone nome="ciencia" tamanho={20} />
          {message.cienteEm ? (
            <p className="ciencia__texto">
              Você confirmou a ciência em <strong>{formatFullDate(message.cienteEm)}</strong>.
            </p>
          ) : (
            <>
              <p className="ciencia__texto">
                Este comunicado pede confirmação: o DP registra quem leu e está ciente.
              </p>
              <button className="btn btn--primary" onClick={() => void confirmarCiencia()} disabled={confirmando}>
                {confirmando ? 'Confirmando...' : 'Li e estou ciente'}
              </button>
            </>
          )}
        </div>
      )}
      {erro && <p className="form-error">{erro}</p>}

      <footer className="detail__footer">
        <span className="detail__lida">
          {message.readAt ? (
            <>
              <Icone nome="certo" tamanho={14} /> Lida em {formatFullDate(message.readAt)}
            </>
          ) : (
            'Não lida'
          )}
        </span>
        <span className="detail__id">{message.id}</span>
      </footer>
    </article>
  );
}
