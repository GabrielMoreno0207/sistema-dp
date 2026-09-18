/**
 * Sons de alerta gerados na hora (Web Audio), sem arquivos de áudio.
 * - normal: "plim" de três notas
 * - urgente: alarme alternado, mais longo e insistente
 */
export function playAlertSound(urgent: boolean): void {
  const ctx = new AudioContext();
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

  const totalMs = (notes.length * step + 1) * 1000;
  setTimeout(() => void ctx.close(), totalMs);
}
