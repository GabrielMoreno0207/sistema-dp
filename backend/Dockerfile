# Imagem do backend do Comunicação DP.
#
# Três estágios: compila o TypeScript, resolve só as dependências de produção e monta
# uma imagem enxuta. O banco é o PostgreSQL (container próprio); em /app/data ficam os
# anexos e as mídias, em um volume: derrubar e recriar o container não perde nada.
#
# O código roda de /app/aplicativo (também um volume), e não de dentro da imagem:
# assim o versionador consegue trocar a versão do servidor sem reconstruir nada.
# A imagem guarda uma cópia em /app/imagem, usada na primeira subida e como
# ponto de partida de uma instalação nova.
#
# Build:  docker build -t comunicacao-dp-backend .
# Uso:    veja o docker-compose.yml e o README-DOCKER.md

ARG NODE_VERSION=22-alpine

# ---------------------------------------------------------------- compila o TypeScript
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------- dependências de produção
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------- imagem final
FROM node:${NODE_VERSION}

# Fuso horário do Brasil: os logs saem no horário de quem lê
# (as datas gravadas no banco continuam em UTC, como antes).
ENV TZ=America/Sao_Paulo
RUN apk add --no-cache tzdata

# Os caminhos dos dados sao absolutos de proposito: o codigo roda de
# /app/aplicativo (volume), entao um caminho relativo cairia dentro dele e nao
# no volume de dados.
ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3000 \
    UPLOADS_PATH=/app/data/uploads \
    MIDIAS_PATH=/app/data/midias \
    UPDATES_PATH=/app/data/atualizacoes \
    APP_PATH=/app/aplicativo

WORKDIR /app
# A imagem guarda uma copia em /app/imagem; o container roda o que esta no
# volume /app/aplicativo, semeado pelo entrypoint na primeira subida.
COPY --from=deps /app/node_modules /app/imagem/node_modules
COPY --from=build /app/dist /app/imagem/dist
COPY public /app/imagem/public
COPY package.json /app/imagem/
COPY docker/entrypoint.sh /app/entrypoint.sh

# O container roda como o usuário "node" (uid 1000), nunca como root
RUN chmod +x /app/entrypoint.sh \
 && mkdir -p /app/data/uploads /app/aplicativo \
 && chown -R node:node /app/data /app/aplicativo
USER node

VOLUME ["/app/data", "/app/aplicativo"]
EXPOSE 3000

# O próprio Docker avisa quando o backend para de responder
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SERVER_PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# O entrypoint troca a versão quando há uma preparada e devolve a anterior se a
# nova não subir; ele repassa o SIGTERM ao node, que encerra sem perder gravações.
ENTRYPOINT ["/app/entrypoint.sh"]
