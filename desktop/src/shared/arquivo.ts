/**
 * Nome do arquivo sem a pasta de onde ele veio.
 *
 * Quem envia o comunicado escolhe o arquivo no próprio computador, e o caminho
 * completo ("C:\\Users\\Carol\\Downloads\\foto.jpeg") não diz nada para quem
 * recebe — além de expor a pasta de quem mandou. Aqui fica só "foto.jpeg".
 *
 * Trata os dois separadores: a barra invertida do Windows e a barra normal, que
 * aparece quando o arquivo vem do Linux ou de um caminho montado em rede.
 */
export function nomeDeArquivo(caminho: string): string {
  const semPasta = caminho.split(/[\\/]/).pop()?.trim();
  return semPasta && semPasta.length > 0 ? semPasta : 'arquivo';
}
