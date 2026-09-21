import type { DpMessage, EmployeeProfile, MessagesState, MidiaPublica } from '../../../shared/types';

interface ColunaDireitaProps {
  employee: EmployeeProfile | null;
  foto: MidiaPublica | null;
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
export function ColunaDireita({ employee, foto, messages, onAbrir, onVerTodos, onEntrar }: ColunaDireitaProps) {
  const recentes = messages.messages.slice(0, 6);

  return (
    <aside className="coluna-direita">
      <div className="cartao-perfil">
        <span className="cartao-perfil__empresa">Comunicação DP</span>
        {employee ? (
          <button
            className="cartao-perfil__foto cartao-perfil__foto--editavel"
            onClick={() => void window.dp.enviarFoto()}
            title={foto ? 'Trocar a foto' : 'Enviar uma foto'}
          >
            {foto ? <img src={`dpmidia://m/${foto.id}`} alt="" /> : employee.name.trim().charAt(0).toUpperCase()}
            <span className="cartao-perfil__camera" aria-hidden>
              ✎
            </span>
          </button>
        ) : (
          <span className="cartao-perfil__foto" aria-hidden>
            👤
          </span>
        )}
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
