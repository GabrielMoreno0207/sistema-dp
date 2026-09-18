import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  CHAT_MESSAGE_MAX,
  type ChatContact,
  type ChatMessage,
  type ChatState,
  type ConnectionState,
  type EmployeeProfile,
} from '../../../shared/types';

interface ChatPageProps {
  chat: ChatState;
  employee: EmployeeProfile | null;
  connection: ConnectionState;
  onRequestLogin(): void;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Na lista de contatos: hora para hoje, data para os outros dias */
function shortWhen(iso: string): string {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? timeLabel(iso)
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** "Livia (DP)" → "L"; "Ana Paula" → "AP" */
function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
}

function ContactItem({ contact, active, onSelect }: { contact: ChatContact; active: boolean; onSelect(): void }) {
  const classes = ['contact'];
  if (active) classes.push('contact--active');
  if (contact.unreadCount > 0) classes.push('contact--unread');
  const last = contact.lastMessage;

  return (
    <li>
      <button className={classes.join(' ')} onClick={onSelect}>
        <span className="contact__avatar" aria-hidden>
          {initials(contact.name)}
        </span>
        <span className="contact__main">
          <span className="contact__top">
            <span className="contact__name">{contact.name}</span>
            {last && <span className="contact__time">{shortWhen(last.createdAt)}</span>}
          </span>
          <span className="contact__preview">
            {last ? `${last.senderType === 'EMPLOYEE' ? 'Você: ' : ''}${last.content}` : 'Clique para conversar'}
          </span>
        </span>
        {contact.unreadCount > 0 && <span className="contact__badge">{contact.unreadCount}</span>}
      </button>
    </li>
  );
}

/**
 * Página Mensagens: conversa individual do funcionário logado com cada pessoa do DP.
 * À esquerda os contatos (pessoas do DP); à direita a conversa escolhida. Os dois lados podem iniciar.
 */
export function ChatPage({ chat, employee, connection, onRequestLogin }: ChatPageProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const online = connection.status === 'connected';
  const open = chat.contacts.find((c) => c.id === chat.openContactId) ?? null;
  const openId = open?.id ?? null;
  const openUnread = open?.unreadCount ?? 0;

  // Conversa aberta na tela = funcionário está vendo: marca como lidas as mensagens dessa pessoa do DP
  // (ao abrir, ao chegar mensagem com a janela em foco e ao voltar o foco para a janela)
  useEffect(() => {
    if (!employee || !openId || openUnread === 0) return;
    if (document.hasFocus()) void window.dp.chatMarkRead(openId);
    const onFocus = () => void window.dp.chatMarkRead(openId);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [employee, openId, openUnread]);

  // Trocou de conversa: limpa o rascunho e o erro
  useEffect(() => {
    setText('');
    setError(null);
  }, [openId]);

  // Rola até a última mensagem
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.messages.length, openId]);

  if (!employee) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1>Mensagens</h1>
            <p className="page__subtitle">Conversas com as pessoas do Departamento Pessoal.</p>
          </div>
        </header>
        <section className="panel panel--muted">
          <h2>Entre para conversar com o DP</h2>
          <p>
            As mensagens são pessoais: entre com sua matrícula para ver suas conversas com as pessoas do Departamento Pessoal e
            escrever para elas. Os comunicados gerais continuam na página Comunicados.
          </p>
          <div className="form__actions form__actions--start">
            <button className="btn btn--primary" onClick={onRequestLogin}>
              Entrar com minha matrícula
            </button>
          </div>
        </section>
      </div>
    );
  }

  function select(contactId: string) {
    setError(null);
    void window.dp.chatOpen(contactId).then((result) => {
      if (!result.ok) setError(result.message);
    });
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = text.trim();
    if (!openId || !content || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await window.dp.chatSend(openId, content);
      if (result.ok) setText('');
      else setError(result.message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  let lastDay = '';

  return (
    <div className="chat-layout">
      <aside className="contacts">
        <header className="contacts__header">
          <h1>Mensagens</h1>
          <p className="page__subtitle">Converse com qualquer pessoa do DP.</p>
        </header>
        {chat.contacts.length === 0 ? (
          <div className="empty-state">
            <span aria-hidden>👥</span>
            <p>{online ? 'Nenhuma pessoa do DP disponível para conversa no momento.' : 'Os contatos aparecem quando o app estiver 🟢 Conectado.'}</p>
          </div>
        ) : (
          <ul className="contacts__list">
            {chat.contacts.map((contact) => (
              <ContactItem key={contact.id} contact={contact} active={contact.id === openId} onSelect={() => select(contact.id)} />
            ))}
          </ul>
        )}
      </aside>

      <section className="chat">
        {!open ? (
          <div className="empty-state empty-state--detail">
            <span aria-hidden>💬</span>
            <p>Escolha uma pessoa do DP à esquerda para ver a conversa ou começar uma nova.</p>
            {error && <p className="feedback feedback--error">{error}</p>}
          </div>
        ) : (
          <>
            <header className="chat__header">
              <span className="chat__avatar" aria-hidden>
                {initials(open.name)}
              </span>
              <div>
                <h1>{open.name}</h1>
                <p className="page__subtitle">Conversa individual: só você e {open.name} veem estas mensagens.</p>
              </div>
            </header>

            <div className="chat__messages" role="log" aria-live="polite">
              {chat.messages.length === 0 && (
                <div className="empty-state">
                  <span aria-hidden>💬</span>
                  <p>{chat.loadingConversation ? 'Carregando a conversa...' : `Nenhuma mensagem ainda. Escreva abaixo para falar com ${open.name}.`}</p>
                </div>
              )}
              {chat.messages.map((message: ChatMessage) => {
                const day = dayLabel(message.createdAt);
                const showDay = day !== lastDay;
                lastDay = day;
                const mine = message.senderType === 'EMPLOYEE';
                return (
                  <Fragment key={message.id}>
                    {showDay && <div className="chat__day">{day}</div>}
                    <div className={`bubble ${mine ? 'bubble--mine' : 'bubble--dp'}`}>
                      {!mine && (
                        <span className="bubble__sender">
                          {message.senderName}
                          {message.automatic && <span className="bubble__auto">🤖 Resposta automática</span>}
                        </span>
                      )}
                      <p className="bubble__text">{message.content}</p>
                      <span className="bubble__meta">
                        {timeLabel(message.createdAt)}
                        {mine && message.readAt && <span className="bubble__read"> · ✓ lida</span>}
                      </span>
                    </div>
                  </Fragment>
                );
              })}
              <div ref={endRef} />
            </div>

            <form className="chat__composer" onSubmit={(e) => void send(e)}>
              {!online && (
                <p className="chat__offline">Sem conexão com o servidor: a mensagem só pode ser enviada com o app 🟢 Conectado.</p>
              )}
              {error && <p className="feedback feedback--error chat__error">{error}</p>}
              <div className="chat__input-row">
                <textarea
                  className="chat__input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={`Escreva para ${open.name}... (Enter envia, Shift+Enter quebra a linha)`}
                  maxLength={CHAT_MESSAGE_MAX}
                  rows={2}
                />
                <button type="submit" className="btn btn--primary" disabled={sending || !text.trim() || !online}>
                  {sending ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
