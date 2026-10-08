// ---------------------------------------------------------------------------
// Gera o hash de uma senha no mesmo formato que o backend guarda em
// users.password_hash (scrypt, ver src/modules/auth/crypto.ts).
//
// Serve para o cadastrar-funcionarios-em-massa.sql: o SQL nao sabe calcular
// scrypt, entao o hash tem que vir pronto.
//
// Uso:  node scripts/gerar-hash-senha.mjs "senha-que-vai-ser-entregue"
// ---------------------------------------------------------------------------
import { randomBytes, scryptSync } from 'node:crypto';

const senha = process.argv[2];
if (!senha || senha.length < 8) {
  console.error('Passe a senha (no minimo 8 caracteres): node scripts/gerar-hash-senha.mjs "senha"');
  process.exit(1);
}

// Os mesmos parametros do backend: mudar qualquer um aqui invalida o login.
const N = 16384;
const r = 8;
const p = 1;
const sal = randomBytes(16);
const hash = scryptSync(senha, sal, 64, { N, r, p });

console.log(`scrypt$${N}$${r}$${p}$${sal.toString('base64')}$${hash.toString('base64')}`);
