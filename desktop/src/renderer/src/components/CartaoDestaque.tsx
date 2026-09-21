import type { DpMessage } from '../../../shared/types';

interface CartaoDestaqueProps {
  message: DpMessage | null;
  onAbrir(message: DpMessage): void;
}

const TIPOS: Record<string, string> = {
  URGENTE: 'Urgente',
  AVISO: 'Aviso',
  COMUNICADO: 'Comunicado',
  INFORMATIVO: 'Informativo',
};

function dataHora(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Cartão largo com o comunicado mais recente (o "Em destaque" da tela inicial). */
export function CartaoDestaque({ message, onAbrir }: CartaoDestaqueProps) {
  return (
    <section className="destaque">
      <h2 className="destaque__titulo">Em destaque</h2>

      {!message ? (
        <div className="cartao destaque__vazio">
          Nenhum comunicado ainda. Quando o Departamento Pessoal enviar algo, aparece aqui.
        </div>
      ) : (
        <button className="cartao destaque__cartao" onClick={() => onAbrir(message)}>
          <div className="destaque__texto">
            <span className={`etiqueta etiqueta--${message.type.toLowerCase()}`}>{TIPOS[message.type] ?? message.type}</span>
            <h3>{message.title}</h3>
            <p>{message.content}</p>
            <footer className="destaque__rodape">
              <span>{dataHora(message.createdAt)}</span>
              <span>·</span>
              <span>{message.sender}</span>
              {!message.read && <span className="destaque__novo">não lido</span>}
            </footer>
          </div>
          <div className="destaque__selo" aria-hidden>
            {message.type === 'URGENTE' ? '!' : '◈'}
          </div>
        </button>
      )}
    </section>
  );
}
