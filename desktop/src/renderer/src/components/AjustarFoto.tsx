import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';

/** Tamanho do círculo na tela, em px */
const VISOR = 260;
/** Lado do JPEG enviado ao servidor */
const SAIDA = 512;
const ZOOM_MAX = 4;

interface Posicao {
  x: number;
  y: number;
}

interface AjustarFotoProps {
  /** Já tem foto: abre com ela para enquadrar de novo; senão, abre direto o seletor */
  temFoto: boolean;
  onFechar(): void;
}

/**
 * Enquadramento da foto de perfil: a pessoa arrasta a imagem dentro do círculo
 * e aproxima com o controle (ou a rodinha do mouse). Só o recorte quadrado vai
 * para o servidor, então a foto aparece igual em todo lugar.
 */
export function AjustarFoto({ temFoto, onFechar }: AjustarFotoProps) {
  const [imagem, setImagem] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Posicao>({ x: 0, y: 0 });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const arrasto = useRef<{ inicioX: number; inicioY: number; pos: Posicao } | null>(null);

  // Escala que faz a imagem cobrir o círculo inteiro no zoom 1
  const base = imagem ? Math.max(VISOR / imagem.naturalWidth, VISOR / imagem.naturalHeight) : 1;
  const largura = imagem ? imagem.naturalWidth * base * zoom : 0;
  const altura = imagem ? imagem.naturalHeight * base * zoom : 0;

  /** Não deixa sobrar espaço vazio dentro do círculo. */
  const limitar = useCallback(
    (p: Posicao, z: number): Posicao => {
      if (!imagem) return p;
      const maxX = Math.max((imagem.naturalWidth * base * z - VISOR) / 2, 0);
      const maxY = Math.max((imagem.naturalHeight * base * z - VISOR) / 2, 0);
      return { x: Math.min(Math.max(p.x, -maxX), maxX), y: Math.min(Math.max(p.y, -maxY), maxY) };
    },
    [imagem, base],
  );

  const carregar = useCallback(
    async (resposta: Promise<{ ok: boolean; dataUrl: string | null; message: string }>, fecharSeNada: boolean) => {
      setErro('');
      const { ok, dataUrl, message } = await resposta;
      if (!ok || !dataUrl) {
        if (message) setErro(message);
        else if (fecharSeNada) onFechar(); // cancelou o seletor sem ter o que mostrar
        return;
      }
      const nova = new Image();
      nova.onload = () => {
        setImagem(nova);
        setZoom(1);
        setPos({ x: 0, y: 0 });
      };
      nova.onerror = () => setErro('Não foi possível abrir essa imagem.');
      nova.src = dataUrl;
    },
    [onFechar],
  );

  useEffect(() => {
    void carregar(temFoto ? window.dp.fotoAtual() : window.dp.escolherFoto(), true);
    // Só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function tecla(evento: globalThis.KeyboardEvent) {
      if (evento.key === 'Escape' && !ocupado) onFechar();
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [ocupado, onFechar]);

  function mudarZoom(novo: number) {
    const z = Math.min(Math.max(novo, 1), ZOOM_MAX);
    setZoom(z);
    setPos((atual) => limitar(atual, z));
  }

  function comecarArrasto(evento: PointerEvent<HTMLDivElement>) {
    if (!imagem) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrasto.current = { inicioX: evento.clientX, inicioY: evento.clientY, pos };
  }

  function arrastar(evento: PointerEvent<HTMLDivElement>) {
    const atual = arrasto.current;
    if (!atual) return;
    setPos(
      limitar({ x: atual.pos.x + evento.clientX - atual.inicioX, y: atual.pos.y + evento.clientY - atual.inicioY }, zoom),
    );
  }

  function rodinha(evento: WheelEvent<HTMLDivElement>) {
    if (imagem) mudarZoom(zoom - Math.sign(evento.deltaY) * 0.15);
  }

  /** Setas mexem a foto; + e - aproximam (quem não usa o mouse também enquadra). */
  function teclado(evento: KeyboardEvent<HTMLDivElement>) {
    const passo = evento.shiftKey ? 40 : 10;
    const movimentos: Record<string, Posicao> = {
      ArrowLeft: { x: passo, y: 0 },
      ArrowRight: { x: -passo, y: 0 },
      ArrowUp: { x: 0, y: passo },
      ArrowDown: { x: 0, y: -passo },
    };
    const mov = movimentos[evento.key];
    if (mov) {
      evento.preventDefault();
      setPos((atual) => limitar({ x: atual.x + mov.x, y: atual.y + mov.y }, zoom));
    } else if (evento.key === '+' || evento.key === '=') {
      mudarZoom(zoom + 0.15);
    } else if (evento.key === '-') {
      mudarZoom(zoom - 0.15);
    }
  }

  async function salvar() {
    if (!imagem) return;
    setOcupado(true);
    setErro('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SAIDA;
      canvas.height = SAIDA;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('sem canvas');
      const k = SAIDA / VISOR;
      // Fundo branco: PNG com transparência não vira preto no JPEG
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, SAIDA, SAIDA);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imagem, (VISOR / 2 - largura / 2 + pos.x) * k, (VISOR / 2 - altura / 2 + pos.y) * k, largura * k, altura * k);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (!blob) throw new Error('sem blob');
      const resultado = await window.dp.salvarFoto(new Uint8Array(await blob.arrayBuffer()));
      if (!resultado.ok) {
        setErro(resultado.message || 'Não foi possível salvar a foto.');
        return;
      }
      onFechar();
    } catch (err) {
      console.error('[foto] falha ao recortar:', err);
      setErro('Não foi possível preparar a foto.');
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    setOcupado(true);
    const resultado = await window.dp.removerFoto();
    setOcupado(false);
    if (resultado.ok) onFechar();
    else setErro(resultado.message || 'Não foi possível remover a foto.');
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Foto de perfil" onClick={() => !ocupado && onFechar()}>
      <div className="modal__caixa modal__caixa--estreita ajustar-foto" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__titulo">Foto de perfil</h2>
        <p className="ajustar-foto__dica">Arraste a foto para escolher a parte que aparece. Use o controle para aproximar.</p>

        <div
          className={`ajustar-foto__visor ${imagem ? '' : 'ajustar-foto__visor--vazio'}`}
          style={{ width: VISOR, height: VISOR }}
          onPointerDown={comecarArrasto}
          onPointerMove={arrastar}
          onPointerUp={() => (arrasto.current = null)}
          onPointerCancel={() => (arrasto.current = null)}
          onWheel={rodinha}
          onKeyDown={teclado}
          tabIndex={imagem ? 0 : -1}
          aria-label="Enquadramento: setas movem a foto, + e - aproximam"
        >
          {imagem ? (
            <img
              src={imagem.src}
              alt=""
              draggable={false}
              style={{
                width: largura,
                height: altura,
                left: VISOR / 2 - largura / 2 + pos.x,
                top: VISOR / 2 - altura / 2 + pos.y,
              }}
            />
          ) : (
            <span>{erro ? 'Sem imagem' : 'Carregando...'}</span>
          )}
        </div>

        <label className="ajustar-foto__zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={ZOOM_MAX}
            step={0.01}
            value={zoom}
            disabled={!imagem}
            onChange={(e) => mudarZoom(Number(e.target.value))}
          />
        </label>

        {erro && <p className="erro-login">{erro}</p>}

        <div className="modal__rodape">
          <button className="botao" onClick={() => void carregar(window.dp.escolherFoto(), false)} disabled={ocupado}>
            Outra foto
          </button>
          {temFoto && (
            <button className="botao botao--perigo" onClick={() => void remover()} disabled={ocupado}>
              Remover
            </button>
          )}
          <span className="modal__espaco" />
          <button className="botao" onClick={onFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button className="botao botao--primario" onClick={() => void salvar()} disabled={!imagem || ocupado}>
            {ocupado ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
