/**
 * Gera o pacote do servidor que o versionador publica.
 *
 *   npm run empacotar
 *
 * O pacote é um .tar.gz com o que o backend precisa para rodar: o código já
 * compilado (dist), a pasta public (hoje só um aviso; a atualização confere que ela exista), o package.json e as dependências de
 * produção. Nada de TypeScript, teste ou ferramenta de desenvolvimento.
 *
 * Sai em backend/publicar/servidor-<versao>.tar.gz. A versão é a do
 * package.json — suba esse número antes de publicar, como no desktop.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifesto = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf-8'));
const versao = manifesto.version;

if (!/^\d+\.\d+\.\d+$/.test(versao)) {
  console.error(`Versão inválida no package.json: "${versao}". Use x.y.z.`);
  process.exit(1);
}

const saida = join(raiz, 'publicar');
const preparo = join(saida, `servidor-${versao}`);
const pacote = join(saida, `servidor-${versao}.tar.gz`);

function passo(texto) {
  console.log(`\n== ${texto}`);
}

function rodar(comando, argumentos, cwd = raiz) {
  execFileSync(comando, argumentos, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

passo('Compilando o TypeScript');
rodar('npm', ['run', 'build']);

passo('Preparando a pasta do pacote');
rmSync(preparo, { recursive: true, force: true });
mkdirSync(preparo, { recursive: true });
cpSync(join(raiz, 'dist'), join(preparo, 'dist'), { recursive: true });
cpSync(join(raiz, 'public'), join(preparo, 'public'), { recursive: true });
cpSync(join(raiz, 'package.json'), join(preparo, 'package.json'));
cpSync(join(raiz, 'package-lock.json'), join(preparo, 'package-lock.json'));

passo('Instalando só as dependências de produção');
rodar('npm', ['ci', '--omit=dev', '--ignore-scripts'], preparo);
// O lock não precisa ir junto: já cumpriu o papel aqui
rmSync(join(preparo, 'package-lock.json'), { force: true });

passo('Compactando');
rmSync(pacote, { force: true });
// Caminhos relativos e rodando de dentro da pasta: o tar do Git no Windows
// entende "C:\..." como se fosse um servidor remoto e falha.
rodar('tar', ['-czf', `../servidor-${versao}.tar.gz`, 'dist', 'node_modules', 'public', 'package.json'], preparo);
rmSync(preparo, { recursive: true, force: true });

if (!existsSync(pacote)) {
  console.error('O pacote não foi gerado.');
  process.exit(1);
}

const tamanho = statSync(pacote).size;
writeFileSync(
  join(saida, 'LEIA-ME.txt'),
  [
    'Pacote do servidor (backend) do Comunica Trinys.',
    '',
    `Versão: ${versao}`,
    `Arquivo: servidor-${versao}.tar.gz`,
    '',
    'Publique pelo versionador, na aba [ backend ]. Ao publicar, o servidor',
    'aplica na hora: ele troca os arquivos e reinicia (parada de alguns segundos).',
    'Se a versão nova não subir, a anterior volta sozinha.',
    '',
  ].join('\n'),
  'utf-8',
);

passo('Pronto');
console.log(`${pacote}`);
console.log(`${(tamanho / 1024 / 1024).toFixed(1)} MB`);
