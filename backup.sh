#!/bin/sh
# Backup do Comunicação DP: o banco e os anexos dos comunicados.
#
# O banco fica em um volume do Docker (não em uma pasta do servidor), então a cópia é feita
# de dentro do container, com VACUUM INTO — funciona com o sistema no ar e respeita as
# gravações em andamento. Os anexos vão num .tar.gz separado: eles NÃO estão dentro do banco,
# e um backup só do .db deixaria os comunicados sem os arquivos.
#
#   ./backup.sh                 grava em ./backups
#   ./backup.sh /mnt/backup     grava na pasta indicada
#
# No cron (diário, 2h da manhã):
#   0 2 * * * cd /opt/comunicacao-dp && ./backup.sh >> backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")"

DESTINO="${1:-./backups}"
DIAS_PARA_MANTER=30
CARIMBO=$(date +%Y-%m-%d_%H%M)

mkdir -p "$DESTINO"

if [ -z "$(docker compose ps --status running --quiet backend 2>/dev/null)" ]; then
  echo "O container não está rodando. Suba com './dp.sh subir' e tente de novo." >&2
  exit 1
fi

# /backups dentro do container é a pasta ./backups daqui (ver docker-compose.yml).
# Quando o destino for outro, a cópia é levada para lá no fim.
docker compose exec -T backend node --disable-warning=ExperimentalWarning -e "
  const { DatabaseSync } = require('node:sqlite');
  const destino = '/backups/sistema-dp-$CARIMBO.db';
  require('node:fs').rmSync(destino, { force: true });
  const db = new DatabaseSync(process.env.DATABASE_PATH, { readOnly: true });
  const estado = Object.values(db.prepare('PRAGMA integrity_check').get())[0];
  if (estado !== 'ok') {
    console.error('ATENÇÃO: o banco não está íntegro (' + estado + '). O backup foi gerado mesmo assim.');
  }
  db.exec(\"VACUUM INTO '\" + destino + \"'\");
  db.close();
"
echo "Banco:  ./backups/sistema-dp-$CARIMBO.db"

# Anexos: empacotados de dentro do container, direto na pasta de backups
docker compose exec -T backend sh -c "
  if [ -n \"\$(ls -A /app/data/uploads 2>/dev/null)\" ]; then
    tar -czf /backups/anexos-$CARIMBO.tar.gz -C /app/data uploads
    echo com-anexos
  else
    echo sem-anexos
  fi
" | grep -q com-anexos && echo "Anexos: ./backups/anexos-$CARIMBO.tar.gz" || echo "Anexos: nenhum arquivo ainda"

# Destino diferente de ./backups: leva os arquivos para lá
if [ "$(cd "$DESTINO" && pwd)" != "$(cd ./backups && pwd)" ]; then
  mv "./backups/sistema-dp-$CARIMBO.db" "$DESTINO/" 2>/dev/null || true
  mv "./backups/anexos-$CARIMBO.tar.gz" "$DESTINO/" 2>/dev/null || true
  echo "Movido para $DESTINO"
fi

# ---- limpeza ----
find "$DESTINO" -maxdepth 1 -name 'sistema-dp-*.db' -mtime "+$DIAS_PARA_MANTER" -delete
find "$DESTINO" -maxdepth 1 -name 'anexos-*.tar.gz' -mtime "+$DIAS_PARA_MANTER" -delete

echo "Backup concluído em $(date '+%d/%m/%Y %H:%M'). Cópias com mais de $DIAS_PARA_MANTER dias foram apagadas."
