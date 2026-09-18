#!/bin/sh
# Traz para o container um banco que já existe (de outro servidor, de um backup, do Windows).
#
#   ./importar-banco.sh /caminho/do/sistema-dp.db
#   ./importar-banco.sh /caminho/do/sistema-dp.db /caminho/da/pasta/uploads   (com os anexos)
#
# Por que este script existe: não basta copiar o arquivo. O SQLite grava em três arquivos —
# "sistema-dp.db" e mais "sistema-dp.db-wal" e "sistema-dp.db-shm" ao lado dele. Os dois
# auxiliares valem apenas na máquina onde foram criados; levados para outra, o servidor passa a
# ler dados antigos e as gravações somem em silêncio — e, se alguém abrir esse banco para
# escrita, o -wal que não combina é aplicado por cima e corrompe o arquivo.
#
# Aqui só o .db é usado, ele é conferido antes e depois, e o original nunca é tocado.
set -eu

cd "$(dirname "$0")"

ORIGEM="${1:-}"
ANEXOS="${2:-}"
IMAGEM="comunicacao-dp-backend:1.1.0"
VOLUME="comunicacao-dp-dados"

if [ -z "$ORIGEM" ] || [ ! -f "$ORIGEM" ]; then
  echo "Uso: ./importar-banco.sh /caminho/do/sistema-dp.db [/caminho/da/pasta/uploads]" >&2
  exit 1
fi

if [ -n "$(docker compose ps --status running --quiet backend 2>/dev/null)" ]; then
  echo "O container está rodando. Pare antes:  ./dp.sh parar" >&2
  exit 1
fi

if ! docker image inspect "$IMAGEM" >/dev/null 2>&1; then
  echo "A imagem $IMAGEM ainda não existe. Rode antes:  docker compose build" >&2
  exit 1
fi

if [ -f "$ORIGEM-wal" ] || [ -f "$ORIGEM-shm" ]; then
  echo ""
  echo "AVISO: existe um $(basename "$ORIGEM")-wal ao lado do banco de origem."
  echo "Ele NÃO será usado (aplicá-lo aqui poderia corromper o banco). Se o servidor de origem"
  echo "ainda estiver de pé, o certo é gerar lá um arquivo já consolidado e trazer esse:"
  echo "    ./backup.sh            (no Linux, com o container no ar)"
  echo "    backup-banco.cmd       (no Windows)"
  echo "Seguindo assim, o que estiver só no -wal fica para trás."
  echo ""
  printf "Continuar mesmo assim? [s/N] "
  read -r resposta
  case "$resposta" in s | S | sim | SIM) ;; *) echo "Cancelado."; exit 1 ;; esac
fi

pasta_origem=$(cd "$(dirname "$ORIGEM")" && pwd)
nome_origem=$(basename "$ORIGEM")
mkdir -p backups

# Todo o trabalho acontece dentro de um container, que enxerga o volume e tem o SQLite certo
cat > backups/.importar.js <<'JS'
const { DatabaseSync } = require('node:sqlite');
const { copyFileSync, existsSync, renameSync, rmSync, chownSync, mkdirSync } = require('node:fs');

const origem = process.argv[2];
const destino = '/app/data/sistema-dp.db';

function conferir(caminho, rotulo) {
  const db = new DatabaseSync(caminho, { readOnly: true });
  const resultado = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  if (resultado !== 'ok') {
    db.close();
    console.error(`\nO banco ${rotulo} não está íntegro: ${resultado}`);
    console.error('Não dá para importar assim. Use um backup bom, ou gere um arquivo novo na');
    console.error('máquina de origem com o backup.sh / backup-banco.cmd.');
    process.exit(1);
  }
  return db;
}

// Só o arquivo .db é copiado: sem -wal e sem -shm, não há nada pendente para aplicar
copyFileSync(origem, '/tmp/origem.db');

const db = conferir('/tmp/origem.db', 'de origem');
const contar = (sql) => db.prepare(sql).get().c;
console.log('  logins do DP :', contar("SELECT COUNT(*) c FROM users WHERE role = 'ADMIN'"));
console.log('  funcionários :', contar("SELECT COUNT(*) c FROM users WHERE role = 'EMPLOYEE'"));
console.log('  setores      :', contar('SELECT COUNT(*) c FROM sectors'));
console.log('  comunicados  :', contar('SELECT COUNT(*) c FROM messages'));
console.log('  anexos       :', contar('SELECT COUNT(*) c FROM attachments'));
console.log('  migração     :', db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v);

mkdirSync('/app/data/uploads', { recursive: true });
if (existsSync(destino)) {
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  renameSync(destino, `/backups/sistema-dp-substituido-${carimbo}.db`);
  console.log('  (o banco que estava no volume foi guardado em ./backups)');
}
for (const extra of ['-wal', '-shm']) rmSync(destino + extra, { force: true });

db.exec(`VACUUM INTO '${destino}'`);
db.close();

conferir(destino, 'importado').close();
chownSync(destino, 1000, 1000);
console.log('  integridade  : ok');
JS

montagem_anexos=""
if [ -n "$ANEXOS" ]; then
  [ -d "$ANEXOS" ] || { echo "Pasta de anexos não encontrada: $ANEXOS" >&2; exit 1; }
  montagem_anexos="-v $(cd "$ANEXOS" && pwd):/anexos:ro"
fi

# shellcheck disable=SC2086
docker run --rm --user root \
  -v "$VOLUME:/app/data" \
  -v "$pasta_origem:/entrada:ro" \
  -v "$(pwd)/backups:/backups" \
  $montagem_anexos \
  "$IMAGEM" sh -c "
    node --disable-warning=ExperimentalWarning /backups/.importar.js '/entrada/$nome_origem'
    if [ -d /anexos ]; then
      cp -r /anexos/. /app/data/uploads/
      echo \"  arquivos de anexo copiados: \$(ls -1 /app/data/uploads | wc -l)\"
    fi
    chown -R 1000:1000 /app/data
  "

rm -f backups/.importar.js

echo ""
echo "Banco importado para o volume $VOLUME."
if [ -z "$ANEXOS" ]; then
  echo "Os anexos NÃO estão dentro do banco. Se você tem a pasta uploads, rode de novo assim:"
  echo "  ./importar-banco.sh $ORIGEM /caminho/da/pasta/uploads"
fi
echo ""
echo "Agora suba com:  ./dp.sh subir"
