/**
 * Vitrine animada da página pública: o aplicativo do computador e o do celular
 * lado a lado, passando por quatro cenas (comunicado, conversa, mensagem de voz
 * e calendário). É só HTML e CSS com as cores do app; o script
 * (public/site-animacao.js) troca a cena e reinicia as animações.
 *
 * Tamanhos em "em": cada tela define 1em como uma fração da própria largura
 * (unidade cqw), então o desenho escala junto, do celular à tela grande.
 */

export const CENAS = [
  { titulo: 'Comunicado na hora', texto: 'O aviso do DP aparece no computador e no celular.' },
  { titulo: 'Conversas', texto: 'A mesma conversa nos dois aparelhos.' },
  { titulo: 'Mensagem de voz', texto: 'Grave no celular, ouça no computador.' },
  { titulo: 'Calendário da empresa', texto: 'O dia marcado pelo DP em destaque.' },
] as const;

/** Duração de cada cena (o script usa o mesmo valor, lido do atributo data-duracao) */
export const DURACAO_CENA_MS = 6000;

export const VITRINE_CSS = `
  .vitrine { display: grid; gap: 18px; }
  .vitrine__palco { position: relative; padding: 0 15% 9% 0; }

  /* ---------- computador ---------- */
  .pc { width: 100%; container-type: inline-size; filter: drop-shadow(0 24px 40px rgba(0,0,0,.35)); }
  .pc__tela {
    font-size: calc(100cqw / 64); aspect-ratio: 16 / 10; display: grid; grid-template-rows: 3em 1fr;
    border-radius: .9em; overflow: hidden; background: #f0f2f5; color: #1c2430; border: .1em solid rgba(255,255,255,.12);
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .pc__barra { display: flex; align-items: center; gap: .8em; padding: 0 1.2em; background: #182b3a; color: #fff; }
  .pc__logo { width: 1.5em; height: 1.5em; border-radius: .4em; background: #17b3a3; }
  .pc__nome { font-size: 1.1em; font-weight: 700; }
  .pc__janela { margin-left: auto; display: flex; gap: .7em; }
  .pc__janela i { width: .8em; height: .8em; border-radius: 50%; background: rgba(255,255,255,.28); }
  .pc__corpo { display: grid; grid-template-columns: 12em 1fr; min-height: 0; }
  .pc__menu { background: #20374a; padding: 1em .8em; display: flex; flex-direction: column; gap: .35em; }
  .pc__item { display: flex; align-items: center; gap: .7em; height: 2.6em; padding: 0 .8em; border-radius: .6em; color: #a9bccb; transition: background .4s, color .4s; }
  .pc__item span { font-size: 1.05em; }
  .pc__item i { width: 1.2em; height: 1.2em; border-radius: .35em; background: currentColor; opacity: .75; flex: none; }
  .pc__conteudo { position: relative; overflow: hidden; }

  /* ---------- celular ---------- */
  .cel {
    position: absolute; right: 0; bottom: 0; width: 23%; container-type: inline-size;
    filter: drop-shadow(0 18px 30px rgba(0,0,0,.45));
  }
  .cel__moldura { padding: 5% 4.5%; border-radius: 16% / 7.5%; background: #0b1117; border: 1px solid rgba(255,255,255,.14); }
  .cel__tela {
    font-size: calc(100cqw / 26); aspect-ratio: 9 / 19; display: flex; flex-direction: column;
    border-radius: 2.4em; overflow: hidden; background: #f0f2f5; color: #1c2430; font-family: "Segoe UI", system-ui, sans-serif;
  }
  .cel__topo { display: flex; align-items: center; gap: .8em; padding: 2.4em 1.3em 1.1em; background: #1f3346; color: #fff; }
  .cel__topo b { font-size: 1.35em; }
  .cel__conteudo { position: relative; flex: 1; overflow: hidden; }
  .cel__abas { display: flex; justify-content: space-around; padding: .9em .4em 1.4em; background: #fff; border-top: .1em solid #e2e7ee; }
  .cel__aba { display: grid; justify-items: center; gap: .3em; color: #8391a0; transition: color .4s; }
  .cel__aba i { width: 1.6em; height: 1.6em; border-radius: .5em; background: currentColor; opacity: .7; }
  .cel__aba span { font-size: .85em; font-weight: 600; }

  /* ---------- telas (uma por cena) ---------- */
  .tela { position: absolute; inset: 0; opacity: 0; transition: opacity .45s; }
  .pc .tela { padding: 1.6em 8em 1.6em 1.6em; }
  .cel .tela { padding: 1.2em; }
  .tela__titulo { font-size: 1.7em; font-weight: 800; margin: 0 0 .6em; }
  .cel .tela__titulo { font-size: 1.5em; }

  .vitrine[data-cena="1"] .pc__item--com, .vitrine[data-cena="2"] .pc__item--msg,
  .vitrine[data-cena="3"] .pc__item--msg, .vitrine[data-cena="4"] .pc__item--ini { background: rgba(23,179,163,.2); color: #fff; }
  .vitrine[data-cena="1"] .cel__aba--ini, .vitrine[data-cena="2"] .cel__aba--msg,
  .vitrine[data-cena="3"] .cel__aba--msg, .vitrine[data-cena="4"] .cel__aba--ini { color: #0d7a6f; }
  .vitrine[data-cena="1"] .tela--com, .vitrine[data-cena="2"] .tela--chat, .vitrine[data-cena="3"] .tela--chat,
  .vitrine[data-cena="4"] .tela--cal, .vitrine[data-cena="1"] .tela--inicio { opacity: 1; }

  /* comunicados */
  .aviso { background: #fff; border-radius: .8em; padding: .9em 1.1em; margin-bottom: .8em; border-left: .4em solid var(--c); box-shadow: 0 .2em .6em rgba(22,40,55,.06); }
  .aviso small { display: block; font-size: .85em; font-weight: 800; letter-spacing: .04em; color: var(--ct); }
  .aviso b { display: block; font-size: 1.15em; margin: .15em 0; }
  .aviso span { font-size: .95em; color: #5c6878; }
  .toast {
    position: absolute; right: 8em; bottom: 1.6em; width: 24em; padding: 1.1em 1.2em; border-radius: .9em;
    background: #fff; border-left: .5em solid #17b3a3; box-shadow: 0 1em 2.4em rgba(15,23,42,.28); transform: translateX(130%);
  }
  .toast small { font-size: .85em; font-weight: 800; color: #0b6f64; letter-spacing: .04em; }
  .toast b { display: block; font-size: 1.25em; margin: .3em 0 .2em; }
  .toast span { font-size: 1em; color: #4a5465; }
  .toast__acoes { display: flex; justify-content: flex-end; gap: .6em; margin-top: .9em; }
  .toast__acoes em { font-style: normal; font-size: .95em; font-weight: 700; padding: .4em 1em; border-radius: .5em; border: .1em solid #e2e7ee; color: #4a5465; }
  .toast__acoes em + em { background: #17b3a3; border-color: #17b3a3; color: #06312c; }
  .vitrine[data-cena="1"] .toast { animation: v-entra-lado .7s cubic-bezier(.2,.9,.3,1.15) 1s both; }

  .mini { background: #fff; border-radius: 1em; padding: 1em 1.1em; margin-bottom: .8em; }
  .mini b { display: block; font-size: 1.1em; }
  .mini span { font-size: .95em; color: #5c6878; }
  .notificacao {
    position: absolute; left: .8em; right: .8em; top: .8em; display: flex; gap: .8em; align-items: flex-start;
    padding: 1em; border-radius: 1.3em; background: #fff; box-shadow: 0 .8em 2em rgba(15,23,42,.3); transform: translateY(-140%);
  }
  .notificacao i { width: 2.6em; height: 2.6em; border-radius: .7em; background: #17b3a3; flex: none; }
  .notificacao small { display: block; font-size: .9em; color: #5c6878; }
  .notificacao b { display: block; font-size: 1.15em; }
  .vitrine[data-cena="1"] .notificacao { animation: v-desce .6s cubic-bezier(.2,.9,.3,1.15) 1.5s both; }

  /* conversa */
  .chat { display: grid; grid-template-columns: 17em 1fr; height: calc(100% + 3.2em); margin: -1.6em -8em -1.6em -1.6em; }
  .contatos { background: #fff; border-right: .1em solid #e2e7ee; padding: 1.2em .9em; display: grid; align-content: start; gap: .5em; }
  .contato { display: flex; gap: .7em; align-items: center; padding: .6em; border-radius: .7em; }
  .contato--ativo { background: #e7f6f4; }
  .contato i { width: 2.6em; height: 2.6em; border-radius: 50%; background: var(--c); flex: none; }
  .contato b { display: block; font-size: 1.05em; }
  .contato span { font-size: .9em; color: #5c6878; }
  .conversa { display: flex; flex-direction: column; min-width: 0; }
  .conversa__topo { display: flex; align-items: center; gap: .8em; padding: 1em 1.4em; background: #fff; border-bottom: .1em solid #e2e7ee; }
  .conversa__topo i { width: 2.4em; height: 2.4em; border-radius: 50%; background: #17b3a3; }
  .conversa__topo b { font-size: 1.15em; }
  .baloes { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: .6em; padding: 1.2em 8em 1.2em 1.4em; }
  .cel .baloes { padding: 0 0 4em; height: 100%; }
  .balao {
    max-width: 78%; padding: .7em 1em; border-radius: 1em; font-size: 1.1em; line-height: 1.35; background: #fff;
    box-shadow: 0 .1em .3em rgba(22,40,55,.08); opacity: 0; transform: translateY(.8em) scale(.96);
  }
  .balao--eu { align-self: flex-end; background: #dff3ef; }
  /* Fechado (sem altura) fora da animação: não deixa buraco entre os balões depois que some */
  .digitando { align-self: flex-start; display: flex; gap: .35em; padding: 0 1em; max-height: 0; overflow: hidden; border-radius: 1em; background: #fff; opacity: 0; }
  .digitando i { width: .55em; height: .55em; border-radius: 50%; background: #93a2b1; animation: v-pulo 1s infinite; }
  .digitando i:nth-child(2) { animation-delay: .15s; }
  .digitando i:nth-child(3) { animation-delay: .3s; }
  .vitrine[data-cena="2"] .balao--1 { animation: v-surge .4s ease-out .4s both; }
  .vitrine[data-cena="2"] .balao--2 { animation: v-surge .4s ease-out 1.6s both; }
  .vitrine[data-cena="2"] .digitando { animation: v-digitando 1.2s 2.4s both; }
  .vitrine[data-cena="2"] .balao--3 { animation: v-surge .4s ease-out 3.6s both; }
  .vitrine[data-cena="3"] .balao--1, .vitrine[data-cena="3"] .balao--2, .vitrine[data-cena="3"] .balao--3 { opacity: 1; transform: none; }
  .vitrine[data-cena="3"] .balao--txt { display: none; }

  /* mensagem de voz */
  .voz { display: flex; align-items: center; gap: .8em; width: 17em; max-width: 100%; }
  .voz__play { width: 2.6em; height: 2.6em; border-radius: 50%; background: #17b3a3; flex: none; display: grid; place-items: center; }
  .voz__play::before { content: ""; margin-left: .2em; border-left: .8em solid #06312c; border-top: .5em solid transparent; border-bottom: .5em solid transparent; }
  .voz__trilha { flex: 1; height: .35em; border-radius: 1em; background: #c9d6df; position: relative; overflow: hidden; }
  .voz__trilha::after { content: ""; position: absolute; inset: 0; width: 0; background: #17b3a3; }
  .voz small { font-size: .85em; color: #5c6878; font-variant-numeric: tabular-nums; }
  .balao--voz { display: none; }
  .vitrine[data-cena="3"] .balao--voz { display: block; animation: v-surge .4s ease-out 2s both; }
  .vitrine[data-cena="3"] .pc .voz__trilha::after { animation: v-toca 3s linear 2.8s both; }
  .gravando {
    position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: .8em; padding: 1em 1.2em;
    background: #fff; border-top: .1em solid #e2e7ee; opacity: 0;
  }
  .gravando i { width: .9em; height: .9em; border-radius: 50%; background: #e5484d; animation: v-pulsa 1s infinite; }
  .gravando b { font-size: 1.15em; font-variant-numeric: tabular-nums; }
  .gravando em { margin-left: auto; width: 2.6em; height: 2.6em; border-radius: 50%; background: #17b3a3; }
  .vitrine[data-cena="3"] .gravando { animation: v-pisca-uma-vez 1.8s .1s both; }

  /* calendário */
  .cal { background: #fff; border-radius: 1em; padding: 1em; }
  .cal__mes { display: flex; justify-content: space-between; font-weight: 800; font-size: 1.15em; margin-bottom: .6em; }
  .cal__grade { display: grid; grid-template-columns: repeat(7, 1fr); gap: .35em; }
  .cal__grade span { display: grid; place-items: center; height: 2.3em; border-radius: .5em; background: #f4f6f9; font-size: .95em; font-weight: 600; color: #4a5465; border: .1em solid transparent; }
  .cal__grade .fora { background: transparent; color: #b0bac5; }
  .cal__grade .evento { transition: background .5s, border-color .5s, color .5s; }
  .vitrine[data-cena="4"] .cal__grade .evento { background: #f8d4d6; border-color: #e5484d; color: #1c2430; font-weight: 900; animation: v-destaca .6s ease-out 1s both; }
  .cel .cal__grade span { height: 2.2em; font-size: .85em; }
  .evento-card {
    display: flex; gap: .8em; align-items: center; margin-top: .9em; padding: .9em 1em; border-radius: .8em; background: #fff;
    border-left: .4em solid #e5484d; opacity: 0;
  }
  .evento-card b { display: block; font-size: 1.1em; }
  .evento-card span { font-size: .9em; color: #5c6878; }
  .vitrine[data-cena="4"] .evento-card { animation: v-surge .5s ease-out 1.6s both; }
  .pc .tela--cal { display: grid; grid-template-columns: 1.3fr 1fr; gap: 1.2em; align-content: start; }
  .pc .tela--cal .tela__titulo { grid-column: 1 / -1; margin-bottom: 0; }
  .pc .tela--cal .evento-card { margin-top: 0; align-self: start; }

  /* ---------- passos ---------- */
  .vitrine__passos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .vitrine__passo {
    display: grid; gap: 6px; padding: 10px 12px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.05); color: #c9d6df; text-align: left; font: inherit; cursor: pointer;
  }
  .vitrine__passo:hover { background: rgba(255,255,255,.1); }
  .vitrine__passo:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
  .vitrine__passo b { font-size: 14px; color: #fff; }
  .vitrine__passo span { font-size: 12.5px; line-height: 1.35; }
  .vitrine__passo[aria-pressed="true"] { border-color: rgba(23,179,163,.8); background: rgba(23,179,163,.14); }
  .vitrine__progresso { height: 3px; border-radius: 3px; background: rgba(255,255,255,.14); overflow: hidden; }
  .vitrine__progresso::after { content: ""; display: block; height: 100%; width: 0; background: #17b3a3; }
  .vitrine__passo[aria-pressed="true"] .vitrine__progresso::after { animation: v-toca var(--duracao) linear both; }
  .vitrine--parada .vitrine__passo[aria-pressed="true"] .vitrine__progresso::after { animation: none; width: 100%; }

  @keyframes v-entra-lado { from { transform: translateX(130%); } to { transform: none; } }
  @keyframes v-desce { from { transform: translateY(-140%); } to { transform: none; } }
  @keyframes v-surge { from { opacity: 0; transform: translateY(.8em) scale(.96); } to { opacity: 1; transform: none; } }
  @keyframes v-pisca-uma-vez { 0% { opacity: 0; } 12%, 85% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes v-digitando {
    0% { opacity: 0; max-height: 0; padding-block: 0; }
    15%, 80% { opacity: 1; max-height: 3em; padding-block: .9em; }
    100% { opacity: 0; max-height: 0; padding-block: 0; }
  }
  @keyframes v-pulo { 0%, 60%, 100% { transform: none; } 30% { transform: translateY(-.35em); } }
  @keyframes v-pulsa { 50% { opacity: .3; } }
  @keyframes v-toca { from { width: 0; } to { width: 100%; } }
  @keyframes v-destaca { 0% { transform: scale(1); } 50% { transform: scale(1.18); } 100% { transform: scale(1); } }

  @media (max-width: 720px) {
    .vitrine__passos { grid-template-columns: repeat(2, 1fr); }
    .vitrine__passo span { display: none; }
  }
  /* Sem animação: cada cena aparece pronta, e a pessoa troca pelos botões */
  @media (prefers-reduced-motion: reduce) {
    .vitrine *, .vitrine *::before, .vitrine *::after {
      animation-duration: .01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition: none !important;
    }
    .vitrine[data-cena="2"] .digitando, .vitrine[data-cena="3"] .gravando { display: none; }
  }
`;

