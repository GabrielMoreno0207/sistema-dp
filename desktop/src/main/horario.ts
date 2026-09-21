/** Cálculo do próximo horário diário. Sem Electron, para poder ser testado sozinho. */

const DIA_MS = 24 * 60 * 60_000;

/**
 * Quantos milissegundos faltam para o próximo "HH:MM".
 * Se o horário de hoje já passou (ou é agora), aponta para o de amanhã.
 */
export function msAteHorario(horario: string, agora = new Date()): number {
  const [hora, minuto] = horario.split(':').map(Number);
  if (!Number.isInteger(hora) || !Number.isInteger(minuto) || hora > 23 || minuto > 59) {
    throw new Error(`Horário inválido: "${horario}". Use HH:MM, por exemplo 03:00.`);
  }
  const alvo = new Date(agora);
  alvo.setHours(hora, minuto, 0, 0);
  if (alvo.getTime() <= agora.getTime()) alvo.setTime(alvo.getTime() + DIA_MS);
  return alvo.getTime() - agora.getTime();
}

/** "03:00" em texto amigável para o log. */
export function horarioValido(horario: string | undefined): string | null {
  if (!horario) return null;
  try {
    msAteHorario(horario);
    return horario;
  } catch {
    return null;
  }
}
