import type { ChatState, DpMessage, MessagesState } from '../../../shared/types';
import { MessageList } from '../components/MessageList';

interface HomePageProps {
  /** Comunicados do DP */
  inbox: MessagesState;
  chat: ChatState;
  onOpen(message: DpMessage): void;
  onSeeAll(): void;
  onOpenChat(): void;
}

export function HomePage({ inbox, chat, onOpen, onSeeAll, onOpenChat }: HomePageProps) {
  const urgentUnread = inbox.messages.filter((m) => m.type === 'URGENTE' && !m.read).length;
  // De quem são as mensagens novas do chat (ex.: "2 mensagens novas de Livia (DP)")
  const unreadFrom = chat.contacts.filter((c) => c.unreadCount > 0).map((c) => c.name);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Início</h1>
          <p className="page__subtitle">Comunicados e mensagens do Departamento Pessoal.</p>
        </div>
      </header>

      <section className="stats">
        <div className="stat stat--unread">
          <span className="stat__value">{inbox.unreadCount}</span>
          <span className="stat__label">Comunicados não lidos</span>
        </div>
        <div className="stat stat--urgent">
          <span className="stat__value">{urgentUnread}</span>
          <span className="stat__label">Urgentes não lidos</span>
        </div>
        <div className="stat">
          <span className="stat__value">{inbox.messages.length}</span>
          <span className="stat__label">Comunicados recebidos</span>
        </div>
        <button className="stat stat--chat" onClick={onOpenChat} title="Abrir as conversas com o DP">
          <span className="stat__value">{chat.available ? chat.unreadCount : '—'}</span>
          <span className="stat__label">Mensagens do DP não lidas</span>
        </button>
      </section>

      <section className="panel chat-card">
        <div className="panel__header">
          <h2>💬 Mensagens com o DP</h2>
          <button className="link-btn" onClick={onOpenChat}>
            {chat.available ? 'Abrir conversas →' : 'Entrar para conversar →'}
          </button>
        </div>
        {!chat.available ? (
          <p className="page__subtitle">Entre com sua matrícula para conversar com o Departamento Pessoal.</p>
        ) : chat.unreadCount > 0 && unreadFrom.length > 0 ? (
          <p className="chat-card__preview">
            <strong>{chat.unreadCount === 1 ? '1 mensagem nova' : `${chat.unreadCount} mensagens novas`}</strong> de{' '}
            {unreadFrom.join(', ')}
          </p>
        ) : (
          <p className="page__subtitle">Nenhuma mensagem nova. Você pode escrever para qualquer pessoa do DP.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Comunicados recentes</h2>
          {inbox.messages.length > 5 && (
            <button className="link-btn" onClick={onSeeAll}>
              Ver todos →
            </button>
          )}
        </div>
        <MessageList
          messages={inbox.messages.slice(0, 5)}
          emptyText="Nenhum comunicado recebido ainda. Quando o DP enviar um comunicado, ele aparece aqui."
          onSelect={onOpen}
        />
      </section>
    </div>
  );
}
