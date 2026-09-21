import { useState } from 'react';
import type { Atalho, DadosAtalho, DestinoAtalho } from '../../../shared/types';
import { EditorAtalho } from './EditorAtalho';
import type { Page } from './MenuLateral';

/** Para onde cada destino leva dentro do aplicativo. */
const PAGINA_DO_DESTINO: Record<DestinoAtalho, Page> = {
  COMUNICADOS: 'announcements',
  CHAT: 'messages',
  PERFIL: 'profile',
  CONFIGURACOES: 'settings',
  MURAL: 'home',
};

interface GradeAtalhosProps {
  atalhos: Atalho[];
  /** Sem funcionário logado não dá para guardar atalhos no servidor */
  podeEditar: boolean;
  badges: Partial<Record<DestinoAtalho, number>>;
  onAbrir(page: Page): void;
  onAviso(mensagem: string): void;
}

export function GradeAtalhos({ atalhos, podeEditar, badges, onAbrir, onAviso }: GradeAtalhosProps) {
  const [editando, setEditando] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Atalho | null>(null);
  const [criando, setCriando] = useState(false);

  async function salvar(dados: DadosAtalho) {
    const resultado = emEdicao
      ? await window.dp.atualizarAtalho(emEdicao.id, dados)
      : await window.dp.criarAtalho(dados);
    if (!resultado.ok) {
      onAviso(resultado.message);
      return;
    }
    setEmEdicao(null);
    setCriando(false);
  }

  async function remover(atalho: Atalho) {
    const resultado = await window.dp.removerAtalho(atalho.id);
    if (!resultado.ok) onAviso(resultado.message);
    setEmEdicao(null);
  }

  /** Move o atalho uma posição para a esquerda ou para a direita. */
  async function mover(indice: number, passo: -1 | 1) {
    const destino = indice + passo;
    if (destino < 0 || destino >= atalhos.length) return;
    const ordem = atalhos.map((a) => a.id);
    [ordem[indice], ordem[destino]] = [ordem[destino], ordem[indice]];
    const resultado = await window.dp.reordenarAtalhos(ordem);
    if (!resultado.ok) onAviso(resultado.message);
  }

  return (
    <section className="grade">
      <div className="grade__cabecalho">
        <h2 className="grade__titulo">Meus atalhos</h2>
        {podeEditar && (
          <div className="grade__acoes">
            <button className="link-btn" onClick={() => setEditando((estava) => !estava)}>
              {editando ? 'concluir' : 'organizar'}
            </button>
            <button className="link-btn" onClick={() => setCriando(true)}>
              + novo atalho
            </button>
          </div>
        )}
      </div>

      {atalhos.length === 0 ? (
        <div className="grade__vazia">
          {podeEditar ? (
            <>
              <p>Você ainda não tem atalhos. Monte a sua tela do jeito que preferir.</p>
              <button className="botao botao--primario" onClick={() => setCriando(true)}>
                Criar o primeiro atalho
              </button>
            </>
          ) : (
            <p>Entre com a sua matrícula para montar os seus atalhos.</p>
          )}
        </div>
      ) : (
        <div className="grade__azulejos">
          {atalhos.map((atalho, indice) => {
            const badge = badges[atalho.destino] ?? 0;
            return (
              <div key={atalho.id} className="azulejo-caixa">
                <button
                  className="azulejo"
                  style={{ backgroundColor: atalho.cor }}
                  title={atalho.rotulo}
                  onClick={() => (editando ? setEmEdicao(atalho) : onAbrir(PAGINA_DO_DESTINO[atalho.destino]))}
                >
                  <span className="azulejo__icone" aria-hidden>
                    {atalho.icone}
                  </span>
                  <span className="azulejo__label">{atalho.rotulo}</span>
                  {badge > 0 && !editando && <span className="azulejo__badge">{badge > 99 ? '99+' : badge}</span>}
                  {editando && (
                    <span className="azulejo__editar" aria-hidden>
                      ✎
                    </span>
                  )}
                </button>

                {editando && (
                  <div className="azulejo-mover">
                    <button onClick={() => void mover(indice, -1)} disabled={indice === 0} aria-label="Mover para a esquerda">
                      ‹
                    </button>
                    <button
                      onClick={() => void mover(indice, 1)}
                      disabled={indice === atalhos.length - 1}
                      aria-label="Mover para a direita"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(criando || emEdicao) && (
        <EditorAtalho
          atalho={emEdicao}
          onSalvar={salvar}
          onRemover={emEdicao ? () => remover(emEdicao) : undefined}
          onFechar={() => {
            setCriando(false);
            setEmEdicao(null);
          }}
        />
      )}
    </section>
  );
}
