/**
 * Mensagem de voz: gravar (microfone do computador) e tocar dentro da conversa.
 *
 * A gravação sai em WEBM/Opus (o formato que o Chromium grava) e sobe para o
 * servidor como as outras mídias da conversa. O celular grava em M4A/AAC; os
 * dois formatos tocam nos dois lados.
 */
import { useEffect, useRef, useState } from 'react';
import type { MidiaPublica } from '../../../shared/types';
import { Icone } from '../lib/icones';

/** Passou disso, a gravação para e é enviada sozinha */
const DURACAO_MAXIMA_MS = 15 * 60 * 1000;

/** 75000 -> "1:15" */
export function tempoLegivel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatoDeGravacao(): string {
  for (const tipo of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(tipo)) return tipo;
  }
  return '';
}

/** Mensagem de erro amigável para a falha ao abrir o microfone */
function motivoDoMicrofone(err: unknown): string {
  const nome = err instanceof DOMException ? err.name : '';
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Nenhum microfone encontrado neste computador.';
  if (nome === 'NotAllowedError' || nome === 'SecurityError') {
    return 'O Windows bloqueou o microfone. Libere em Configurações > Privacidade > Microfone.';
  }
  if (nome === 'NotReadableError') return 'O microfone está sendo usado por outro programa.';
  return 'Não foi possível usar o microfone.';
}

export type EstadoGravacao = 'parado' | 'iniciando' | 'gravando';

/**
 * Controle da gravação. terminar(true) entrega o áudio para onEnviar;
 * terminar(false) descarta.
 */
export function useGravador(onEnviar: (dados: ArrayBuffer, mimeType: string, duracaoMs: number) => void, onErro: (msg: string) => void) {
  const [estado, setEstado] = useState<EstadoGravacao>('parado');
  const [decorrido, setDecorrido] = useState(0);
  const gravador = useRef<MediaRecorder | null>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const partes = useRef<Blob[]>([]);
  const inicio = useRef(0);
  const enviarAoParar = useRef(false);
  const relogio = useRef<number | null>(null);
  // Sempre as versões atuais dos callbacks (a gravação dura mais que um render)
  const callbacks = useRef({ onEnviar, onErro });
  callbacks.current = { onEnviar, onErro };

  function soltarMicrofone() {
    if (relogio.current !== null) window.clearInterval(relogio.current);
    relogio.current = null;
    fluxo.current?.getTracks().forEach((trilha) => trilha.stop());
    fluxo.current = null;
    gravador.current = null;
  }

  async function comecar() {
    if (estado !== 'parado') return;
    setEstado('iniciando');
    try {
      const microfone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const tipo = formatoDeGravacao();
      const novo = tipo ? new MediaRecorder(microfone, { mimeType: tipo, audioBitsPerSecond: 32000 }) : new MediaRecorder(microfone);
      partes.current = [];
      novo.ondataavailable = (evento) => {
        if (evento.data.size > 0) partes.current.push(evento.data);
      };
      novo.onstop = () => {
        const duracao = Date.now() - inicio.current;
        const mimeType = (novo.mimeType || tipo || 'audio/webm').split(';')[0];
        const blob = new Blob(partes.current, { type: mimeType });
        partes.current = [];
        soltarMicrofone();
        setEstado('parado');
        setDecorrido(0);
        // Menos de meio segundo: toque sem querer no botão
        if (!enviarAoParar.current || duracao < 500 || blob.size === 0) return;
        void blob.arrayBuffer().then((dados) => callbacks.current.onEnviar(dados, mimeType, duracao));
      };
      fluxo.current = microfone;
      gravador.current = novo;
      enviarAoParar.current = false;
      inicio.current = Date.now();
      novo.start(1000);
      setDecorrido(0);
      setEstado('gravando');
      relogio.current = window.setInterval(() => {
        const passou = Date.now() - inicio.current;
        setDecorrido(passou);
        if (passou >= DURACAO_MAXIMA_MS) terminar(true);
      }, 250);
    } catch (err) {
      soltarMicrofone();
      setEstado('parado');
      callbacks.current.onErro(motivoDoMicrofone(err));
    }
  }

  function terminar(enviar: boolean) {
    const atual = gravador.current;
    if (!atual) return;
    enviarAoParar.current = enviar;
    if (atual.state !== 'inactive') atual.stop();
    else soltarMicrofone();
  }

  // Saiu da conversa no meio da gravação: descarta e libera o microfone
  useEffect(
    () => () => {
      enviarAoParar.current = false;
      if (gravador.current && gravador.current.state !== 'inactive') gravador.current.stop();
      soltarMicrofone();
    },
    [],
  );

  return { estado, decorrido, comecar, terminar };
}

