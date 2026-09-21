/**
 * Copia os dados de um banco SQLite para o PostgreSQL.
 *
 * Uso (na pasta backend/):
 *   npm run migrar-postgres -- --sqlite ./data/sistema-dp.db
 *   npm run migrar-postgres -- --sqlite ./data/sistema-dp.db --sobrescrever
 *
 * O destino vem de DATABASE_URL (.env). O SQLite é aberto somente para leitura,
 * então o banco de origem não corre risco.
 *
 * Sem --sobrescrever, o script se recusa a rodar se o PostgreSQL já tiver dados.
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { env } from '../config/env';
import { hideCredentials } from '../database/open';
import { openPostgresDatabase, type PostgresExecutor } from '../database/postgres';

/** Ordem de cópia: uma tabela só entra depois daquelas a que ela se refere. */
const TABELAS: { nome: string; colunas: string[] }[] = [
  {
    nome: 'users',
    colunas: [
      'id', 'username', 'name', 'registration', 'sector', 'shift', 'role', 'status',
      'password_hash', 'created_at', 'must_change_password', 'chat_contact', 'super_admin',
    ],
  },
  { nome: 'sectors', colunas: ['id', 'name', 'created_at'] },
  {
    nome: 'computers',
    colunas: [
      'computer_id', 'hostname', 'app_version', 'platform', 'status',
      'registered_at', 'last_seen_at', 'secret_hash', 'current_user_id', 'current_user_since',
    ],
  },
  { nome: 'messages', colunas: ['seq', 'title', 'content', 'type', 'target', 'target_id', 'sender', 'created_at'] },
  {
    nome: 'message_reads',
    colunas: ['message_seq', 'reader_id', 'read_at', 'computer_id', 'reader_name', 'reader_registration'],
  },
  {
    nome: 'chat_messages',
    colunas: ['id', 'employee_id', 'dp_user_id', 'sender_type', 'sender_name', 'content', 'created_at', 'read_at', 'automatic'],
  },
  { nome: 'auto_replies', colunas: ['id', 'dp_user_id', 'sector', 'content', 'active', 'created_at', 'updated_at'] },
  {
    nome: 'attachments',
    colunas: ['id', 'message_seq', 'name', 'mime_type', 'size', 'kind', 'stored_name', 'uploaded_by', 'created_at'],
  },
  { nome: 'auth_tokens', colunas: ['token_hash', 'subject_type', 'subject_id', 'created_at', 'expires_at'] },
];

/** Colunas com numeração automática que precisam continuar de onde pararam */
const SEQUENCIAS: { tabela: string; coluna: string }[] = [
  { tabela: 'messages', coluna: 'seq' },
  { tabela: 'chat_messages', coluna: 'id' },
];

const LOTE = 200;

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function temFlag(nome: string): boolean {
  return process.argv.includes(`--${nome}`);
}

/** Lê todas as linhas de uma tabela do SQLite, só com as colunas que existem lá. */
function lerTabela(sqlite: DatabaseSync, nome: string, colunas: string[]): Record<string, unknown>[] {
  const existentes = new Set(
    sqlite.prepare(`PRAGMA table_info(${nome})`).all().map((c) => String((c as Record<string, unknown>).name)),
  );
  const faltando = colunas.filter((c) => !existentes.has(c));
  if (faltando.length > 0) {
    throw new Error(`A tabela ${nome} do SQLite não tem a(s) coluna(s): ${faltando.join(', ')}. Atualize o banco de origem antes de migrar.`);
  }
  return sqlite.prepare(`SELECT ${colunas.join(', ')} FROM ${nome}`).all() as Record<string, unknown>[];
}

/** Insere as linhas em lotes, com um INSERT de várias linhas por vez. */
async function inserir(tx: PostgresExecutor, tabela: string, colunas: string[], linhas: Record<string, unknown>[]): Promise<void> {
  for (let inicio = 0; inicio < linhas.length; inicio += LOTE) {
    const lote = linhas.slice(inicio, inicio + LOTE);
    const valores: unknown[] = [];
    const grupos = lote.map((linha) => {
      const marcadores = colunas.map((coluna) => {
        valores.push(linha[coluna] ?? null);
        return `$${valores.length}`;
      });
      return `(${marcadores.join(', ')})`;
    });
    await tx.run(`INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES ${grupos.join(', ')}`, valores);
  }
}