function menuPc(): string {
  const itens: [string, string][] = [
    ['ini', 'Início'],
    ['com', 'Comunicados'],
    ['msg', 'Mensagens'],
    ['cha', 'Chamados'],
    ['cfg', 'Configurações'],
  ];
  return itens.map(([id, nome]) => `<div class="pc__item pc__item--${id}"><i></i><span>${nome}</span></div>`).join('');
}

/** Grade de outubro/2026 com o dia 20 (evento da empresa) marcado */
function calendario(): string {
  const dias: string[] = [];
  for (let i = 27; i <= 30; i++) dias.push(`<span class="fora">${i}</span>`);
  for (let d = 1; d <= 31; d++) dias.push(`<span${d === 20 ? ' class="evento"' : ''}>${d}</span>`);
  return `<div class="cal"><div class="cal__mes"><span>Outubro de 2026</span></div>
    <div class="cal__grade">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d) => `<span class="fora">${d}</span>`).join('')}${dias.join('')}</div></div>`;
}

const EVENTO = '<div class="evento-card"><div><b>20/10 · Inversão do feriado</b><span>Empresa · Departamento Pessoal</span></div></div>';

function baloes(): string {
  return `
    <div class="balao balao--1 balao--txt">Oi! Seu holerite de setembro já está disponível.</div>
    <div class="balao balao--eu balao--2 balao--txt">Obrigado! Consigo pegar hoje?</div>
    <div class="digitando"><i></i><i></i><i></i></div>
    <div class="balao balao--3">Pode sim, até às 17h 😊</div>
    <div class="balao balao--eu balao--voz"><div class="voz"><span class="voz__play"></span><span class="voz__trilha"></span><small>0:04</small></div></div>`;
}

