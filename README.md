# Comunicação DP

Sistema de comunicação interna do Departamento Pessoal com os computadores da fábrica (Windows).

```
DP (Central do DP, no navegador)
  ↓  POST /api/messages
Backend (Node + Fastify + SQLite)  ── servidor interno da empresa
  ↓  WebSocket (Socket.IO)
Computadores dos funcionários (app Electron na bandeja)
  ↓
Alerta na tela com som → funcionário abre → backend registra a leitura
```

São dois projetos **independentes**:

| Pasta | O que é | Documentação |
|---|---|---|
| [`backend/`](backend/README.md) | API REST + WebSocket + banco + **Central do DP** (`/central`) | [backend/README.md](backend/README.md) |
| [`desktop/`](desktop/README.md) | Aplicativo Windows "Comunicação DP" | [desktop/README.md](desktop/README.md) |

## Colocar o backend no ar

| Onde | Como | Documentação |
|---|---|---|
| Servidor **Linux** com Docker | `./instalar.sh` (constrói a imagem e sobe o container) | [README-DOCKER.md](README-DOCKER.md) |
| Servidor **Windows** | Pacote em `publicar/comunicacao-dp-backend/`, já com o Node dentro | `publicar/comunicacao-dp-backend/README-INSTALACAO.md` |

Os pacotes prontos para copiar ficam em `publicar/` (`comunicacao-dp-docker.tar.gz` para Linux,
`comunicacao-dp-backend.zip` para Windows).

## Testar neste PC (duplo clique)

Pré-requisito: [Node.js 22 LTS](https://nodejs.org).

| Arquivo | O que faz |
|---|---|
| `1-iniciar-servidor-teste.cmd` | Instala o que falta, cria `backend\.env` com chave e senha aleatórias, **cria o banco** e inicia o servidor de teste. Mostra o usuário e a senha do DP e abre a Central no navegador. Deixe essa janela aberta. Para começar do zero: `1-iniciar-servidor-teste.cmd -ZerarBanco` |
| `2-abrir-app-desktop-teste.cmd` | Abre o app "Comunicação DP" já configurado para o servidor de teste |
| `3-rodar-testes.cmd` | Roda os testes automatizados da API (banco temporário) e a checagem de tipos |

> O app de teste (passo 2) guarda os dados em `%APPDATA%\Comunicação DP-dev`, separado do aplicativo instalado. Os dois podem ficar abertos ao mesmo tempo, e o teste não mexe nas configurações do app instalado.

Roteiro de teste:
1. Rode o **1**. A Central abre em `http://localhost:3000/central`; entre com o usuário e a senha mostrados na janela.
2. Rode o **2**. O app abre e mostra 🟢 Conectado.
3. Na Central, envie uma mensagem. O alerta aparece no canto da tela com som, e a mensagem entra na lista do app.

## Começo rápido (desenvolvimento)

```powershell
# 1) Backend
cd backend
npm install
Copy-Item .env.example .env   # edite a senha do DP
npm run dev

# 2) Desktop (outro terminal)
cd desktop
npm install
Copy-Item .env.example .env   # SERVER_URL (endereço do backend)
npm run dev

# 3) Abra http://localhost:3000/central, entre com o usuário do DP e envie uma mensagem
```

No futuro, outros clientes (`mobile/`, `admin-panel/`) podem usar o mesmo backend pela mesma API.
