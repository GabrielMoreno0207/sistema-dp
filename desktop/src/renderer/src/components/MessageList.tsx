import type { DpMessage } from '../../../shared/types';
import { formatMessageDate, MESSAGE_TYPE_META } from '../lib/message-meta';

interface MessageListProps {
  messages: DpMessage[];
  selectedId?: string | null;
  emptyText: string;
  onSelect(message: DpMessage): void;
}

export function MessageList({ messages, selectedId, emptyText, onSelect }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <span aria-hidden>📭</span>
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="msg-list">
      {messages.map((message) => {
        const meta = MESSAGE_TYPE_META[message.type];
        const classes = ['msg-item', `tone-${meta.tone}`];
        if (!message.read) classes.push('msg-item--unread');
        if (message.id === selectedId) classes.push('msg-item--selected');

        return (
          <li key={message.id}>
            <button className={classes.join(' ')} onClick={() => onSelect(message)}>
              <span className="msg-item__icon" aria-hidden>
                {meta.icon}
              </span>
              <span className="msg-item__main">
                <span className="msg-item__title">{message.title}</span>
                <span className="msg-item__preview">{message.content}</span>
                <span className="msg-item__meta">
                  {formatMessageDate(message.createdAt)} · {meta.label}
                  {message.attachments.length > 0 && ` · 📎 ${message.attachments.length}`}
                </span>
              </span>
              {!message.read && <span className="msg-item__unread">Não lida</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
