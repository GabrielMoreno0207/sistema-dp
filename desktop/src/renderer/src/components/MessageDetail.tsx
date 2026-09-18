import type { DpMessage } from '../../../shared/types';
import { MESSAGE_TYPE_META } from '../lib/message-meta';
import { MessageAttachments } from './MessageAttachments';

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

  return (
    <article className={`detail tone-${meta.tone}`}>
      <header className="detail__header">
        <span className="detail__tags">
          <span className="detail__type">
            {meta.icon} {meta.label}
          </span>
          {targetLabel && <span className="detail__target">{targetLabel}</span>}
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar mensagem" title="Fechar">
          ×
        </button>
      </header>

      <h2 className="detail__title">{message.title}</h2>
      <p className="detail__meta">
        De <strong>{message.sender}</strong> · {formatFullDate(message.createdAt)}
      </p>

      <div className="detail__content">{message.content}</div>

      <MessageAttachments messageId={message.id} attachments={message.attachments} />

      <footer className="detail__footer">
        {message.readAt ? `✓ Lida em ${formatFullDate(message.readAt)}` : 'Não lida'}
        <span className="detail__id">{message.id}</span>
      </footer>
    </article>
  );
}
