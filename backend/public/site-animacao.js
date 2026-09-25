/*
 * Vitrine da página do Comunica Trinys: troca as cenas (comunicado, conversa,
 * mensagem de voz, calendário) e reinicia as animações de cada uma.
 * As animações em si estão no CSS (src/modules/site/site.vitrine.ts).
 *
 * - Pausa com a aba escondida ou com a vitrine fora da tela.
 * - Com "reduzir movimento" ligado no sistema, não troca sozinha: a pessoa usa os botões.
 */
(function () {
  'use strict';
  var vitrine = document.querySelector('.vitrine');
  if (!vitrine) return;

  var passos = Array.prototype.slice.call(vitrine.querySelectorAll('.vitrine__passo'));
  var total = passos.length;
  var duracao = Number(vitrine.getAttribute('data-duracao')) || 6000;
  var reduzido = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var atual = 1;
  var visivel = true;
  var proxima = null;
  var relogio = null;

  if (reduzido) vitrine.classList.add('vitrine--parada');

  function mostrar(cena) {
    atual = cena;
    // Tira e põe o atributo para as animações da cena começarem do zero
    vitrine.removeAttribute('data-cena');
    void vitrine.offsetWidth;
    vitrine.setAttribute('data-cena', String(cena));
    passos.forEach(function (passo, i) {
      passo.setAttribute('aria-pressed', String(i + 1 === cena));
    });
    contarGravacao(cena);
    agendar();
  }

  function agendar() {
    clearTimeout(proxima);
    if (reduzido || !visivel || document.hidden) return;
    proxima = setTimeout(function () {
      mostrar((atual % total) + 1);
    }, duracao);
  }

  /** Cena da mensagem de voz: o contador "Gravando 0:0X" do celular */
  function contarGravacao(cena) {
    clearInterval(relogio);
    var alvos = vitrine.querySelectorAll('[data-relogio]');
    Array.prototype.forEach.call(alvos, function (el) {
      el.textContent = '0:00';
    });
    if (cena !== 3 || reduzido) return;
    var segundos = 0;
    relogio = setInterval(function () {
      segundos += 1;
      Array.prototype.forEach.call(alvos, function (el) {
        el.textContent = '0:0' + segundos;
      });
      if (segundos >= 4) clearInterval(relogio);
    }, 400);
  }

  passos.forEach(function (passo, i) {
    passo.addEventListener('click', function () {
      mostrar(i + 1);
    });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(proxima);
    else mostrar(atual);
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      function (entradas) {
        var agora = entradas[0].isIntersecting;
        if (agora === visivel) return;
        visivel = agora;
        if (visivel) mostrar(atual);
        else clearTimeout(proxima);
      },
      { threshold: 0.2 },
    ).observe(vitrine);
  }

  mostrar(1);
})();
