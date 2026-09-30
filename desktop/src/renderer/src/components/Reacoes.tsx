/**
 * Reações (👍 ❤️ 😂 …) nas mensagens das conversas e nos recados do mural.
 * Cada pessoa tem uma reação por mensagem/recado: clicar em outra troca,
 * clicar na própria tira.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReacaoResumo } from '../../../shared/types';
import { Icone } from '../lib/icones';

/** As mesmas que o servidor aceita */
export const EMOJIS_REACAO = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** "Maria, João e mais 3" */
function quemReagiu(nomes: string[]): string {
  if (nomes.length <= 3) return nomes.join(', ');
  return `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3}`;
}

interface BarraProps {
  reacoes: ReacaoResumo[] | undefined;
  /** Ausente = só leitura (área do TI) */
  onReagir?: (emoji: string | null) => void;
  /** No balão o botão de reagir só aparece ao passar o mouse; no mural fica sempre à vista */
  sempreVisivel?: boolean;
}

export function BarraDeReacoes({ reacoes, onReagir, sempreVisivel }: BarraProps) {
  const [escolhendo, setEscolhendo] = useState(false);
  const caixa = useRef<HTMLSpanElement>(null);
  const lista = reacoes ?? [];
  const minha = lista.find((r) => r.minha)?.emoji ?? null;

  // Clique fora ou Esc fecha o seletor
  useEffect(() => {
    if (!escolhendo) return;
    function fora(evento: MouseEvent) {
      if (!caixa.current?.contains(evento.target as Node)) setEscolhendo(false);
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setEscolhendo(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [escolhendo]);

  if (lista.length === 0 && !onReagir) return null;

  function escolher(emoji: string) {
    setEscolhendo(false);
    onReagir?.(emoji === minha ? null : emoji);
  }

  return (
    <span className={`reacoes ${sempreVisivel ? 'reacoes--visivel' : ''} ${lista.length > 0 ? 'reacoes--tem' : ''}`} ref={caixa}>
      {lista.map((reacao) => (
        <button
          key={reacao.emoji}
          type="button"
          className={`reacao ${reacao.minha ? 'reacao--minha' : ''}`}
          onClick={() => onReagir?.(reacao.minha ? null : reacao.emoji)}
          disabled={!onReagir}
          title={`${quemReagiu(reacao.nomes)}${reacao.minha ? ' (clique para tirar a sua)' : ''}`}
          aria-label={`${reacao.emoji} ${reacao.total}: ${quemReagiu(reacao.nomes)}`}
          aria-pressed={reacao.minha}
        >
          <span className="reacao__emoji">{reacao.emoji}</span>
          <span className="reacao__total">{reacao.total}</span>
        </button>
      ))}
      {onReagir && (
        <span className="reacoes__novo">
          <button
            type="button"
            className="reacoes__botao"
            onClick={() => setEscolhendo((v) => !v)}
            title="Reagir"
            aria-label="Reagir"
            aria-expanded={escolhendo}
          >
            <Icone nome="sorriso" tamanho={15} />
          </button>
          {escolhendo && (
            <span className="reacoes__seletor" role="menu">
              {EMOJIS_REACAO.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  className={`reacoes__opcao ${emoji === minha ? 'reacoes__opcao--minha' : ''}`}
                  onClick={() => escolher(emoji)}
                  title={emoji === minha ? 'Tirar a minha reação' : undefined}
                >
                  {emoji}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
