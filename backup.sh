#!/bin/sh
# Backup do Comunicação DP: o banco PostgreSQL e os anexos dos comunicados.
#
# O dump sai de dentro do container do banco, com o sistema no ar. Os anexos vão
# num .tar.gz separado: eles NÃO estão dentro do banco, e um backup só do dump
# deixaria os comunicados sem os arquivos.
#
#   ./backup.sh                 grava em ./backups
#   ./backup.sh /mnt/backup     grava na pasta indicada
#
# No cron (diário, 2h da manhã):
#   0 2 * * * cd /opt/comunicacao-dp && ./backup.sh >> backups/backup.log 2>&1
#
# Para restaurar um dump (apaga e recria o conteúdo do schema dp):
#   docker exec -i sistema-dp-postgres pg_restore -U sistema_dp -d sistema_dp \
#     --clean --if-exists --no-owner < backups/sistema-dp-AAAA-MM-DD_HHMM.dump
set -eu

cd "$(dirname "$0")"

DESTINO="${1:-./backups}"
DIAS_PARA_MANTER=30
CARIMBO=$(date +%Y-%m-%d_%H%M)
CONTAINER_BANCO=sistema-dp-postgres

mkdir -p "$DESTINO"

# Usuário, banco e schema vêm dos mesmos arquivos usados para subir os serviços.
# Lidos linha a linha (e não com "source"): o arquivo é configuração, não script.
ler_env() { # ler_env CHAVE ARQUIVO PADRAO
  valor=$(grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- | tr -d '
')
  [ -n "$valor" ] && echo "$valor" || echo "$3"
}
POSTGRES_USER=$(ler_env POSTGRES_USER .env.postgres sistema_dp)
POSTGRES_DB=$(ler_env POSTGRES_DB .env.postgres sistema_dp)
SCHEMA=$(ler_env DATABASE_SCHEMA .env dp)

if ! docker ps --filter status=running --format '{{.Names}}' | grep -qx "$CONTAINER_BANCO"; then
  echo "O container do banco ($CONTAINER_BANCO) não está rodando. Suba o PostgreSQL e tente de novo." >&2
  exit 1
fi

# -Fc: formato próprio do PostgreSQL, comprimido e restaurável com pg_restore
ARQUIVO_BANCO="$DESTINO/sistema-dp-$CARIMBO.dump"
docker exec -i "$CONTAINER_BANCO" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -n "$SCHEMA" -Fc > "$ARQUIVO_BANCO"

# Dump vazio ou truncado não serve como backup
if [ ! -s "$ARQUIVO_BANCO" ]; then
  echo "ERRO: o dump saiu vazio. Nada foi salvo." >&2
  rm -f "$ARQUIVO_BANCO"
  exit 1
fi
echo "Banco:  $ARQUIVO_BANCO"

# Anexos: empacotados de dentro do container do backend
if [ -n "$(docker compose ps --status running --quiet backend 2>/dev/null)" ]; then
  docker compose exec -T backend sh -c "
    if [ -n \"\$(ls -A /app/data/uploads 2>/dev/null)\" ]; then
      tar -czf /backups/anexos-$CARIMBO.tar.gz -C /app/data uploads
      echo com-anexos
    else
      echo sem-anexos
    fi
  " | grep -q com-anexos && echo "Anexos: ./backups/anexos-$CARIMBO.tar.gz" || echo "Anexos: nenhum arquivo ainda"

  # /backups dentro do container é a pasta ./backups daqui (ver docker-compose.yml)
  if [ "$(cd "$DESTINO" && pwd)" != "$(cd ./backups && pwd)" ]; then
    mv "./backups/anexos-$CARIMBO.tar.gz" "$DESTINO/" 2>/dev/null || true
  fi
else
  echo "Anexos: backend parado, anexos não copiados" >&2
fi

# ---- limpeza ----
find "$DESTINO" -maxdepth 1 -name 'sistema-dp-*.dump' -mtime "+$DIAS_PARA_MANTER" -delete
find "$DESTINO" -maxdepth 1 -name 'anexos-*.tar.gz' -mtime "+$DIAS_PARA_MANTER" -delete

echo "Backup concluído em $(date '+%d/%m/%Y %H:%M'). Cópias com mais de $DIAS_PARA_MANTER dias foram apagadas."