export function vitrine(): string {
  const passos = CENAS.map(
    (c, i) => `<button type="button" class="vitrine__passo" data-passo="${i + 1}" aria-pressed="${i === 0}">
      <span class="vitrine__progresso"></span><b>${c.titulo}</b><span>${c.texto}</span></button>`,
  ).join('');

  return `
<div class="vitrine" data-cena="1" data-duracao="${DURACAO_CENA_MS}" style="--duracao: ${DURACAO_CENA_MS}ms">
  <div class="vitrine__palco" aria-hidden="true">
    <div class="pc"><div class="pc__tela">
      <div class="pc__barra"><span class="pc__logo"></span><span class="pc__nome">Comunica Trinys</span><span class="pc__janela"><i></i><i></i><i></i></span></div>
      <div class="pc__corpo">
        <div class="pc__menu">${menuPc()}</div>
        <div class="pc__conteudo">
          <div class="tela tela--com">
            <div class="tela__titulo">Comunicados</div>
            <div class="aviso" style="--c:#17b3a3;--ct:#0b6f64"><small>COMUNICADO</small><b>Reunião geral na sexta</b><span>Todos no refeitório às 16h.</span></div>
            <div class="aviso" style="--c:#d97706;--ct:#8a5300"><small>AVISO</small><b>Entrega do ponto até dia 20</b><span>Confira as suas marcações.</span></div>
            <div class="aviso" style="--c:#0891b2;--ct:#0e6b85"><small>INFORMATIVO</small><b>Campanha de vacinação</b><span>Na enfermaria, de segunda a quarta.</span></div>
            <div class="toast"><small>COMUNICADO · DP</small><b>Reunião geral na sexta</b><span>Todos no refeitório às 16h.</span>
              <div class="toast__acoes"><em>Fechar</em><em>Visualizar</em></div></div>
          </div>
          <div class="tela tela--chat">
            <div class="chat">
              <div class="contatos">
                <div class="contato contato--ativo" style="--c:#17b3a3"><i></i><div><b>Departamento Pessoal</b><span>Pode sim, até às 17h</span></div></div>
                <div class="contato" style="--c:#6e56cf"><i></i><div><b>TI</b><span>Chamado resolvido</span></div></div>
                <div class="contato" style="--c:#d97706"><i></i><div><b>Equipe da linha 2</b><span>Bom dia, pessoal!</span></div></div>
              </div>
              <div class="conversa">
                <div class="conversa__topo"><i></i><b>Departamento Pessoal</b></div>
                <div class="baloes">${baloes()}</div>
              </div>
            </div>
          </div>
          <div class="tela tela--cal"><div class="tela__titulo">Calendário</div>${calendario()}${EVENTO}</div>
        </div>
      </div>
    </div></div>

    <div class="cel"><div class="cel__moldura"><div class="cel__tela">
      <div class="cel__topo"><span class="pc__logo"></span><b>Comunica Trinys</b></div>
      <div class="cel__conteudo">
        <div class="tela tela--inicio">
          <div class="tela__titulo">Boa tarde!</div>
          <div class="mini"><b>Mural</b><span>Bem-vindos ao novo sistema.</span></div>
          <div class="mini"><b>Comunicados</b><span>Nenhum pendente</span></div>
          <div class="notificacao"><i></i><div><small>Comunica Trinys · agora</small><b>Reunião geral na sexta</b></div></div>
        </div>
        <div class="tela tela--chat"><div class="baloes">${baloes()}</div>
          <div class="gravando"><i></i><b>Gravando <span data-relogio>0:00</span></b><em></em></div></div>
        <div class="tela tela--cal">${calendario()}${EVENTO}</div>
      </div>
      <div class="cel__abas">
        <div class="cel__aba cel__aba--ini"><i></i><span>Início</span></div>
        <div class="cel__aba"><i></i><span>Avisos</span></div>
        <div class="cel__aba cel__aba--msg"><i></i><span>Mensagens</span></div>
        <div class="cel__aba"><i></i><span>Mais</span></div>
      </div>
    </div></div></div>
  </div>
  <div class="vitrine__passos" aria-label="Cenas da demonstração">${passos}</div>
</div>`;
}