/** Computador apontando para um funcionário que não existe mais quebraria a chave estrangeira. */
function limparUsuariosInexistentes(linhas: Record<string, unknown>[], idsValidos: Set<string>): number {
  let ajustados = 0;
  for (const linha of linhas) {
    const id = linha.current_user_id;
    if (id !== null && id !== undefined && !idsValidos.has(String(id))) {
      linha.current_user_id = null;
      linha.current_user_since = null;
      ajustados += 1;
    }
  }
  return ajustados;
}

async function main(): Promise<void> {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL não está definida. Configure a conexão do PostgreSQL no .env antes de migrar.');
  }

  const origem = resolve(argumento('sqlite') ?? env.databasePath);
  const sobrescrever = temFlag('sobrescrever');
  console.log(`Origem (SQLite):  ${origem}`);
  console.log(`Destino (Postgres): ${hideCredentials(env.databaseUrl)} (schema ${env.databaseSchema})`);

  const sqlite = new DatabaseSync(origem, { readOnly: true });
  const postgres = await openPostgresDatabase(env.databaseUrl, { schema: env.databaseSchema });

  try {
    // 1. Lê tudo do SQLite antes de escrever qualquer coisa
    const dados = TABELAS.map(({ nome, colunas }) => ({ nome, colunas, linhas: lerTabela(sqlite, nome, colunas) }));

    // 2. Computadores com funcionário já excluído ficam sem ninguém logado
    const usuarios = dados.find((t) => t.nome === 'users');
    const computadores = dados.find((t) => t.nome === 'computers');
    if (usuarios && computadores) {
      const ids = new Set(usuarios.linhas.map((l) => String(l.id)));
      const ajustados = limparUsuariosInexistentes(computadores.linhas, ids);
      if (ajustados > 0) console.log(`Aviso: ${ajustados} computador(es) apontavam para funcionário inexistente; ficaram sem login ativo.`);
    }

    // 3. O destino precisa estar vazio (ou ser esvaziado de propósito)
    const ocupadas: string[] = [];
    for (const { nome } of TABELAS) {
      const row = await postgres.one(`SELECT COUNT(*) AS total FROM ${nome}`);
      if (Number(row?.total ?? 0) > 0) ocupadas.push(nome);
    }
    if (ocupadas.length > 0 && !sobrescrever) {
      throw new Error(
        `O PostgreSQL já tem dados em: ${ocupadas.join(', ')}. ` +
          'Rode de novo com --sobrescrever para apagar esses dados e importar do zero.',
      );
    }

    // 4. Copia tudo em uma transação: ou entra inteiro, ou não entra nada
    await postgres.transaction(async (tx) => {
      if (ocupadas.length > 0) {
        console.log(`Apagando dados atuais do PostgreSQL (--sobrescrever): ${ocupadas.join(', ')}`);
        await tx.run(`TRUNCATE ${TABELAS.map((t) => t.nome).join(', ')} RESTART IDENTITY CASCADE`);
      }
      for (const { nome, colunas, linhas } of dados) {
        if (linhas.length === 0) {
          console.log(`  ${nome.padEnd(15)} 0 linha(s)`);
          continue;
        }
        await inserir(tx, nome, colunas, linhas);
        console.log(`  ${nome.padEnd(15)} ${linhas.length} linha(s)`);
      }
      // Numeração automática continua depois do maior valor importado
      for (const { tabela, coluna } of SEQUENCIAS) {
        await tx.run(
          `SELECT setval(pg_get_serial_sequence('${tabela}', '${coluna}'), COALESCE((SELECT MAX(${coluna}) FROM ${tabela}), 0) + 1, false)`,
        );
      }
    });

    // 5. Confere: a contagem de cada tabela tem que bater com a origem
    console.log('\nConferência (origem -> destino):');
    let divergencias = 0;
    for (const { nome, linhas } of dados) {
      const row = await postgres.one(`SELECT COUNT(*) AS total FROM ${nome}`);
      const destino = Number(row?.total ?? 0);
      const ok = destino === linhas.length;
      if (!ok) divergencias += 1;
      console.log(`  ${ok ? 'OK  ' : 'ERRO'} ${nome.padEnd(15)} ${linhas.length} -> ${destino}`);
    }
    if (divergencias > 0) throw new Error(`${divergencias} tabela(s) com contagem diferente. Confira antes de usar este banco.`);
    console.log('\nMigração concluída.');
  } finally {
    sqlite.close();
    await postgres.close();
  }
}

main().catch((err) => {
  console.error('Falha na migração:', err instanceof Error ? err.message : err);
  process.exit(1);
});
