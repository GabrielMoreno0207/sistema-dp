import type { ChatContact } from '../../../shared/types';

interface HistoricoConversasProps {
  contatos: ChatContact[];
  disponivel: boolean;
  onAbrir(contatoId: string): void;
  onEntrar(): void;
}

function quando(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Com quem a pessoa já conversou, logo abaixo do mural. */
export function HistoricoConversas({ contatos, disponivel, onAbrir, onEntrar }: HistoricoConversasProps) {
  const comConversa = contatos.filter((contato) => contato.lastMessage !== null);

  return (
    <section className="historico">
      <h2 className="historico__titulo">Conversas recentes</h2>

      {!disponivel ? (
        <div className="cartao historico__vazio">
          <span>Entre com a sua matrícula para ver as suas conversas com o DP.</span>
          <button className="botao botao--primario" onClick={onEntrar}>
            Entrar
          </button>
        </div>
      ) : comConversa.length === 0 ? (
        <div className="cartao historico__vazio">
          <span>Você ainda não conversou com ninguém do Departamento Pessoal.</span>
        </div>
      ) : (
        <div className="historico__lista">
          {comConversa.map((contato) => (
            <button key={contato.id} className="conversa" onClick={() => onAbrir(contato.id)}>
              <span className="conversa__avatar" aria-hidden>
                {contato.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="conversa__texto">
                <strong>{contato.name}</strong>
                <span className="conversa__previa">
                  {contato.lastMessage?.senderType === 'EMPLOYEE' && 'você: '}
                  {contato.lastMessage?.content}
                </span>
              </span>
              <span className="conversa__lado">
                <span className="conversa__quando">{quando(contato.lastMessage?.createdAt ?? '')}</span>
                {contato.unreadCount > 0 && <span className="conversa__badge">{contato.unreadCount}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
