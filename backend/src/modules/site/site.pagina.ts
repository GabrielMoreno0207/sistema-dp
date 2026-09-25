/**
 * HTML da página pública do servidor. Sem script e sem arquivo externo além
 * da logo: abre rápido em qualquer navegador, inclusive no celular.
 * Cores iguais às do aplicativo (verde #17B3A3 e azul-escuro #20374A).
 */
import type { ReleasePublico } from '../updates/update.types';
import { VITRINE_CSS, vitrine } from './site.vitrine';

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function tamanho(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1).replace('.', ',')} MB`;
}

function data(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

const ESTILO = `
  :root {
    --verde: #17b3a3; --verde-escuro: #0d7a6f; --azul: #20374a; --azul-fundo: #182b3a;
    --fundo: #f0f2f5; --cartao: #ffffff; --texto: #1c2430; --suave: #4a5465; --borda: #e2e7ee;
    --sobre-verde: #06312c; --chip: #e3f5f2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fundo: #0e151b; --cartao: #172129; --texto: #e4ecf1; --suave: #a9b8c3; --borda: #26343f;
      --chip: #12302d; --verde-escuro: #5fd3c6;
    }
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--fundo); color: var(--texto);
    font: 16px/1.55 "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  a { color: inherit; }
  .topo {
    background: radial-gradient(1200px 400px at 85% -10%, rgba(23,179,163,.35), transparent 60%),
                linear-gradient(160deg, var(--azul) 0%, var(--azul-fundo) 100%);
    color: #fff; padding: 28px 20px 96px;
  }
  .barra { max-width: 1180px; margin: 0 auto; display: flex; align-items: center; gap: 12px; }
  .barra img { width: 40px; height: 40px; border-radius: 10px; }
  .barra strong { font-size: 18px; letter-spacing: .2px; }
  .heroi { max-width: 1180px; margin: 48px auto 0; display: grid; gap: 40px; align-items: center; }
  .heroi__texto { display: grid; gap: 18px; }
  @media (min-width: 980px) { .heroi { grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); } }
  .heroi h1 { margin: 0; font-size: clamp(32px, 6vw, 52px); line-height: 1.1; letter-spacing: -.5px; }
  .heroi h1 span { color: var(--verde); }
  .heroi p { margin: 0; max-width: 620px; font-size: clamp(16px, 2.2vw, 19px); color: #c9d6df; }
  .acoes { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
  .botao {
    display: inline-flex; align-items: center; gap: 10px; padding: 13px 20px; border-radius: 12px;
    font-weight: 700; text-decoration: none; border: 2px solid transparent; transition: transform .15s, background .15s;
  }
  .botao:hover { transform: translateY(-1px); }
  .botao:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  .botao--cheio { background: var(--verde); color: var(--sobre-verde); }
  .botao--cheio:hover { background: #1fc7b5; }
  .botao--vazado { border-color: rgba(255,255,255,.35); color: #fff; }
  .botao--vazado:hover { background: rgba(255,255,255,.08); }
  .botao svg { width: 20px; height: 20px; flex: none; }
  main { max-width: 1040px; margin: -64px auto 0; padding: 0 20px 56px; display: grid; gap: 40px; }
  .downloads { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 18px; }
  .cartao {
    background: var(--cartao); border: 1px solid var(--borda); border-radius: 18px; padding: 24px;
    box-shadow: 0 10px 30px rgba(22,40,55,.10); display: grid; gap: 14px; align-content: start;
  }
  .cartao__topo { display: flex; align-items: center; gap: 14px; }
  .icone {
    width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; flex: none;
    background: var(--chip); color: var(--verde-escuro);
  }
  .icone svg { width: 28px; height: 28px; }
  .cartao h2 { margin: 0; font-size: 20px; }
  .cartao p { margin: 0; color: var(--suave); }
  .detalhes { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { background: var(--chip); color: var(--verde-escuro); border-radius: 999px; padding: 3px 10px; font-size: 13px; font-weight: 600; }
  .cartao .botao { justify-content: center; }
  .cartao .botao--cheio:focus-visible { outline-color: var(--verde-escuro); }
  .indisponivel { padding: 13px 20px; border-radius: 12px; border: 1px dashed var(--borda); color: var(--suave); text-align: center; }
  .dica { font-size: 14px; }
  section h3 { margin: 0 0 16px; font-size: 22px; }
  .recursos { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr)); gap: 14px; }
  .recurso { background: var(--cartao); border: 1px solid var(--borda); border-radius: 16px; padding: 18px; }
  .recurso b { display: block; margin-bottom: 4px; }
  .recurso span { color: var(--suave); font-size: 15px; }
  .recurso .icone { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 12px; }
  .recurso .icone svg { width: 22px; height: 22px; }
  .passos { background: var(--cartao); border: 1px solid var(--borda); border-radius: 16px; padding: 20px 22px; }
  .passos ol { margin: 0; padding-left: 20px; display: grid; gap: 8px; color: var(--suave); }
  .passos code {
    background: var(--chip); color: var(--verde-escuro); padding: 2px 8px; border-radius: 6px;
    font: 600 14px/1.6 ui-monospace, Consolas, monospace; word-break: break-all;
  }
  footer { border-top: 1px solid var(--borda); padding: 22px 20px 32px; text-align: center; color: var(--suave); font-size: 14px; }
  @media (max-width: 520px) {
    .topo { padding-bottom: 88px; }
    .heroi { margin-top: 36px; }
    .acoes .botao { flex: 1 1 100%; justify-content: center; }
  }
  @media (prefers-reduced-motion: reduce) { .botao { transition: none; } .botao:hover { transform: none; } }
${VITRINE_CSS}
`;

const ICONES = {
  windows:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/></svg>',
  android:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.6 9.48 19.44 6.3a.38.38 0 0 0-.66-.38L16.9 9.14A11.4 11.4 0 0 0 12 8.08c-1.77 0-3.4.38-4.9 1.06L5.22 5.92a.38.38 0 0 0-.66.38L6.4 9.48C3.3 11.17 1.18 14.3 1 18h22c-.18-3.7-2.3-6.83-5.4-8.52M7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5m10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5"/></svg>',
  baixar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16"/></svg>',
  megafone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>',
  conversa:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  sirene:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1z"/><path d="M21 12h1M18.5 4.5 18 5M2 12h1M12 2v1M4.9 4.9l.7.7"/></svg>',
  calendario:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  microfone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>',
  ferramenta:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
};

function cartaoDownload(opcoes: {
  release: ReleasePublico | null;
  icone: string;
  titulo: string;
  descricao: string;
  href: string;
  rotulo: string;
  dica: string;
}): string {
  const { release } = opcoes;
  const acao = release
    ? `<a class="botao botao--cheio" href="${opcoes.href}" download>${ICONES.baixar} ${opcoes.rotulo}</a>`
    : '<div class="indisponivel">Ainda não há versão publicada.</div>';
  const detalhes = release
    ? `<div class="detalhes">
         <span class="chip">Versão ${escapar(release.versao)}</span>
         <span class="chip">${tamanho(release.tamanho)}</span>
         ${data(release.publicadoEm) ? `<span class="chip">Publicado em ${data(release.publicadoEm)}</span>` : ''}
       </div>`
    : '';
  return `
    <article class="cartao">
      <div class="cartao__topo">
        <div class="icone">${opcoes.icone}</div>
        <div><h2>${opcoes.titulo}</h2></div>
      </div>
      <p>${opcoes.descricao}</p>
      ${detalhes}
      ${acao}
      <p class="dica">${opcoes.dica}</p>
    </article>`;
}

function recurso(icone: string, titulo: string, texto: string): string {
  return `<div class="recurso"><div class="icone">${icone}</div><b>${titulo}</b><span>${texto}</span></div>`;
}

function documento(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#20374a">
<meta name="robots" content="noindex">
<title>${titulo}</title>
<link rel="icon" href="/icone.png">
<style>${ESTILO}</style>
</head>
<body>${corpo}</body>
</html>`;
}

export function paginaInicial(dados: { desktop: ReleasePublico | null; celular: ReleasePublico | null; servidor: string }): string {
  const servidor = escapar(dados.servidor || 'https://comunica.trinys.com.br');
  return documento(
    'Comunica Trinys',
    `
<header class="topo">
  <div class="barra"><img src="/icone.png" alt=""><strong>Comunica Trinys</strong></div>
  <div class="heroi">
    <div class="heroi__texto">
      <h1>A comunicação da empresa, <span>num lugar só.</span></h1>
      <p>Comunicados do Departamento Pessoal, conversas entre colegas, avisos urgentes e o calendário da empresa, no computador e no celular.</p>
      <div class="acoes">
        <a class="botao botao--cheio" href="#baixar">${ICONES.baixar} Baixar o aplicativo</a>
        <a class="botao botao--vazado" href="#como-usar">Como começar</a>
      </div>
    </div>
    ${vitrine()}
  </div>
</header>

<main>
  <section id="baixar" class="downloads" aria-label="Downloads">
    ${cartaoDownload({
      release: dados.desktop,
      icone: ICONES.windows,
      titulo: 'Computador (Windows)',
      descricao: 'Fica aberto ao lado do relógio e avisa na hora quando chega comunicado ou mensagem.',
      href: '/baixar/desktop',
      rotulo: 'Baixar para Windows',
      dica: 'Depois de instalado, o aplicativo se atualiza sozinho.',
    })}
    ${cartaoDownload({
      release: dados.celular,
      icone: ICONES.android,
      titulo: 'Celular (Android)',
      descricao: 'Recebe os avisos mesmo com o app fechado, com notificação e alerta em tela cheia nos urgentes.',
      href: '/baixar/celular',
      rotulo: 'Baixar o APK',
      dica: 'Na instalação, o Android pede para permitir “instalar apps desta fonte”: é só permitir.',
    })}
  </section>

  <section aria-labelledby="recursos-titulo">
    <h3 id="recursos-titulo">O que dá para fazer</h3>
    <div class="recursos">
      ${recurso(ICONES.megafone, 'Comunicados', 'Recados do DP para todos ou por setor, com confirmação de leitura.')}
      ${recurso(ICONES.sirene, 'Avisos urgentes', 'Aparecem em destaque na tela, para ninguém perder o que é importante.')}
      ${recurso(ICONES.conversa, 'Conversas e grupos', 'Mensagens com colegas, DP e TI, com fotos, documentos e respostas.')}
      ${recurso(ICONES.microfone, 'Mensagens de voz', 'Grave um áudio direto na conversa, no computador ou no celular.')}
      ${recurso(ICONES.calendario, 'Mural e calendário', 'Recados fixados e as datas importantes da empresa.')}
      ${recurso(ICONES.ferramenta, 'Chamados para o TI', 'Peça ajuda ao TI e acompanhe a resposta pelo app.')}
    </div>
  </section>

  <section id="como-usar" aria-labelledby="como-titulo">
    <h3 id="como-titulo">Como começar</h3>
    <div class="passos">
      <ol>
        <li>Baixe e instale o aplicativo do computador ou do celular.</li>
        <li>Se o aplicativo pedir o endereço do servidor, use <code>${servidor}</code></li>
        <li>Entre com o usuário e a senha cadastrados pelo Departamento Pessoal.</li>
      </ol>
    </div>
  </section>
</main>

<footer>Comunica Trinys · uso interno da Trinys. Dúvidas? Fale com o TI.</footer>
<script src="/site-animacao.js" defer></script>`,
  );
}

/** Aviso simples, no mesmo visual (download inexistente ou ainda não publicado) */
export function paginaSemVersao(mensagem: string): string {
  return documento(
    'Comunica Trinys',
    `
<header class="topo">
  <div class="barra"><img src="/icone.png" alt=""><strong>Comunica Trinys</strong></div>
  <div class="heroi">
    <h1>${escapar(mensagem)}</h1>
    <div class="acoes"><a class="botao botao--cheio" href="/">Voltar para o início</a></div>
  </div>
</header>`,
  );
}
