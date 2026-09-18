# Imagem do backend do Comunicação DP.
#
# Três estágios: compila o TypeScript, resolve só as dependências de produção e monta
# uma imagem enxuta. O banco (SQLite) e os anexos ficam em /app/data, que é um volume:
# derrubar e recriar o container não perde nada.
#
# Build:  docker build -t comunicacao-dp-backend .
# Uso:    veja o docker-compose.yml e o README-DOCKER.md

# Node 22: o backend usa o módulo nativo node:sqlite, que exige 22.13 ou superior.
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

ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3000 \
    DATABASE_PATH=/app/data/sistema-dp.db \
    UPLOADS_PATH=/app/data/uploads

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY package.json ./

# O container roda como o usuário "node" (uid 1000), nunca como root
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node

VOLUME ["/app/data"]
EXPOSE 3000

# O próprio Docker avisa quando o backend para de responder
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SERVER_PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# server.ts trata SIGTERM/SIGINT: "docker compose down" encerra sem perder gravações
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
