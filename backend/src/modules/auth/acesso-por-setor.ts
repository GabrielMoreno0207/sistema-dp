/**
 * Acesso administrativo pelo setor do funcionário.
 *
 * Quem trabalha no RH ou no TI não precisa de um login à parte: entrando no
 * aplicativo com o usuário, o setor já dá o acesso.
 *   - setor do RH -> telas do RH (comunicados, mural, cadastros, ajustes)
 *   - setor do TI -> as mesmas, mais os poderes do TI (apagar, auditar, gerenciar logins)
 *
 * O valor 'DP' devolvido aqui é só o identificador interno, guardado no banco
 * e em uso em todo o sistema; quem lê a tela vê "RH".
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

/**
 * Nomes de setor que dão acesso às telas do RH.
 *
 * O RH substituiu o Departamento Pessoal e herdou os mesmos poderes; o setor DP
 * deixa de existir. Os nomes antigos seguem aceitos só como ponte: entre o
 * servidor subir e o cadastro de cada pessoa ser trocado no banco há uma janela
 * em que quem ainda está como "Departamento Pessoal" não pode perder o acesso.
 * Depois de conferir que ninguém está mais nesses setores, apague as 4 últimas
 * linhas da lista.
 */
export const SETORES_RH = [
  'RH',
  'R.H.',
  'Recursos Humanos',
  'Depto Recursos Humanos',
  'Departamento de Recursos Humanos',
  // nomes antigos, de antes da troca para RH
  'DP',
  'Departamento Pessoal',
  'Departamento de Pessoal',
  'Depto Pessoal',
];

/** Nomes de setor que dão acesso de TI (tudo o que o DP faz, mais os poderes do TI) */
export const SETORES_TI = ['TI', 'T.I.', 'Tecnologia da Informação', 'Tecnologia de Informação', 'Informática'];

const RH = new Set(SETORES_RH.map(simplificar));
const TI = new Set(SETORES_TI.map(simplificar));

/** Que acesso este setor dá. Setor em branco ou fora da lista: nenhum. */
export function acessoDoSetor(setor: string | null | undefined): AcessoAdmin {
  if (!setor) return 'NENHUM';
  const chave = simplificar(setor);
  if (TI.has(chave)) return 'TI';
  if (RH.has(chave)) return 'DP';
  return 'NENHUM';
}
