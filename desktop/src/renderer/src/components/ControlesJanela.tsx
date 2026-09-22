import { useEffect, useState } from 'react';
import { Icone } from '../lib/icones';

/**
 * Botões da barra de título do próprio sistema (a janela não usa a moldura do
 * Windows). Minimizar e maximizar agem na hora; o X chama a caixa que pede a
 * senha, porque o sistema precisa ficar aberto para receber os comunicados.
 */
export function ControlesJanela({ onFechar }: { onFechar(): void }) {
  const [maximizada, setMaximizada] = useState(false);

  useEffect(() => {
    void window.dp.janelaEstaMaximizada().then(setMaximizada);
  }, []);

  return (
    <div className="controles-janela">
      <button
        className="controle-janela"
        onClick={() => window.dp.janelaMinimizar()}
        title="Minimizar"
        aria-label="Minimizar"
      >
        <Icone nome="minimizar" tamanho={15} />
      </button>
      <button
        className="controle-janela"
        onClick={() => void window.dp.janelaMaximizar().then(setMaximizada)}
        title={maximizada ? 'Restaurar' : 'Maximizar'}
        aria-label={maximizada ? 'Restaurar' : 'Maximizar'}
      >
        <Icone nome={maximizada ? 'restaurar' : 'maximizar'} tamanho={14} />
      </button>
      <button
        className="controle-janela controle-janela--fechar"
        onClick={onFechar}
        title="Fechar o sistema"
        aria-label="Fechar o sistema"
      >
        <Icone nome="fechar" tamanho={16} />
      </button>
    </div>
  );
}
