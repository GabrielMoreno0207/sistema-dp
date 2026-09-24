/**
 * Sons de alerta gerados na hora (Web Audio), sem arquivos de áudio.
 * - normal: "plim" de três notas
 * - urgente: alarme alternado, mais longo e insistente
 *
 * Um contexto só, reaproveitado. O Chromium limita quantos contextos de áudio
 * existem por janela (uns 6): criar um a cada alerta acabava estourando o limite
 * e o erro subia pelo React, deixando o alerta sem reagir a clique.
 */
let contexto: AudioContext | null = null;

function contextoDeAudio(): AudioContext | null {
  try {
    if (!contexto || contexto.state === 'closed') contexto = new AudioContext();
    // O Windows suspende o contexto quando não há som há um tempo
    if (contexto.state === 'suspended') void contexto.resume();
    return contexto;
  } catch (err) {
    console.warn('[som] áudio indisponível neste computador:', err);
    contexto = null;
    return null;
  }
}

export function playAlertSound(urgent: boolean): void {
  try {
    tocar(urgent);
  } catch (err) {
    // Sem placa de som, saída ocupada ou política do Windows: o alerta continua
    // aparecendo na tela, que é o que importa
    console.warn('[som] não foi possível tocar o alerta:', err);
  }
}

function tocar(urgent: boolean): void {
  const ctx = contextoDeAudio();
  if (!ctx) return;
  const notes = urgent ? [988, 740, 988, 740, 988, 740, 988, 740] : [660, 880, 1320];
  const step = urgent ? 0.2 : 0.15;
  const volume = urgent ? 0.22 : 0.3;

  notes.forEach((frequency, i) => {
    const start = ctx.currentTime + i * step;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = urgent ? 'square' : 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + step * (urgent ? 0.95 : 2.5));
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + step * 3);
  });
}
