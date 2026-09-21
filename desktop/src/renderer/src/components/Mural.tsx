import type { MuralPost } from '../../../shared/types';

interface MuralProps {
  post: MuralPost | null;
}

function dataHora(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Mural: o recado que a Central do DP deixa fixado, com imagem ou vídeo.
 * A mídia vem pelo protocolo dpmidia://, que busca no servidor com o token do PC.
 */
export function Mural({ post }: MuralProps) {
  return (
    <section className="mural">
      <h2 className="mural__titulo-secao">Mural</h2>

      {!post ? (
        <div className="cartao mural__vazio">
          Nada no mural por enquanto. Quando o Departamento Pessoal fixar um recado, ele aparece aqui.
        </div>
      ) : (
        <article className="cartao mural__cartao">
          {post.midia && (
            <div className="mural__midia">
              {post.midia.tipo === 'VIDEO' ? (
                <video src={`dpmidia://m/${post.midia.id}`} controls preload="metadata" />
              ) : (
                <img src={`dpmidia://m/${post.midia.id}`} alt={post.titulo} />
              )}
            </div>
          )}

          <div className="mural__texto">
            <h3>{post.titulo}</h3>
            <p>{post.texto}</p>
            <footer className="mural__rodape">
              <span>{dataHora(post.updatedAt || post.createdAt)}</span>
              <span>·</span>
              <span>{post.criadoPor}</span>
            </footer>
          </div>
        </article>
      )}
    </section>
  );
}
