'use strict';

/*
 * Tema da Central do DP (claro ou escuro).
 * Carregado no <head> sem defer, antes de a página ser desenhada: assim o tema escuro
 * não "pisca" claro ao abrir. Sem escolha salva, segue o tema do Windows.
 */
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('dp.central.theme');
  } catch (e) {
    theme = null; // localStorage indisponível: usa o tema do sistema
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
