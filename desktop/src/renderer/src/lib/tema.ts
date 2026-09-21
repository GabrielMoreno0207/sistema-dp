/**
 * Tema claro ou escuro. A escolha fica neste computador (localStorage) e é
 * aplicada no <html>, que é o que as variáveis de cor observam.
 */
export type Tema = 'claro' | 'escuro';

const CHAVE = 'dp.tema';

export function temaGuardado(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === 'claro' || salvo === 'escuro') return salvo;
  } catch {
    /* sem localStorage: usa a preferência do sistema */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.tema = tema;
  try {
    localStorage.setItem(CHAVE, tema);
  } catch {
    /* a escolha vale só enquanto a janela estiver aberta */
  }
}
