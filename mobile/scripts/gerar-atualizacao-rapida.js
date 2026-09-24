/**
 * Gera o pacote da atualização rápida (só o JavaScript, sem APK):
 *   dist/ComunicacaoDP-rapida-<versao>.zip
 * Publique no versionador, aba [ mobile ota ]. Os celulares com o mesmo
 * otaRuntime aplicam com "Buscar atualizações" (o app fecha e abre de novo).
 *
 * Uso: node scripts/gerar-atualizacao-rapida.js   (ou gerar-atualizacao-rapida.cmd)
 *
 * A versão vem do package.json ("version") e precisa ser maior que a do APK
 * (android/app/build.gradle -> versionName). Mudou algo nativo (Kotlin,
 * permissão, biblioteca nativa)? Isso não vai por aqui: suba o otaRuntime e gere APK.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const raiz = path.resolve(__dirname, '..');
const pacote = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf-8'));
const versao = String(pacote.version);
const runtime = Number(pacote.otaRuntime ?? 1);

function maior(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

const gradle = fs.readFileSync(path.join(raiz, 'android', 'app', 'build.gradle'), 'utf-8');
const versaoApk = (gradle.match(/versionName\s+"([^"]+)"/) ?? [])[1];
if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(versao)) sair(`Versão inválida no package.json: ${versao}`);
if (versaoApk && !maior(versao, versaoApk)) {
  sair(`A versão do package.json (${versao}) precisa ser maior que a do APK (${versaoApk}).`);
}

const trabalho = path.join(raiz, 'build', 'atualizacao-rapida');
const conteudo = path.join(trabalho, 'pacote');
fs.rmSync(trabalho, { recursive: true, force: true });
fs.mkdirSync(conteudo, { recursive: true });

console.log(`Gerando o JavaScript da versão ${versao} (runtime ${runtime})...`);
const js = path.join(trabalho, 'index.android.js');
execFileSync(
  process.execPath,
  [
    path.join(raiz, 'node_modules', 'react-native', 'cli.js'),
    'bundle',
    '--platform', 'android',
    '--dev', 'false',
    '--reset-cache',
    '--entry-file', 'index.js',
    '--bundle-output', js,
    '--assets-dest', conteudo,
  ],
  { cwd: raiz, stdio: 'inherit' },
);

// Mesmo formato do APK: bytecode do Hermes (abre mais rápido que JavaScript puro)
console.log('Compilando para o Hermes...');
const hermesc = path.join(raiz, 'node_modules', 'hermes-compiler', 'hermesc', 'win64-bin', 'hermesc.exe');
execFileSync(hermesc, ['-emit-binary', '-O', '-max-diagnostic-width=80', '-out', path.join(conteudo, 'index.android.bundle'), js], {
  stdio: 'inherit',
});

fs.writeFileSync(path.join(conteudo, 'ota.json'), JSON.stringify({ versao, runtime, geradoEm: new Date().toISOString() }, null, 2));

const destino = path.join(raiz, 'dist', `ComunicacaoDP-rapida-${versao}.zip`);
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, zipar(conteudo));
console.log(`\nPronto: ${destino} (${(fs.statSync(destino).size / 1024).toFixed(0)} KB)`);
console.log('Publique no versionador, aba [ mobile ota ].');

function sair(msg) {
  console.error(msg);
  process.exit(1);
}

/** Todos os arquivos da pasta, com caminho relativo usando "/" */
function listar(pasta, prefixo = '') {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((item) => {
    const relativo = prefixo + item.name;
    return item.isDirectory() ? listar(path.join(pasta, item.name), `${relativo}/`) : [relativo];
  });
}

/** .zip simples (deflate), lido pelo java.util.zip do Android */
function zipar(pasta) {
  const partes = [];
  const central = [];
  let posicao = 0;
  for (const nome of listar(pasta).sort()) {
    const dados = fs.readFileSync(path.join(pasta, nome));
    const comprimido = zlib.deflateRawSync(dados, { level: 9 });
    const crc = zlib.crc32(dados);
    const nomeBuf = Buffer.from(nome, 'utf-8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    partes.push(local, nomeBuf, comprimido);

    const cabecalho = Buffer.alloc(46);
    cabecalho.writeUInt32LE(0x02014b50, 0);
    cabecalho.writeUInt16LE(20, 4);
    cabecalho.writeUInt16LE(20, 6);
    cabecalho.writeUInt16LE(0x0800, 8);
    cabecalho.writeUInt16LE(8, 10);
    cabecalho.writeUInt32LE(crc, 16);
    cabecalho.writeUInt32LE(comprimido.length, 20);
    cabecalho.writeUInt32LE(dados.length, 24);
    cabecalho.writeUInt16LE(nomeBuf.length, 28);
    cabecalho.writeUInt32LE(posicao, 42);
    central.push(cabecalho, nomeBuf);

    posicao += local.length + nomeBuf.length + comprimido.length;
  }
  const tamanhoCentral = central.reduce((t, b) => t + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(central.length / 2, 8);
  fim.writeUInt16LE(central.length / 2, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(posicao, 16);
  return Buffer.concat([...partes, ...central, fim]);
}
