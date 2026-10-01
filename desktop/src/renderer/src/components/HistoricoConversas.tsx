import type { ConversaResumo } from '../../../shared/types';
import { Avatar } from './conversa-comuns';

interface HistoricoConversasProps {
  conversas: ConversaResumo[];
  /** Id de quem está no aplicativo: define de quem é a foto na conversa direta */
  meuId: string | null;
  disponivel: boolean;
  onAbrir(): void;
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

/** As conversas mais recentes da pessoa (colegas, DP e grupos), abaixo do mural. */
export function HistoricoConversas({ conversas, meuId, disponivel, onAbrir, onEntrar }: HistoricoConversasProps) {
  const comConversa = conversas.filter((conversa) => conversa.ultimaMensagem !== null).slice(0, 6);

  return (
    <section className="historico">
      <h2 className="historico__titulo">Conversas recentes</h2>

      {!disponivel ? (
        <div className="cartao historico__vazio">
          <span>Entre com o seu usuário — ou com a conta do RH, no canto superior direito — para ver as suas conversas.</span>
          <button className="botao botao--primario" onClick={onEntrar}>
            Entrar
          </button>
        </div>
      ) : comConversa.length === 0 ? (
        <div className="cartao historico__vazio">
          <span>Você ainda não tem conversas. Abra a página Mensagens para começar.</span>
        </div>
      ) : (
        <div className="historico__lista">
          {comConversa.map((conversa) => (
            <button key={conversa.id} className="conversa" onClick={onAbrir}>
              <Avatar
                nome={conversa.titulo}
                fotoMidiaId={conversa.participantes.find((pessoa) => pessoa.id !== meuId)?.fotoMidiaId}
                grupo={conversa.tipo === 'GRUPO'}
                classe="conversa__avatar"
              />
              <span className="conversa__texto">
                <strong>{conversa.titulo}</strong>
                <span className="conversa__previa">
                  {conversa.ultimaMensagem?.tipo === 'MIDIA'
                    ? (conversa.ultimaMensagem.conteudo || 'arquivo')
                    : conversa.ultimaMensagem?.conteudo}
                </span>
              </span>
              <span className="conversa__lado">
                <span className="conversa__quando">{quando(conversa.ultimaMensagem?.createdAt ?? '')}</span>
                {conversa.naoLidas > 0 && <span className="conversa__badge">{conversa.naoLidas}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
