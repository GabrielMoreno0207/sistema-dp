/**
 * Acesso administrativo pelo setor do funcionário.
 *
 * Quem trabalha no Departamento Pessoal ou no TI não precisa de um login à
 * parte: entrando no aplicativo com o usuário, o setor já dá o acesso.
 *   - setor do DP -> telas do Departamento Pessoal (comunicados, mural, cadastros, ajustes)
 *   - setor do TI -> as mesmas, mais os poderes do TI (apagar, auditar, gerenciar logins)
 *
 * A comparação ignora maiúsculas, acentos e pontuação, então "T.I.", "ti" e
 * "Tecnologia da Informação" valem igual. Qualquer outro nome não dá acesso
 * nenhum — é preciso ser um dos nomes desta lista.
 */
export type AcessoAdmin = 'NENHUM' | 'DP' | 'TI';

/** Tira acentos, pontuação e espaços: "T.I." e "Tecnologia da Informação" viram "ti" e "tecnologiadainformacao". */
function simplificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Nomes de setor que dão acesso às telas do Departamento Pessoal */
export const SETORES_DP = ['DP', 'Departamento Pessoal', 'Departamento de Pessoal', 'Depto Pessoal'];

/** Nomes de setor que dão acesso de TI (tudo o que o DP faz, mais os poderes do TI) */
export const SETORES_TI = ['TI', 'T.I.', 'Tecnologia da Informação', 'Tecnologia de Informação', 'Informática'];

const DP = new Set(SETORES_DP.map(simplificar));
const TI = new Set(SETORES_TI.map(simplificar));

/** Que acesso este setor dá. Setor em branco ou fora da lista: nenhum. */
export function acessoDoSetor(setor: string | null | undefined): AcessoAdmin {
  if (!setor) return 'NENHUM';
  const chave = simplificar(setor);
  if (TI.has(chave)) return 'TI';
  if (DP.has(chave)) return 'DP';
  return 'NENHUM';
}
