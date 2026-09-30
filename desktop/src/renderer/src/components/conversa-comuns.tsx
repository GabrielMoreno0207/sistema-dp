import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ConversaResumo, MensagemConversa, Participante } from '../../../shared/types';
import { Icone } from '../lib/icones';
import { PlayerDeAudio } from './audio';
import { BarraDeReacoes } from './Reacoes';

/** "Ana Paula" → "AP"; "Livia (DP)" → "L" */
export function iniciais(nome: string): string {
  const palavras = nome
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (palavras.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
}

/**
 * Foto da pessoa, ou as iniciais quando ela não tem foto.
 *
 * A imagem vem pelo protocolo dpmidia://, que o processo principal busca no
 * servidor com a credencial do aplicativo (a tela não tem acesso à rede).
 */
export function Avatar({
  nome,
  fotoMidiaId,
  grupo = false,
  classe = 'contact__avatar',
}: {
  nome: string;
  fotoMidiaId?: string | null;
  grupo?: boolean;
  classe?: string;
}) {
  const [falhou, setFalhou] = useState(false);

  if (grupo) {
    return (
      <span className={classe}>
        <Icone nome="grupo" />
      </span>
    );
  }
  if (fotoMidiaId && !falhou) {
    return (
      <img
        className={`${classe} ${classe}--foto`}
        src={`dpmidia://m/${fotoMidiaId}`}
        alt=""
        // Foto que não carrega (apagada, sem conexão) volta a ser as iniciais
        onError={() => setFalhou(true)}
      />
    );
  }
  return (
    <span className={classe} aria-hidden>
      {iniciais(nome)}
    </span>
  );
}

/** Em conversa direta, a pessoa do outro lado (é dela a foto e o nome). */
export function outraPessoa(conversa: ConversaResumo, meuId: string): Participante | null {
  if (conversa.tipo === 'GRUPO') return null;
  return conversa.participantes.find((pessoa) => pessoa.id !== meuId) ?? conversa.participantes[0] ?? null;
}

export function horaDoDia(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Data para a lista (curta) ou para a divisória da conversa (por extenso).
 * Hoje aparece como a hora na lista e como "Hoje" na divisória.
 */
export function dataDoDia(iso: string, porExtenso = false): string {
  const data = new Date(iso);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);

  if (!porExtenso) {
    return data.toDateString() === hoje.toDateString()
      ? horaDoDia(iso)
      : data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  if (data.toDateString() === hoje.toDateString()) return 'Hoje';
  if (data.toDateString() === ontem.toDateString()) return 'Ontem';
  return data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Une o que já está na tela com o que chegou, sem repetir.
 *
 * A mesma mensagem chega por dois caminhos: a resposta do envio e a recarga
 * disparada pelo aviso `conversa:atualizada` do servidor. Empilhar as duas
 * fazia a mensagem aparecer duas vezes; aqui a versão mais nova de cada id
 * vence, e a ordem é sempre a do servidor (id crescente).
 */
export function juntarMensagens(atuais: MensagemConversa[], novas: MensagemConversa[]): MensagemConversa[] {
  const porId = new Map(atuais.map((mensagem) => [mensagem.id, mensagem]));
  for (const mensagem of novas) porId.set(mensagem.id, mensagem);
  return [...porId.values()].sort((a, b) => a.id - b.id);
}

/** Texto curto da mensagem citada, para o bloco acima do campo de escrever. */
export function resumoDaCitacao(mensagem: MensagemConversa): string {
  if (mensagem.apagadaEm) return 'mensagem apagada';
  if (mensagem.conteudo) return mensagem.conteudo.slice(0, 120);
  if (mensagem.midia?.tipo === 'AUDIO') return 'Mensagem de voz';
  if (mensagem.midia) return mensagem.midia.nome;
  return 'anexo';
}

/**
 * Endereços dentro do texto viram links. Pega "https://...", "http://..." e
 * também "www.algumacoisa" (o mais comum de alguém digitar), sem engolir a
 * pontuação final de uma frase.
 */
const ENDERECO = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

/** Tira a pontuação que ficou colada no fim do endereço ("veja o site: x.com.") */
function limparFim(bruto: string): { endereco: string; sobra: string } {
  let endereco = bruto;
  let sobra = '';
  const PONTUACAO = `.,;:!?)]}'"`;
  while (endereco.length > 0 && PONTUACAO.includes(endereco[endereco.length - 1])) {
    // Parêntese que fecha só sai se não tiver o que abre dentro do endereço
    if (endereco.endsWith(')') && endereco.includes('(')) break;
    sobra = endereco[endereco.length - 1] + sobra;
    endereco = endereco.slice(0, -1);
  }
  return { endereco, sobra };
}

/** Texto da mensagem com os endereços clicáveis (abrem no navegador padrão). */
export function TextoComLinks({ texto, onErro }: { texto: string; onErro?: (mensagem: string) => void }) {
  const pedacos = texto.split(ENDERECO);
  return (
    <>
      {pedacos.map((pedaco, indice) => {
        // As partes ímpares são o que o padrão capturou: os endereços
        if (indice % 2 === 0 || !pedaco) return pedaco;
        const { endereco, sobra } = limparFim(pedaco);
        const url = endereco.startsWith('www.') ? `https://${endereco}` : endereco;
        return (
          <span key={indice}>
            <a
              className="link-mensagem"
              href={url}
              title={url}
              onClick={(evento) => {
                evento.preventDefault();
                void window.dp.abrirLink(url).then((r) => {
                  if (!r.ok && r.message) onErro?.(r.message);
                });
              }}
            >
              {endereco}
            </a>
            {sobra}
          </span>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------
 * Código dentro da mensagem
 *
 * Três formas, na ordem em que são procuradas:
 *   1. bloco entre ``` (com o nome da linguagem, se vier);
 *   2. a mensagem inteira, quando o que foi colado tem cara de código;
 *   3. trecho curto entre crases, no meio da frase.
 * O bloco sai em fonte de largura fixa, com a indentação preservada e um botão
 * de copiar — foi para isso que a pessoa colou o código.
 * ------------------------------------------------------------------ */

/** Sinais de que aquilo é código, e não uma frase */
const SINAIS_DE_CODIGO = [
  /^[ \t]+\S/m, // linha indentada
  /[;{}]\s*$/m, // linha terminando em ; { }
  /\b(function|const|let|var|def|class|import|return|public|private|static|void|select|insert|update|delete)\b/i,
  /=>|->|::|&&|\|\||!==|===|<=|>=/,
  /<\/?[a-z][\w-]*\s*\/?>/i, // etiqueta de HTML/XML
  /\w+\([^()]*\)\s*[;{]?$/m, // chamada de função no fim da linha
  /^\s*(#include|#!|<\?php|@media|\$\w+\s*=)/m,
  /^\s{2,}at\s+\S/m, // pilha de erro ("    at Module._load ...")
  /\b(Traceback|Exception|stack trace)\b/i,
];

/** Linha com jeito de código: indentada ou com os sinais de pontuação da linguagem */
const LINHA_DE_CODIGO = /^[ \t]+\S|[;{}()=<>]/;

/**
 * A mensagem inteira parece código? Exige mais de uma linha, pelo menos dois
 * sinais diferentes e metade das linhas com cara de código — assim um recado
 * comum com ponto e vírgula não vira bloco.
 */
export function pareceCodigo(texto: string): boolean {
  const linhas = texto.split('\n');
  if (linhas.length < 2) return false;
  if (SINAIS_DE_CODIGO.filter((padrao) => padrao.test(texto)).length < 2) return false;

  const comConteudo = linhas.filter((linha) => linha.trim() !== '');
  const comCara = comConteudo.filter((linha) => LINHA_DE_CODIGO.test(linha)).length;
  return comConteudo.length > 0 && comCara / comConteudo.length >= 0.5;
}

/** Bloco de código: fonte fixa, rolagem própria e botão de copiar. */
function BlocoDeCodigo({
  codigo,
  linguagem,
  onAviso,
}: {
  codigo: string;
  linguagem?: string;
  onAviso?: (mensagem: string) => void;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar(): Promise<void> {
    const resultado = await window.dp.copiarTexto(codigo);
    if (!resultado.ok) {
      onAviso?.(resultado.message);
      return;
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  return (
    <span className="codigo">
      <span className="codigo__topo">
        <span className="codigo__linguagem">{linguagem || 'código'}</span>
        <button type="button" className="codigo__copiar" onClick={() => void copiar()}>
          {copiado ? 'copiado' : 'copiar'}
        </button>
      </span>
      <span className="codigo__corpo">
        <code>{codigo}</code>
      </span>
    </span>
  );
}

/** Trecho entre crases no meio da frase: fonte fixa, sem virar bloco. */
function TextoComCodigoCurto({ texto, onErro }: { texto: string; onErro?: (mensagem: string) => void }) {
  const partes = texto.split(/`([^`\n]+)`/);
  return (
    <>
      {partes.map((parte, indice) =>
        indice % 2 === 1 ? (
          <code key={indice} className="codigo-curto">
            {parte}
          </code>
        ) : (
          <TextoComLinks key={indice} texto={parte} onErro={onErro} />
        ),
      )}
    </>
  );
}

/**
 * Conteúdo da mensagem: código em bloco, trechos entre crases, endereços
 * clicáveis e o texto normal.
 */
export function TextoDaMensagem({
  texto,
  onErro,
  onAviso,
}: {
  texto: string;
  onErro?: (mensagem: string) => void;
  onAviso?: (mensagem: string) => void;
}) {
  // O split com dois grupos devolve: texto, linguagem, código, texto, ...
  const partes = texto.split(/```([\w+#-]{0,20})?\r?\n?([\s\S]*?)```/);
  if (partes.length > 1) {
    const saida: ReactNode[] = [];
    for (let i = 0; i < partes.length; i += 3) {
      const antes = partes[i];
      if (antes) saida.push(<TextoComCodigoCurto key={`t${i}`} texto={antes} onErro={onErro} />);
      const codigo = partes[i + 2];
      if (codigo !== undefined) {
        saida.push(
          <BlocoDeCodigo key={`c${i}`} codigo={codigo.replace(/\n$/, '')} linguagem={partes[i + 1]} onAviso={onAviso} />,
        );
      }
    }
    return <>{saida}</>;
  }

  if (pareceCodigo(texto)) return <BlocoDeCodigo codigo={texto} onAviso={onAviso} />;
  return <TextoComCodigoCurto texto={texto} onErro={onErro} />;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface MensagemProps {
  mensagem: MensagemConversa;
  minha: boolean;
  emGrupo: boolean;
  /** Ausente na área do TI: lá a conversa é só leitura */
  onApagar?: () => void;
  /** Ausente na área do TI: repassar a mensagem para outra conversa */
  onEncaminhar?: () => void;
  /** Ausente na área do TI: responder citando esta mensagem */
  onResponder?: () => void;
  /** Clique no bloco da citação: leva até a mensagem citada */
  onIrAte?: (mensagemId: number) => void;
  /** Só nas minhas: o outro lado já leu (duas marcas de certo) */
  lida?: boolean;
  /** Realce de quem veio da busca */
  destacada?: boolean;
  /** Ausente na área do TI: reagir à mensagem (null = tirar a reação) */
  onReagir?: (emoji: string | null) => void;
  onErro(mensagem: string): void;
  /** Recado de sucesso (ex.: "Imagem copiada") */
  onAviso?(mensagem: string): void;
}

/**
 * Imagem do chat em tamanho grande, por cima de tudo. Fecha com Esc, com o X ou
 * clicando fora; "Abrir no Windows" leva ao visualizador do sistema (zoom,
 * salvar, imprimir).
 */
function VisualizadorImagem(props: {
  midiaId: string;
  nome: string;
  abrindo: boolean;
  onAbrirNoWindows(): void;
  onCopiar(): void;
  onFechar(): void;
}) {
  const { midiaId, nome, abrindo, onAbrirNoWindows, onCopiar, onFechar } = props;

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onFechar();
      // Ctrl+C com a imagem aberta: copia a imagem (não há texto selecionado aqui)
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'c') {
        evento.preventDefault();
        onCopiar();
      }
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar, onCopiar]);

  // No body: um ancestral com transform/overflow do chat não prende a camada
  return createPortal(
    <div className="visualizador" role="dialog" aria-modal="true" aria-label={nome} onClick={onFechar}>
      <div className="visualizador__barra" onClick={(e) => e.stopPropagation()}>
        <span className="visualizador__nome">{nome}</span>
        <button type="button" className="botao" onClick={onCopiar} title="Copiar imagem (Ctrl+C)">
          Copiar imagem
        </button>
        <button type="button" className="botao" onClick={onAbrirNoWindows} disabled={abrindo}>
          {abrindo ? 'Abrindo...' : 'Abrir no Windows'}
        </button>
        <button type="button" className="visualizador__fechar" onClick={onFechar} title="Fechar (Esc)" autoFocus>
          <Icone nome="fechar" tamanho={20} />
        </button>
      </div>
      <img className="visualizador__imagem" src={`dpmidia://m/${midiaId}`} alt={nome} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

/**
 * Um balão da conversa. Imagem e vídeo aparecem na hora (pelo protocolo
 * dpmidia://, que usa a credencial do aplicativo); documento vira um botão que
 * baixa e abre no programa padrão do Windows.
 */
export function MensagemDaConversa(props: MensagemProps) {
  const { mensagem, minha, emGrupo, onApagar, onEncaminhar, onResponder, onIrAte, onReagir, lida, destacada, onErro, onAviso } = props;
  const [abrindo, setAbrindo] = useState(false);
  const [imagemAberta, setImagemAberta] = useState(false);

  if (mensagem.tipo === 'SISTEMA') {
    return (
      <div className="chat__aviso" id={`mensagem-${mensagem.id}`}>
        {mensagem.conteudo}
      </div>
    );
  }

  async function copiarImagem(midiaId: string) {
    const resultado = await window.dp.conversasCopiarImagem(midiaId);
    if (resultado.ok) onAviso?.(resultado.message);
    else onErro(resultado.message);
  }

  async function abrirArquivo(midiaId: string, nome: string) {
    setAbrindo(true);
    try {
      const resultado = await window.dp.conversasAbrirArquivo(midiaId, nome);
      if (!resultado.ok && resultado.message) onErro(resultado.message);
    } finally {
      setAbrindo(false);
    }
  }

  const midia = mensagem.midia;

  return (
    <div
      id={`mensagem-${mensagem.id}`}
      className={`bubble ${minha ? 'bubble--mine' : 'bubble--dp'} ${destacada ? 'bubble--destacada' : ''}`}
    >
      {!minha && emGrupo && <span className="bubble__sender">{mensagem.autorNome}</span>}
      {!minha && !emGrupo && mensagem.automatica && (
        <span className="bubble__sender">
          {mensagem.autorNome}
          <span className="bubble__auto">
            <Icone nome="robo" /> Resposta automática
          </span>
        </span>
      )}

      {mensagem.respondida && !mensagem.apagadaEm && (
        <button
          type="button"
          className="bubble__citacao"
          onClick={() => onIrAte?.(mensagem.respondida!.id)}
          title="Ir até a mensagem citada"
        >
          <span className="bubble__citacao-autor">{mensagem.respondida.autorNome}</span>
          <span className={`bubble__citacao-texto ${mensagem.respondida.apagada ? 'bubble__citacao-texto--apagada' : ''}`}>
            {mensagem.respondida.resumo}
          </span>
        </button>
      )}

      {mensagem.encaminhada && !mensagem.apagadaEm && (
        <span className="bubble__encaminhada">
          <Icone nome="encaminhar" tamanho={12} /> encaminhada
        </span>
      )}

      {mensagem.apagadaEm ? (
        <p className="bubble__text bubble__text--apagada">mensagem apagada</p>
      ) : (
        <>
          {midia?.tipo === 'IMAGEM' && (
            <button
              type="button"
              className="bubble__imagem-botao"
              onClick={() => setImagemAberta(true)}
              // Botão direito ou Ctrl+C com a imagem em foco: copia
              onContextMenu={(e) => {
                e.preventDefault();
                void copiarImagem(midia.id);
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                  e.preventDefault();
                  void copiarImagem(midia.id);
                }
              }}
              title="Abrir imagem (botão direito copia)"
            >
              <img className="bubble__imagem" src={`dpmidia://m/${midia.id}`} alt={midia.nome} />
            </button>
          )}
          {midia?.tipo === 'IMAGEM' && imagemAberta && (
            <VisualizadorImagem
              midiaId={midia.id}
              nome={midia.nome}
              abrindo={abrindo}
              onAbrirNoWindows={() => void abrirArquivo(midia.id, midia.nome)}
              onCopiar={() => void copiarImagem(midia.id)}
              onFechar={() => setImagemAberta(false)}
            />
          )}
          {midia?.tipo === 'AUDIO' && <PlayerDeAudio midia={midia} />}
          {midia?.tipo === 'VIDEO' && (
            <video className="bubble__video" src={`dpmidia://m/${midia.id}`} controls preload="metadata" />
          )}
          {midia?.tipo === 'ARQUIVO' && (
            <button
              className="bubble__arquivo"
              onClick={() => void abrirArquivo(midia.id, midia.nome)}
              disabled={abrindo}
            >
              <Icone nome="arquivo" />
              <span className="bubble__arquivo-nome">{midia.nome}</span>
              <span className="bubble__arquivo-tamanho">{tamanhoLegivel(midia.tamanho)}</span>
            </button>
          )}
          {mensagem.conteudo && (
            <p className="bubble__text">
              <TextoDaMensagem texto={mensagem.conteudo} onErro={onErro} onAviso={onErro} />
            </p>
          )}
        </>
      )}

      {!mensagem.apagadaEm && <BarraDeReacoes reacoes={mensagem.reacoes} onReagir={onReagir} />}

      <span className="bubble__meta">
        {horaDoDia(mensagem.createdAt)}
        {minha && !mensagem.apagadaEm && (
          <span className="bubble__lida" title={lida ? 'Lida' : 'Enviada'}>
            <Icone nome={lida ? 'certoDuplo' : 'certo'} tamanho={13} />
          </span>
        )}
        {!mensagem.apagadaEm && onResponder && (
          <button className="bubble__apagar" onClick={onResponder} title="Responder citando esta mensagem">
            responder
          </button>
        )}
        {!mensagem.apagadaEm && onEncaminhar && (
          <button className="bubble__apagar" onClick={onEncaminhar} title="Encaminhar para outra conversa">
            encaminhar
          </button>
        )}
        {minha && !mensagem.apagadaEm && onApagar && (
          <button className="bubble__apagar" onClick={onApagar} title="Apagar esta mensagem">
            apagar
          </button>
        )}
      </span>
    </div>
  );
}
