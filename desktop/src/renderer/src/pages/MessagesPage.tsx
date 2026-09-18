import { useMemo, useState } from 'react';
import type { DpMessage } from '../../../shared/types';
import { MessageDetail } from '../components/MessageDetail';
import { MessageList } from '../components/MessageList';

export type MessageFilter = 'all' | 'unread' | 'urgent';

const FILTERS: { value: MessageFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'unread', label: 'Não lidos' },
  { value: 'urgent', label: 'Urgentes' },
];

/** Página Comunicados: todos os comunicados do DP (Comunicado, Aviso, Informativo, Urgente). */
interface MessagesPageProps {
  title: string;
  subtitle: string;
  messages: DpMessage[];
  selectedId: string | null;
  onSelect(message: DpMessage): void;
  onCloseDetail(): void;
}

function applyFilter(messages: DpMessage[], filter: MessageFilter): DpMessage[] {
  if (filter === 'unread') return messages.filter((m) => !m.read);
  if (filter === 'urgent') return messages.filter((m) => m.type === 'URGENTE');
  return messages;
}

function countFor(messages: DpMessage[], filter: MessageFilter): number {
  if (filter === 'unread') return messages.filter((m) => !m.read).length;
  if (filter === 'urgent') return messages.filter((m) => m.type === 'URGENTE' && !m.read).length;
  return 0;
}

export function MessagesPage(props: MessagesPageProps) {
  const { title, subtitle, messages, selectedId, onSelect, onCloseDetail } = props;
  const [filter, setFilter] = useState<MessageFilter>('all');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return applyFilter(messages, filter).filter(
      (m) => !term || `${m.title} ${m.content}`.toLocaleLowerCase('pt-BR').includes(term),
    );
  }, [messages, filter, search]);

  const selected = messages.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="page page--split">
      <section className="page__list">
        <header className="page__header">
          <div>
            <h1>{title}</h1>
            <p className="page__subtitle">{subtitle}</p>
          </div>
        </header>

        <div className="toolbar">
          <div className="tabs" role="tablist">
            {FILTERS.map((f) => {
              const count = countFor(messages, f.value);
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={filter === f.value}
                  className={`tab ${filter === f.value ? 'tab--active' : ''}`}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                  {count > 0 && <span className="tab__count">{count}</span>}
                </button>
              );
            })}
          </div>
          <input
            className="search"
            type="search"
            placeholder="Buscar comunicados..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <MessageList
          messages={visible}
          selectedId={selectedId}
          emptyText={search ? 'Nenhum comunicado encontrado.' : 'Nada por aqui.'}
          onSelect={onSelect}
        />
      </section>

      <section className="page__detail">
        {selected ? (
          <MessageDetail message={selected} onClose={onCloseDetail} />
        ) : (
          <div className="empty-state empty-state--detail">
            <span aria-hidden>📢</span>
            <p>Selecione um comunicado para ler o conteúdo completo.</p>
          </div>
        )}
      </section>
    </div>
  );
}