/** Faixa que aparece no lugar do campo de texto enquanto grava */
export function BarraDeGravacao({ decorrido, onCancelar, onEnviar }: { decorrido: number; onCancelar: () => void; onEnviar: () => void }) {
  return (
    <div className="gravacao" role="status" aria-live="polite">
      <button type="button" className="icon-btn gravacao__cancelar" onClick={onCancelar} title="Descartar a gravação" aria-label="Descartar a gravação">
        <Icone nome="lixeira" />
      </button>
      <span className="gravacao__ponto" aria-hidden="true" />
      <span className="gravacao__tempo">Gravando {tempoLegivel(decorrido)}</span>
      <span className="gravacao__dica">Fale normalmente. Clique em Enviar quando terminar.</span>
      <button type="button" className="btn btn--primary" onClick={onEnviar} title="Parar e enviar">
        <Icone nome="enviar" /> Enviar
      </button>
    </div>
  );
}

/** Player da mensagem de voz dentro do balão */
export function PlayerDeAudio({ midia }: { midia: MidiaPublica }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [posicao, setPosicao] = useState(0);
  const [duracao, setDuracao] = useState(midia.duracaoMs ?? 0);
  const [falhou, setFalhou] = useState(false);

  function aoCarregar() {
    const segundos = audio.current?.duration;
    // O WEBM gravado pelo navegador não informa a duração (Infinity): fica a do servidor
    if (segundos && Number.isFinite(segundos)) setDuracao(segundos * 1000);
  }

  function alternar() {
    const elemento = audio.current;
    if (!elemento) return;
    if (elemento.paused) {
      // Um áudio por vez: pausa os outros balões
      document.querySelectorAll<HTMLAudioElement>('audio.player-audio__elemento').forEach((outro) => {
        if (outro !== elemento) outro.pause();
      });
      void elemento.play().catch(() => setFalhou(true));
    } else {
      elemento.pause();
    }
  }

  function arrastar(valor: number) {
    const elemento = audio.current;
    if (!elemento || !duracao) return;
    elemento.currentTime = valor / 1000;
    setPosicao(valor);
  }

  return (
    <div className="player-audio">
      <audio
        ref={audio}
        className="player-audio__elemento"
        src={`dpmidia://m/${midia.id}`}
        preload="metadata"
        onLoadedMetadata={aoCarregar}
        onDurationChange={aoCarregar}
        onPlay={() => setTocando(true)}
        onPause={() => setTocando(false)}
        onEnded={() => {
          setTocando(false);
          setPosicao(0);
        }}
        onTimeUpdate={(e) => setPosicao(e.currentTarget.currentTime * 1000)}
        onError={() => setFalhou(true)}
      />
      <button
        type="button"
        className="player-audio__botao"
        onClick={alternar}
        disabled={falhou}
        title={tocando ? 'Pausar' : 'Ouvir'}
        aria-label={tocando ? 'Pausar mensagem de voz' : 'Ouvir mensagem de voz'}
      >
        <Icone nome={tocando ? 'pausar' : 'tocar'} />
      </button>
      <input
        className="player-audio__barra"
        type="range"
        min={0}
        max={Math.max(duracao, 1)}
        step={100}
        value={Math.min(posicao, duracao || 0)}
        onChange={(e) => arrastar(Number(e.target.value))}
        disabled={falhou || !duracao}
        aria-label="Posição da mensagem de voz"
      />
      <span className="player-audio__tempo">
        {falhou ? 'não foi possível tocar' : tocando || posicao > 0 ? tempoLegivel(posicao) : tempoLegivel(duracao)}
      </span>
      <Icone nome="microfone" tamanho={14} />
    </div>
  );
}
