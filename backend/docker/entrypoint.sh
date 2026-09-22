#!/bin/sh
# Sobe o backend a partir de /app/aplicativo, que é um volume — e não de dentro
# da imagem. É isso que permite trocar a versão sem reconstruir a imagem: o
# versionador publica o pacote, o backend deixa pronto em "proximo" e sai, o
# Docker reinicia o container e a troca acontece aqui.
#
# Se a versão nova não subir (erro no código, migração quebrada, dependência
# faltando), a anterior volta sozinha na reinicialização seguinte.
#
# Reconstruir a imagem continua valendo: quando o conteúdo da imagem muda
# (docker compose build), ele passa por cima do que está no volume. Assim o
# "./dp.sh atualizar" segue funcionando como antes, inclusive para voltar a um
# estado conhecido se alguma atualização der errado.
set -eu

APP="${APP_PATH:-/app/aplicativo}"
IMAGEM=/app/imagem
PARTES="dist node_modules public package.json"

mover_partes() {
  origem="$1"
  destino="$2"
  mkdir -p "$destino"
  for parte in $PARTES; do
    if [ -e "$origem/$parte" ]; then
      rm -rf "$destino/$parte"
      mv "$origem/$parte" "$destino/"
    fi
  done
}

semear_da_imagem() {
  echo "[entrypoint] levando a versão da imagem para $APP"
  mkdir -p "$APP"
  for parte in $PARTES; do
    rm -rf "$APP/$parte"
    cp -a "$IMAGEM/$parte" "$APP/"
  done
  rm -rf "$APP/proximo" "$APP/anterior"
  rm -f "$APP/em-teste" "$APP/voltar"
  echo "$1" > "$APP/origem-imagem"
}

# Identidade do conteúdo da imagem: muda a cada "docker compose build" com código novo
marca_da_imagem() {
  find "$IMAGEM/dist" "$IMAGEM/package.json" -type f -exec sha256sum {} + | sha256sum | cut -d' ' -f1
}

marca="$(marca_da_imagem)"

if [ ! -f "$APP/dist/server.js" ]; then
  # Primeira subida: o volume está vazio
  semear_da_imagem "$marca"
elif [ "$(cat "$APP/origem-imagem" 2>/dev/null || echo '')" != "$marca" ]; then
  # A imagem foi reconstruída com código novo: ela manda
  semear_da_imagem "$marca"
fi

# Volta pendente: a versão nova não subiu na tentativa anterior
if [ -f "$APP/voltar" ]; then
  echo "[entrypoint] a versão nova não subiu: voltando para a anterior"
  rm -f "$APP/voltar" "$APP/em-teste"
  mover_partes "$APP/anterior" "$APP"
  rm -rf "$APP/anterior"
fi

# Atualização preparada pelo backend antes de sair
if [ -d "$APP/proximo" ]; then
  echo "[entrypoint] aplicando a versão preparada em $APP/proximo"
  rm -rf "$APP/anterior"
  mover_partes "$APP" "$APP/anterior"
  mover_partes "$APP/proximo" "$APP"
  rm -rf "$APP/proximo"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$APP/em-teste"
fi

cd "$APP"
node --disable-warning=ExperimentalWarning dist/server.js &
filho=$!

# "docker compose down" precisa chegar ao node, que trata SIGTERM e grava o que falta
encerrar() {
  kill -TERM "$filho" 2>/dev/null || true
  wait "$filho" 2>/dev/null || true
  exit 0
}
trap encerrar TERM INT

set +e
wait "$filho"
codigo=$?
set -e

# Caiu logo depois de uma atualização: marca a volta para a próxima subida
if [ "$codigo" -ne 0 ] && [ -f "$APP/em-teste" ] && [ -d "$APP/anterior" ]; then
  echo "[entrypoint] a versão nova saiu com código $codigo; a anterior volta na próxima subida"
  touch "$APP/voltar"
fi

exit "$codigo"
