import type { DpMessage, EmployeeProfile, MessagesState } from '../../../shared/types';

interface ColunaDireitaProps {
  employee: EmployeeProfile | null;
  messages: MessagesState;
  onAbrir(message: DpMessage): void;
  onVerTodos(): void;
  onEntrar(): void;
}

function data(iso: string): string {
  const quando = new Date(iso);
  return Number.isNaN(quando.getTime()) ? '' : quando.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/** Coluna da direita: cartão de perfil e a lista de comunicados. */
export function ColunaDireita({ employee, messages, onAbrir, onVerTodos, onEntrar }: ColunaDireitaProps) {
  const recentes = messages.messages.slice(0, 6);

  return (
    <aside className="coluna-direita">
      <div className="cartao-perfil">
        <span className="cartao-perfil__empresa">Comunicação DP</span>
        <span className="cartao-perfil__foto" aria-hidden>
          {employee ? employee.name.trim().charAt(0).toUpperCase() : '👤'}
        </span>
        {employee ? (
          <>
            <strong className="cartao-perfil__nome">{employee.name}</strong>
            <small className="cartao-perfil__cargo">
              {[employee.sector, employee.registration && `mat. ${employee.registration}`].filter(Boolean).join(' · ')}
            </small>
          </>
        ) : (
          <>
            <strong className="cartao-perfil__nome">Sem identificação</strong>
            <button className="cartao-perfil__entrar" onClick={onEntrar}>
              entrar com a matrícula
            </button>
          </>
        )}
      </div>

      <div className="coluna-direita__cabecalho">
        <h2>Comunicados</h2>
        {messages.messages.length > recentes.length && (
          <button className="link-btn" onClick={onVerTodos}>
            ver todos
          </button>
        )}
      </div>

      <div className="lista-comunicados">
        {recentes.length === 0 ? (
          <p className="lista-comunicados__vazio">Nenhum comunicado recebido ainda.</p>
        ) : (
          recentes.map((message) => (
            <button
              key={message.id}
              className={`comunicado ${message.read ? '' : 'comunicado--nao-lido'} comunicado--${message.type.toLowerCase()}`}
              onClick={() => onAbrir(message)}
            >
              <strong className="comunicado__titulo">{message.title}</strong>
              <span className="comunicado__resumo">{message.content}</span>
              <span className="comunicado__data">{data(message.createdAt)}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
