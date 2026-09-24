#!/bin/sh
# Instala o Comunicação DP neste servidor Linux com Docker, do zero.
#
#   - cria o .env.postgres (senha aleatória) e sobe o banco PostgreSQL
#   - cria o .env do backend, já apontando para esse banco, com uma senha
#     aleatória para o primeiro login do TI (conta ti)
#   - cria o volume de dados (anexos, mídias e instaladores)
#   - constrói a imagem, sobe o container e espera ficar saudável
#   - mostra o endereço de acesso e a senha do primeiro login
#
# Rodar de novo é seguro: o que já existe é mantido (nenhuma senha é trocada,
# nenhum dado é apagado).
#
# Uso:  ./instalar.sh
set -eu

cd "$(dirname "$0")"

azul='\033[36m'; amarelo='\033[33m'; verde='\033[32m'; normal='\033[0m'
passo() { printf "\n${azul}== %s${normal}\n" "$1"; }

VOLUME_DADOS=comunicacao-dp-dados
COMPOSE_BANCO="docker compose -f docker-compose.postgres.yml --env-file .env.postgres"

# Senha só com letras e números: entra na URL de conexão sem precisar de escape
senha_aleatoria() {
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

valor_de() {
  grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-
}

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

# ---------------------------------------------------------------- banco
if [ -f .env.postgres ]; then
  passo "Arquivo .env.postgres já existe: mantido como está"
else
  passo "Criando o .env.postgres (senha do banco)"
  sed "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(senha_aleatoria)|" .env.postgres.exemplo > .env.postgres
  chmod 600 .env.postgres
  echo "Criado: $(pwd)/.env.postgres"
fi

BANCO_USUARIO=$(valor_de .env.postgres POSTGRES_USER); [ -n "$BANCO_USUARIO" ] || BANCO_USUARIO=sistema_dp
BANCO_NOME=$(valor_de .env.postgres POSTGRES_DB); [ -n "$BANCO_NOME" ] || BANCO_NOME=sistema_dp
BANCO_SENHA=$(valor_de .env.postgres POSTGRES_PASSWORD)
if [ -z "$BANCO_SENHA" ]; then
  echo "Falta POSTGRES_PASSWORD no .env.postgres. Preencha e rode de novo." >&2
  exit 1
fi

passo "Subindo o PostgreSQL"
$COMPOSE_BANCO up -d

printf "   esperando o banco aceitar conexões"
i=0
while [ $i -lt 60 ]; do
  if docker exec sistema-dp-postgres pg_isready -U "$BANCO_USUARIO" -d "$BANCO_NOME" >/dev/null 2>&1; then
    break
  fi
  printf "."
  i=$((i + 1)); sleep 2
done
printf "\n"
if ! docker exec sistema-dp-postgres pg_isready -U "$BANCO_USUARIO" -d "$BANCO_NOME" >/dev/null 2>&1; then
  echo "O banco não respondeu. Veja:  $COMPOSE_BANCO logs" >&2
  exit 1
fi
echo "PostgreSQL no ar"

# ---------------------------------------------------------------- .env do backend
# Dentro da rede do Docker o banco atende pelo nome do container, na porta 5432
# (a porta do .env.postgres é a do servidor, para acesso de fora).
CONEXAO="postgresql://$BANCO_USUARIO:$BANCO_SENHA@sistema-dp-postgres:5432/$BANCO_NOME"

if [ -f .env ]; then
  passo "Arquivo .env já existe: mantido como está"
  if grep -qE '^DATABASE_URL=.+' .env; then
    : # já está configurado; nada a fazer
  elif grep -qE '^DATABASE_URL=' .env; then
    # Linha em branco (veio do exemplo): preenche com a conexão deste servidor
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$CONEXAO|" .env
    echo "DATABASE_URL preenchido no .env"
  else
    # Instalação antiga, de antes do PostgreSQL: acrescenta a conexão
    printf '\n# Banco PostgreSQL (container sistema-dp-postgres)\nDATABASE_URL=%s\n' "$CONEXAO" >> .env
    echo "DATABASE_URL acrescentado ao .env"
  fi
else
  passo "Criando o arquivo .env"
  senha_admin="Dp-$(senha_aleatoria)"
  sed -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$senha_admin|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=$CONEXAO|" .env.exemplo > .env
  chmod 600 .env
  echo "Criado: $(pwd)/.env"
fi

# ---------------------------------------------------------------- volume de dados
passo "Preparando o volume de dados"
mkdir -p backups
if docker volume inspect "$VOLUME_DADOS" >/dev/null 2>&1; then
  echo "Volume \"$VOLUME_DADOS\" já existe: os anexos e as mídias de antes continuam lá."
else
  docker volume create "$VOLUME_DADOS" >/dev/null
  echo "Volume \"$VOLUME_DADOS\" criado."
fi
echo "Anexos, mídias e instaladores ficam nele; o banco fica no volume do PostgreSQL."
echo "Backups saem aqui em ./backups (veja o backup.sh)."

# Banco que já tem gente cadastrada: nesse caso o servidor ignora o ADMIN_PASSWORD
# do .env, e anunciar a senha gerada enganaria.
banco_ja_existia=nao
if docker exec sistema-dp-postgres psql -U "$BANCO_USUARIO" -d "$BANCO_NOME" -tAc \
     "SELECT 1 FROM information_schema.tables WHERE table_schema='dp' AND table_name='users' LIMIT 1" 2>/dev/null | grep -q 1; then
  banco_ja_existia=sim
  echo "Já existe um banco em uso: os logins e setores dele são mantidos."
fi

# ---------------------------------------------------------------- backend
passo "Construindo a imagem (a primeira vez demora alguns minutos)"
docker compose build

passo "Subindo o container"
docker compose up -d

passo "Esperando o backend responder"
porta=$(valor_de .env PORTA); [ -n "$porta" ] || porta=3000
i=0
estado=starting
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
usuario=$(valor_de .env ADMIN_USERNAME); [ -n "$usuario" ] || usuario=ti
senha=$(valor_de .env ADMIN_PASSWORD)
ip=$(hostname -I 2>/dev/null | awk '{print $1}')

printf "\n${verde}== Pronto${normal}\n"
echo "  Servidor      : http://${ip:-localhost}:$porta (use no aplicativo)"
echo "  Endereço para o aplicativo dos PCs: http://${ip:-localhost}:$porta"
if [ "$banco_ja_existia" = "sim" ]; then
  echo "  Logins        : os que já estavam no banco — as senhas continuam as mesmas"
  echo "                  Esqueceu a senha do TI?  ./dp.sh trocar-senha ti"
else
  echo "  Login         : $usuario"
  if [ -n "$senha" ]; then
    printf "  Senha         : ${amarelo}%s${normal}\n" "$senha"
    echo "                  (anote agora; o aplicativo pede para trocar no primeiro acesso)"
  fi
fi
echo ""
echo "  Logs          : docker compose logs -f"
echo "  Situação      : docker compose ps"
echo "  Backup        : ./backup.sh  (agende no cron)"
echo "  Logins do DP  : ./dp.sh criar-login livia \"Livia Santos\" --gerar"
echo ""
echo "  Libere a porta $porta no firewall para os computadores da fábrica alcançarem o servidor."
