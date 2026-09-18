#!/bin/sh
# Prepara e sobe o backend do Comunicação DP neste servidor Linux com Docker.
#
#   - cria o .env (com uma senha aleatória para o primeiro login) se ainda não existir
#   - cria a pasta data/ com o dono certo (uid 1000, o usuário "node" da imagem)
#   - constrói a imagem e sobe o container
#   - espera ficar saudável e mostra o endereço de acesso
#
# Uso:  ./instalar.sh
set -eu

cd "$(dirname "$0")"

azul='\033[36m'; amarelo='\033[33m'; verde='\033[32m'; normal='\033[0m'
passo() { printf "\n${azul}== %s${normal}\n" "$1"; }
aviso() { printf "${amarelo}   %s${normal}\n" "$1"; }

# ---------------------------------------------------------------- Docker
passo "Conferindo o Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker não encontrado. Instale com:  curl -fsSL https://get.docker.com | sh" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Plugin 'docker compose' não encontrado. Instale o docker-compose-plugin." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Sem permissão para falar com o Docker. Rode com sudo, ou adicione seu usuário ao grupo:" >&2
  echo "  sudo usermod -aG docker \$USER   (depois saia e entre de novo)" >&2
  exit 1
fi
echo "Docker $(docker version --format '{{.Server.Version}}') OK"

# ---------------------------------------------------------------- .env
if [ -f .env ]; then
  passo "Arquivo .env já existe: mantido como está"
else
  passo "Criando o arquivo .env"
  senha="Dp-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sed "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$senha|" .env.exemplo > .env
  chmod 600 .env
  echo "Criado: $(pwd)/.env"
fi

# ---------------------------------------------------------------- dados
passo "Preparando o volume de dados"
mkdir -p backups
echo "Banco e anexos ficam no volume do Docker \"comunicacao-dp-dados\"."
echo "Backups saem aqui em ./backups (veja o backup.sh)."

# Sobra de instalacao antiga: antes o banco ficava numa pasta do servidor, o que nao e seguro
# para SQLite (pasta compartilhada com o container nao tem as travas que ele precisa).
if [ -f data/sistema-dp.db ]; then
  echo "" >&2
  echo "ATENCAO: existe um data/sistema-dp.db de uma instalacao anterior." >&2
  echo "Agora o banco fica em um volume do Docker. Traga esse banco para o volume antes:" >&2
  echo "  docker compose build" >&2
  echo "  ./importar-banco.sh data/sistema-dp.db data/uploads" >&2
  echo "  mv data data-antiga" >&2
  echo "Depois rode o instalador de novo." >&2
  exit 1
fi

# Banco que já existe no volume (reinstalação, ou banco trazido pelo importar-banco.sh):
# nesse caso o servidor ignora o ADMIN_PASSWORD do .env, e anunciar a senha gerada enganaria.
IMAGEM="comunicacao-dp-backend:1.1.0"
banco_ja_existia=nao
if docker image inspect "$IMAGEM" >/dev/null 2>&1 && docker volume inspect comunicacao-dp-dados >/dev/null 2>&1; then
  if docker run --rm -v comunicacao-dp-dados:/app/data "$IMAGEM" test -f /app/data/sistema-dp.db >/dev/null 2>&1; then
    banco_ja_existia=sim
    echo "Já existe um banco no volume: os logins e setores dele são mantidos."
  fi
fi

# ---------------------------------------------------------------- sobe
passo "Construindo a imagem (a primeira vez demora alguns minutos)"
docker compose build

passo "Subindo o container"
docker compose up -d

passo "Esperando o backend responder"
porta=$(grep -E '^PORTA=' .env | cut -d= -f2); [ -n "$porta" ] || porta=3000
i=0
while [ $i -lt 60 ]; do
  estado=$(docker inspect -f '{{.State.Health.Status}}' comunicacao-dp 2>/dev/null || echo 'starting')
  [ "$estado" = "healthy" ] && break
  if [ "$estado" = "unhealthy" ]; then
    echo "O container subiu mas não está respondendo. Veja:  docker compose logs" >&2
    exit 1
  fi
  i=$((i + 1)); sleep 2
done
if [ "$estado" != "healthy" ]; then
  echo "O backend demorou demais para responder. Veja:  docker compose logs" >&2
  exit 1
fi

# ---------------------------------------------------------------- resumo
usuario=$(grep -E '^ADMIN_USERNAME=' .env | cut -d= -f2); [ -n "$usuario" ] || usuario=ti
senha=$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2)
ip=$(hostname -I 2>/dev/null | awk '{print $1}')

printf "\n${verde}== Pronto${normal}\n"
echo "  Central do DP : http://${ip:-localhost}:$porta/central"
if [ "$banco_ja_existia" = "sim" ]; then
  echo "  Logins        : os que já estavam no banco — as senhas continuam as mesmas"
  echo "                  Esqueceu a senha do TI?  ./dp.sh trocar-senha ti"
else
  echo "  Login         : $usuario"
  if [ -n "$senha" ]; then
    printf "  Senha         : ${amarelo}%s${normal}\n" "$senha"
    echo "                  (anote agora; a Central pede para trocar no primeiro acesso)"
  fi
fi
echo ""
echo "  Logs          : docker compose logs -f"
echo "  Situação      : docker compose ps"
echo "  Backup        : ./backup.sh  (agende no cron)"
echo "  Logins do DP  : ./dp.sh criar-login livia \"Livia Santos\" --gerar"
