/**
 * Leitura de senha no terminal, usada pelos scripts create-admin e set-password.
 * - No terminal: o que é digitado não aparece na tela.
 * - Com entrada redirecionada (pipe/arquivo, para automação): cada pergunta consome uma linha.
 */

let pipedLines: string[] | null = null;

async function readPipedLines(): Promise<string[]> {
  if (pipedLines) return pipedLines;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  pipedLines = Buffer.concat(chunks).toString('utf-8').split(/\r?\n/);
  return pipedLines;
}

export async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);

  if (!process.stdin.isTTY) {
    const lines = await readPipedLines();
    process.stdout.write('\n');
    return lines.shift() ?? '';
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    const onData = (char: string) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '') {
        stdin.setRawMode(false);
        stdin.off('data', onData);
        reject(new Error('Cancelado'));
      } else if (char === '' || char === '') {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}
