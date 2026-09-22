import { useState } from 'react';
import type { MensagemConversa } from '../../../shared/types';

/** "Ana Paula" → "AP"; "Livia (DP)" → "L" */
export function iniciais(nome: string): string {
  const palavras = nome
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (palavras.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
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
  onErro(mensagem: string): void;
}

/**
 * Um balão da conversa. Imagem e vídeo aparecem na hora (pelo protocolo
 * dpmidia://, que usa a credencial do aplicativo); documento vira um botão que
 * baixa e abre no programa padrão do Windows.
 */
export function MensagemDaConversa({ mensagem, minha, emGrupo, onApagar, onErro }: MensagemProps) {
  const [abrindo, setAbrindo] = useState(false);

  if (mensagem.tipo === 'SISTEMA') {
    return <div className="chat__aviso">{mensagem.conteudo}</div>;
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
    <div className={`bubble ${minha ? 'bubble--mine' : 'bubble--dp'}`}>
      {!minha && emGrupo && <span className="bubble__sender">{mensagem.autorNome}</span>}
      {!minha && !emGrupo && mensagem.automatica && (
        <span className="bubble__sender">
          {mensagem.autorNome}
          <span className="bubble__auto">🤖 Resposta automática</span>
        </span>
      )}

      {mensagem.apagadaEm ? (
        <p className="bubble__text bubble__text--apagada">mensagem apagada</p>
      ) : (
        <>
          {midia?.tipo === 'IMAGEM' && (
            <img className="bubble__imagem" src={`dpmidia://m/${midia.id}`} alt={midia.nome} />
          )}
          {midia?.tipo === 'VIDEO' && (
            <video className="bubble__video" src={`dpmidia://m/${midia.id}`} controls preload="metadata" />
          )}
          {midia?.tipo === 'ARQUIVO' && (
            <button
              className="bubble__arquivo"
              onClick={() => void abrirArquivo(midia.id, midia.nome)}
              disabled={abrindo}
            >
              <span aria-hidden>📄</span>
              <span className="bubble__arquivo-nome">{midia.nome}</span>
              <span className="bubble__arquivo-tamanho">{tamanhoLegivel(midia.tamanho)}</span>
            </button>
          )}
          {mensagem.conteudo && <p className="bubble__text">{mensagem.conteudo}</p>}
        </>
      )}

      <span className="bubble__meta">
        {horaDoDia(mensagem.createdAt)}
        {minha && !mensagem.apagadaEm && onApagar && (
          <button className="bubble__apagar" onClick={onApagar} title="Apagar esta mensagem">
            apagar
          </button>
        )}
      </span>
    </div>
  );
}
