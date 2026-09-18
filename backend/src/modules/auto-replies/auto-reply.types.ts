export const AUTO_REPLY_CONTENT_MAX = 1000;

/** Não responde de novo se a pessoa do DP escreveu (à mão ou automático) nessa conversa há menos que isso */
export const AUTO_REPLY_COOLDOWN_MINUTES = 60;

/** Resposta automática de uma pessoa do DP para os funcionários de um setor */
export interface AutoReply {
  id: string;
  dpUserId: string;
  /** null = todos os setores (usada quando não há uma para o setor do funcionário) */
  sector: string | null;
  content: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutoReplyInput {
  sector: string | null;
  content: string;
  active: boolean;
}

/** Troca os campos do texto: {primeiro_nome}, {funcionario}, {setor}, {nome_dp} */
export function renderAutoReply(content: string, data: { employeeName: string; sector: string | null; dpName: string }): string {
  const values: Record<string, string> = {
    primeiro_nome: data.employeeName.trim().split(/\s+/)[0] ?? '',
    funcionario: data.employeeName,
    setor: data.sector ?? '',
    nome_dp: data.dpName.replace(/\s*\(DP\)\s*$/i, ''),
  };
  return content.replace(/\{(primeiro_nome|funcionario|setor|nome_dp)\}/g, (_match, key: string) => values[key] ?? '');
}
