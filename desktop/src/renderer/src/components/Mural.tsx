import { useState } from 'react';
import type { MuralPost } from '../../../shared/types';
import { BarraDeReacoes } from './Reacoes';
import { VisualizadorImagem } from './conversa-comuns';

interface MuralProps {
  post: MuralPost | null;
  /** Só quem está logado reage (sem isso as reações aparecem, mas sem o botão) */
  podeReagir?: boolean;
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
 *
 * A foto ocupa a largura do cartão, acima do texto: antes ficava numa coluna de
 * 320px ao lado, e foto de celular chegava espremida. Um clique abre em tela
 * cheia, com os mesmos botões do chat (copiar e abrir no Windows).
 */
export function Mural({ post, podeReagir }: MuralProps) {
  const [erro, setErro] = useState('');
  const [imagemAberta, setImagemAberta] = useState(false);
  const [abrindo, setAbrindo] = useState(false);

  async function reagir(emoji: string | null) {
    if (!post) return;
    const resultado = await window.dp.muralReagir(post.id, emoji);
    setErro(resultado.ok ? '' : resultado.message);
  }

  async function copiarImagem(midiaId: string) {
    const resultado = await window.dp.conversasCopiarImagem(midiaId);
    setErro(resultado.ok ? '' : resultado.message);
  }

  async function abrirNoWindows(midiaId: string, nome: string) {
    setAbrindo(true);
    try {
      const resultado = await window.dp.conversasAbrirArquivo(midiaId, nome);
      if (!resultado.ok && resultado.message) setErro(resultado.message);
    } finally {
      setAbrindo(false);
    }
  }

  const midia = post?.midia ?? null;
  const ehImagem = midia?.tipo !== 'VIDEO';

  return (
    <section className="mural">
      <h2 className="mural__titulo-secao">Mural</h2>

      {!post ? (
        <div className="cartao mural__vazio">
          Nada no mural por enquanto. Quando o RH fixar um recado, ele aparece aqui.
        </div>
      ) : (
        <article className="cartao mural__cartao">
          {midia && (
            <div className={`mural__midia ${ehImagem ? 'mural__midia--clicavel' : ''}`}>
              {ehImagem ? (
                <img
                  src={`dpmidia://m/${midia.id}`}
                  alt={post.titulo}
                  title="Clique para ver em tela cheia"
                  onClick={() => setImagemAberta(true)}
                />
              ) : (
                <video src={`dpmidia://m/${midia.id}`} controls preload="metadata" />
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
            <div className="mural__reacoes">
              <BarraDeReacoes reacoes={post.reacoes} onReagir={podeReagir ? (emoji) => void reagir(emoji) : undefined} sempreVisivel />
            </div>
            {erro && <p className="feedback feedback--error">{erro}</p>}
          </div>

          {imagemAberta && midia && ehImagem && (
            <VisualizadorImagem
              midiaId={midia.id}
              nome={post.titulo}
              abrindo={abrindo}
              onAbrirNoWindows={() => void abrirNoWindows(midia.id, post.titulo)}
              onCopiar={() => void copiarImagem(midia.id)}
              onFechar={() => setImagemAberta(false)}
            />
          )}
        </article>
      )}
    </section>
  );
}
