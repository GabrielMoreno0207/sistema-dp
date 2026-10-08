/**
 * Arquivo da conversa para o TI baixar: uma página HTML que abre em qualquer
 * navegador, sem precisar do sistema, e imprime em PDF com Ctrl+P.
 *
 * Mostra também o que foi apagado: ao apagar, o texto é guardado em
 * conteudo_apagado e só a auditoria do TI o lê (ver a migração 15).
 */
import type { MidiaPublica } from '../content/content.types';
import type { MensagemAuditoria, Participante } from './conversa.types';

/** Imagem embutida no arquivo; acima deste tamanho só entra o nome */
export const LIMITE_IMAGEM_EMBUTIDA = 2 * 1024 * 1024;
/** Teto do arquivo inteiro: passando daqui, as imagens restantes entram como nome */
export const LIMITE_TOTAL_EMBUTIDO = 25 * 1024 * 1024;

export interface MensagemParaExportar {
  mensagem: MensagemAuditoria;
  midia: MidiaPublica | null;
  /** Imagem em data URI, quando couber no limite (null = entra só o nome) */
  imagemEmbutida: string | null;
}

export interface DadosDaExportacao {
  conversaId: string;
  /** Nome do grupo, ou os dois nomes da conversa direta */
  titulo: string;
  tipo: 'DIRETA' | 'GRUPO';
  participantes: Participante[];
  mensagens: MensagemParaExportar[];
  /** Quem do TI pediu o arquivo e quando (fica impresso no cabeçalho) */
  baixadaPor: string;
  baixadaEm: string;
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dataHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function soHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function diaPorExtenso(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function setorDoParticipante(pessoa: Participante): string {
  if (pessoa.ehDp) return 'RH';
  return pessoa.setor ?? 'sem setor';
}

/** "Ana Souza (Expedição) e Bruno Lima (Produção)" */
function quemParticipa(participantes: Participante[]): string {
  return participantes.map((p) => `${p.nome} (${setorDoParticipante(p)})`).join(' e ');
}

/** Nome do arquivo sugerido na janela de salvar. */
export function nomeDoArquivo(dados: DadosDaExportacao): string {
  const nomes = dados.participantes
    .map((p) => p.nome.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .map((nome) => nome.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .join('-');
  const dia = new Date(dados.baixadaEm).toISOString().slice(0, 10);
  return `conversa-${nomes || dados.conversaId}-${dia}.html`;
}

/** O que a linha da mensagem mostra como corpo. */
function corpoDaMensagem(item: MensagemParaExportar): string {
  const { mensagem, midia, imagemEmbutida } = item;
  const partes: string[] = [];

  if (mensagem.apagadaEm) {
    // O texto vem de conteudo_apagado; nas apagadas antes da versão 1.20.0 ele não existe
    const texto = mensagem.conteudoApagado;
    partes.push(
      `<p class="apagada-aviso">apagada em ${escapar(dataHora(mensagem.apagadaEm))}` +
        (mensagem.apagadaPorNome && mensagem.apagadaPorId !== mensagem.autorId
          ? ` por ${escapar(mensagem.apagadaPorNome)}`
          : '') +
        `</p>`,
    );
    if (texto) partes.push(`<p class="texto texto--apagado">${escapar(texto)}</p>`);
    else if (!midia) partes.push('<p class="texto texto--perdido">(texto não guardado: apagada antes desta versão)</p>');
  } else if (mensagem.conteudo) {
    partes.push(`<p class="texto">${escapar(mensagem.conteudo)}</p>`);
  }

  if (midia) {
    const rotulo = `${escapar(midia.nome)} · ${escapar(midia.tipo.toLowerCase())}`;
    if (imagemEmbutida) {
      partes.push(`<img class="anexo-imagem" src="${imagemEmbutida}" alt="${escapar(midia.nome)}" />`);
      partes.push(`<p class="anexo-nome">${rotulo}</p>`);
    } else {
      partes.push(`<p class="anexo-nome">anexo: ${rotulo} (não embutido neste arquivo)</p>`);
    }
  }

  if (partes.length === 0) partes.push('<p class="texto texto--perdido">(sem conteúdo)</p>');
  return partes.join('\n          ');
}

export function montarHtmlDaConversa(dados: DadosDaExportacao): string {
  const apagadas = dados.mensagens.filter((m) => m.mensagem.apagadaEm).length;
  const linhas: string[] = [];
  let diaAnterior = '';

  for (const item of dados.mensagens) {
    const { mensagem } = item;
    const dia = mensagem.createdAt.slice(0, 10);
    if (dia !== diaAnterior) {
      diaAnterior = dia;
      linhas.push(`      <h2 class="dia">${escapar(diaPorExtenso(mensagem.createdAt))}</h2>`);
    }
    const classe = [
      'msg',
      mensagem.apagadaEm ? 'msg--apagada' : '',
      mensagem.tipo === 'SISTEMA' ? 'msg--sistema' : '',
    ]
      .filter(Boolean)
      .join(' ');
    linhas.push(
      `      <div class="${classe}">
        <div class="cabecalho">
          <span class="hora">${escapar(soHora(mensagem.createdAt))}</span>
          <span class="autor">${escapar(mensagem.autorNome)}</span>
          ${mensagem.encaminhada ? '<span class="marca">encaminhada</span>' : ''}
          ${mensagem.automatica ? '<span class="marca">resposta automática</span>' : ''}
        </div>
        <div class="corpo">
          ${corpoDaMensagem(item)}
        </div>
      </div>`,
    );
  }

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Conversa — ${escapar(dados.titulo)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 24px 16px; max-width: 820px;
    background: #ffffff; color: #1c2430;
    font-family: 'Segoe UI', Ubuntu, Arial, sans-serif; font-size: 14px; line-height: 1.5;
  }
  header.folha { border-bottom: 2px solid #1c2430; padding-bottom: 12px; margin-bottom: 8px; }
  header.folha h1 { margin: 0 0 6px; font-size: 19px; }
  .ficha { margin: 0; font-size: 12.5px; color: #4a5465; }
  .ficha b { color: #1c2430; }
  .aviso {
    margin: 14px 0 0; padding: 8px 10px; border-left: 3px solid #b3231f;
    background: #fdecec; color: #a61b1b; font-size: 12.5px;
  }
  h2.dia {
    margin: 26px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #e2e7ee;
    font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #5c6878;
  }
  .msg { padding: 8px 0; border-bottom: 1px solid #f0f2f5; page-break-inside: avoid; }
  .cabecalho { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .hora { font-variant-numeric: tabular-nums; color: #5c6878; font-size: 12px; }
  .autor { font-weight: 700; }
  .marca {
    padding: 0 6px; border: 1px solid #cfd6e0; border-radius: 999px;
    font-size: 10.5px; color: #5c6878; text-transform: uppercase; letter-spacing: .03em;
  }
  .corpo { margin-left: 2px; }
  .texto { margin: 2px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg--sistema .texto { font-style: italic; color: #5c6878; }
  .msg--apagada { background: #fff8f8; }
  .apagada-aviso {
    margin: 2px 0; font-size: 11.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .03em; color: #a61b1b;
  }
  .texto--apagado { border-left: 3px solid #e5a0a0; padding-left: 8px; }
  .texto--perdido { color: #5c6878; font-style: italic; }
  .anexo-imagem {
    display: block; max-width: 420px; width: 100%; height: auto;
    margin: 6px 0; border: 1px solid #e2e7ee; border-radius: 6px;
  }
  .anexo-nome { margin: 2px 0; font-size: 12px; color: #4a5465; }
  footer.folha { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e7ee; font-size: 11.5px; color: #5c6878; }
  @media print {
    body { max-width: none; padding: 0; font-size: 11.5pt; }
    .msg { border-bottom-color: #dddddd; }
  }
</style>
</head>
<body>
  <header class="folha">
    <h1>Conversa — ${escapar(dados.titulo)}</h1>
    <p class="ficha"><b>${dados.tipo === 'GRUPO' ? 'Grupo' : 'Conversa direta'}:</b> ${escapar(quemParticipa(dados.participantes))}</p>
    <p class="ficha"><b>Identificador:</b> ${escapar(dados.conversaId)}</p>
    <p class="ficha"><b>Mensagens:</b> ${dados.mensagens.length}${apagadas > 0 ? ` (${apagadas} apagada${apagadas === 1 ? '' : 's'})` : ''}</p>
    <p class="ficha"><b>Baixada por:</b> ${escapar(dados.baixadaPor)} (TI) em ${escapar(dataHora(dados.baixadaEm))}</p>
  </header>

  <p class="aviso">
    Documento interno. Inclui mensagens apagadas pelos participantes, que não aparecem mais no aplicativo.
    A geração deste arquivo ficou registrada no servidor.
  </p>

${linhas.join('\n')}

  <footer class="folha">
    Gerado pelo Comunica Trinys a partir do registro do servidor. As mensagens estão na ordem em que foram enviadas.
  </footer>
</body>
</html>
`;
}
