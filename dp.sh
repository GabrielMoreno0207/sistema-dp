#!/bin/sh
# Atalhos do dia a dia do Comunicação DP em container.
#
#   ./dp.sh criar-login livia "Livia Santos" --gerar   cria um login da Central para o DP
#   ./dp.sh criar-login ti "TI" --gerar --sem-chat     login que não aparece no chat do app
#   ./dp.sh trocar-senha ti                            troca a senha de um login
#   ./dp.sh liberar-pc PC-1A2B3C4D5E6F                 libera um PC para registrar de novo
#   ./dp.sh logs                                       acompanha os logs (Ctrl+C sai)
#   ./dp.sh status                                     situação do container e do backend
#   ./dp.sh reiniciar | parar | subir
#   ./dp.sh atualizar                                  reconstrói a imagem e sobe a versão nova
#   ./dp.sh shell                                      um shell dentro do container
set -eu

cd "$(dirname "$0")"

executar_script() {
  script="$1"; shift
  docker compose exec backend node --disable-warning=ExperimentalWarning "dist/scripts/$script" "$@"
}

comando="${1:-ajuda}"
[ $# -gt 0 ] && shift

case "$comando" in
  criar-login)
    # A senha de --gerar sai em data/credenciais-iniciais.txt (visível aqui na pasta data/)
    executar_script create-admin.js "$@"
    ;;
  trocar-senha)
    executar_script set-password.js "$@"
    ;;
  liberar-pc)
    executar_script liberar-pc.js "$@"
    ;;
  logs)
    docker compose logs -f --tail 100
    ;;
  status)
    docker compose ps
    porta=$(grep -E '^PORTA=' .env 2>/dev/null | cut -d= -f2); [ -n "${porta:-}" ] || porta=3000
    echo ""
    if docker compose exec -T backend node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      ip=$(hostname -I 2>/dev/null | awk '{print $1}')
      echo "Backend respondendo: http://${ip:-localhost}:$porta/central"
    else
      echo "Backend NÃO está respondendo. Veja:  ./dp.sh logs"
      exit 1
    fi
    ;;
  subir)
    docker compose up -d
    ;;
  parar)
    docker compose down
    ;;
  reiniciar)
    docker compose restart
    ;;
  atualizar)
    # Use depois de atualizar os arquivos do backend. Tire um backup antes.
    echo "Fazendo backup antes de atualizar..."
    ./backup.sh
    docker compose build
    docker compose up -d
    echo "Atualizado. As mudanças do banco são aplicadas sozinhas na subida."
    ;;
  shell)
    docker compose exec backend sh
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
