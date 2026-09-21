# sistema-dp-backend

Backend do sistema **Comunicação DP**, a comunicação interna entre o Departamento Pessoal e os computadores da fábrica.

- API REST e WebSocket (Socket.IO) para entregar mensagens em tempo real aos computadores
- **Central do DP**: página web para o DP escrever e enviar comunicados (`http://SERVIDOR:3000/central`)
- Banco SQLite embutido (módulo nativo `node:sqlite`, sem instalar nada além do Node)
- Autenticação: login do DP com token e registro dos computadores com chave da empresa

Stack: Node.js 22 + TypeScript + Fastify 5 + Socket.IO 4.

---

## 1. Instalação do Node.js

1. Baixe o Node.js **22 LTS (22.13 ou superior)** em https://nodejs.org e instale com as opções padrão.
2. Confira no terminal:

```powershell
node -v    # v22.13.0 ou maior
npm -v
```

> Precisa ser a versão 22.13 ou superior por causa do banco SQLite nativo (`node:sqlite`).

## 2. Instalação das dependências

Dentro da pasta `backend/`:

```powershell
npm install
```

## 3. Configuração do `.env`

Copie o exemplo e edite:

```powershell
Copy-Item .env.example .env
notepad .env
```

| Variável                  | Padrão                  | Descrição |
|---------------------------|-------------------------|-----------|
| `NODE_ENV`                | `development`           | `development` (logs legíveis) ou `production` (logs em JSON) |
| `SERVER_HOST`             | `0.0.0.0`               | Endereço de escuta. `0.0.0.0` aceita conexões da rede interna |
| `SERVER_PORT`             | `3000`                  | Porta HTTP e WebSocket |
| `LOG_LEVEL`               | `info`                  | `fatal`, `error`, `warn`, `info`, `debug` ou `trace` |
| `DATABASE_PATH`           | `./data/sistema-dp.db`  | Arquivo do banco SQLite (`:memory:` = temporário) |
| `UPLOADS_PATH`            | `./data/uploads`        | Pasta dos anexos dos comunicados (arquivos e imagens). Entre no backup junto com o banco |
| `ADMIN_USERNAME`          | `ti`                    | Login principal (do TI) criado na primeira execução. Os logins das pessoas do DP são criados depois com `npm run create-admin` |
| `ADMIN_PASSWORD`          | *(obrigatória na 1ª vez)* | Senha desse usuário. Mínimo de 8 caracteres |
| `ADMIN_NAME`              | `Departamento Pessoal`  | Nome que aparece como remetente das mensagens |
| `SESSION_TTL_HOURS`       | `12`                    | Validade do login na Central do DP, em horas |
| `EMPLOYEE_SESSION_HOURS`  | `12`                    | Validade do login do funcionário no app (PC compartilhado: se ele esquecer de sair, a sessão acaba sozinha) |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | *(vazio)*        | Certificado e chave para HTTPS direto no backend (veja "HTTPS") |
| `TRUST_PROXY`             | *(vazio)*               | IP do proxy reverso com HTTPS (IIS/nginx/Caddy), se usar um |

> - O `.env` **não** vai para o controle de versão. Nunca coloque IPs, senhas ou chaves no código.
> - O usuário do DP só é criado se o banco ainda não tiver nenhum. A senha fica guardada com hash (scrypt) no banco. Depois disso, `ADMIN_PASSWORD` pode ser removida do `.env`.
> - O backend **não sobe**, em nenhum ambiente, enquanto a senha for o valor de exemplo (`troque-...`).
> - O `.env` e o banco são sempre procurados na pasta `backend/`, mesmo quando o backend roda como serviço, a partir de outro diretório.

### Criar o banco

```powershell
npm run db:init
```

O comando cria `data/sistema-dp.db`, aplica as migrações e cria o usuário do DP. Pode rodar quantas vezes quiser, porque não apaga nada. O `npm run dev` e o `npm start` também fazem isso sozinhos.

### Trocar a senha do DP

```powershell
npm run set-password -- admin
```

O comando pede a nova senha no terminal e encerra as sessões abertas desse usuário. Mudar `ADMIN_PASSWORD` no `.env` depois que o usuário existe **não** altera a senha.

### Logins da Central (equipe do DP e TI)

Cada pessoa do DP tem o próprio login. O nome dela aparece como remetente dos comunicados e do chat. Para criar um login:

```powershell
npm run create-admin -- livia "Livia (DP)" --gerar     # gera uma senha inicial
npm run create-admin -- ti "TI"                        # ou digite a senha inicial
```

- Com `--gerar`, a senha inicial vai para `data\credenciais-iniciais.txt`, que fica fora do controle de versão. Entregue a senha à pessoa e **apague o arquivo depois**.
- A troca de senha é **opcional**: quem quiser troca a própria senha pelo botão **Minha senha**, no topo da Central. Pelo servidor, a TI pode redefinir a senha com `npm run set-password -- <usuario>`.

## 4. Execução em desenvolvimento

```powershell
npm run dev
```

O servidor reinicia sozinho a cada alteração no código. Saída esperada:

```
Servidor DP rodando em http://0.0.0.0:3000
[2026-09-14 10:00:00] INFO: Banco de dados SQLite: ./data/sistema-dp.db
[2026-09-14 10:00:00] INFO: Server listening at http://192.168.1.50:3000
[2026-09-14 10:00:00] INFO: Usuário inicial do DP criado: admin
[2026-09-14 10:00:00] INFO: Backend iniciado na porta 3000 (ambiente: development)
```

O Fastify lista todos os IPs da máquina em que o servidor está acessível. Use um deles nos computadores da rede.

## 5. Execução em produção

```powershell
npm run build     # compila TypeScript para dist/
npm start         # executa dist/server.js
```

- Defina `NODE_ENV=production` no `.env`. Os logs passam a sair em JSON estruturado.
- Faça backup periódico do banco com **`backup-banco.cmd`** (gera uma cópia em `C:\backup-dp` com a data no nome, funciona com o serviço rodando e apaga cópias com mais de 30 dias). Agende no Agendador de Tarefas, diariamente.
- Para o backend subir junto com o Windows Server, registre `npm start` como serviço, por exemplo com o [NSSM](https://nssm.cc), ou use o Agendador de Tarefas ("Ao iniciar o sistema"). Preencha "Iniciar em"/AppDirectory com a pasta `backend`. O `.env` já é encontrado sozinho, mas o `npm` precisa rodar dessa pasta.

### HTTPS (recomendado em produção)

Sem HTTPS, a senha do DP e os tokens trafegam sem cifra pela rede. Escolha uma das opções:

- **A) HTTPS direto no backend:** peça à TI um certificado para o nome/IP do servidor (ex.: emitido pela CA interna da empresa / AD CS) e configure:
  ```
  TLS_CERT_FILE=./certs/servidor.crt
  TLS_KEY_FILE=./certs/servidor.key
  ```
  Nos computadores, use `SERVER_URL=https://servidor:3000`. O certificado precisa ser confiável no Windows; com a CA da empresa distribuída pelo AD, ele já é.
- **B) Proxy reverso (IIS, nginx ou Caddy) com HTTPS na frente do backend:** mantenha o backend em `SERVER_HOST=127.0.0.1` e defina `TRUST_PROXY=127.0.0.1`. Assim o bloqueio de login usa o IP real de cada pessoa, e não o do proxy. O proxy precisa repassar WebSocket (`Upgrade`).

## 6. Porta utilizada

A porta padrão é **3000** (`SERVER_PORT`), usada tanto pela API REST quanto pelo WebSocket. Para trocar, altere o `.env` e reinicie o backend.

## 7. Como testar a API

### Health check (público)

```powershell
Invoke-RestMethod http://localhost:3000/api/health
# status service
# ------ -------
# ok     sistema-dp-backend
```

### Pela Central do DP (mais fácil)

Abra no navegador `http://localhost:3000/central` e entre com `ADMIN_USERNAME` e `ADMIN_PASSWORD`. Na Central você:

- escolhe o tipo (Comunicado, Aviso, Informativo ou Urgente), o título e o texto;
- escolhe o destino: todos os computadores ou um computador específico;
- **anexa arquivos e imagens** (até 5 por comunicado): o funcionário abre ou salva cada anexo no app;
- confere a **prévia do alerta** exatamente como ele vai aparecer na tela dos funcionários;
- acompanha o histórico com as leituras e os computadores online. Cada funcionário logado conta uma leitura, e cada PC sem login também;
- **clica na contagem de leituras** para ver quem leu: o funcionário (nome, matrícula, setor, em qual PC e quando) ou o computador. Para mensagens enviadas a um funcionário, setor, turno ou computador, também aparece a lista de **quem ainda não leu**;
- troca entre tema claro e **modo escuro** (botão no topo; a escolha fica salva no navegador).

> PC formatado ou Windows reinstalado mostrando "já foi registrado com outra credencial": o TI libera no servidor, na pasta `backend`, com `npm run liberar-pc -- PC-XXXXXXXXXXXX` (o ID aparece no app em "Meu perfil" e na tabela de Computadores). A rota `POST /api/computers/:id/reset-credential` continua disponível.

> Uma mensagem para **Todos** vale para os computadores que já estavam registrados no momento do envio. Um PC instalado depois não recebe o histórico antigo como "não lido".

### Comunicados e Mensagens (chat)

- **Comunicados** (Comunicado, Aviso, Informativo e Urgente) vão para Todos, um Setor, um Turno ou um Computador. Eles aparecem com alerta e som no app, na página "Comunicados". Podem levar **anexos** (arquivos e imagens) — veja "Anexos nos comunicados".
- **Mensagens** é um chat **individual**: cada pessoa do DP (Livia, Fabricio, Carol, Andressa...) tem as próprias conversas, e cada funcionário conversa separadamente com qualquer pessoa do DP.
  - Na Central, em "Minhas conversas", cada pessoa do DP vê só as conversas dela, com contador próprio. Pode abrir uma nova conversa escolhendo o funcionário.
  - No app, na página "Mensagens", o funcionário vê a lista das pessoas do DP e escolhe com quem falar. É preciso estar logado com a matrícula.
  - Logins criados com `--sem-chat` (ex.: TI) e o `admin` não aparecem na lista do app. Se escreverem para alguém, a conversa aparece para aquele funcionário.
- **Resposta automática** (Central → "Resposta automática"): cada pessoa do DP cadastra os próprios textos, um por setor e, se quiser, um para "Todos os setores". Quando um funcionário escreve para ela, o servidor responde na hora com o texto do setor dele (ou o de todos os setores, se não houver um para o setor ou se estiver pausado). Regras:
  - não responde de novo se a pessoa do DP escreveu nessa conversa (à mão ou automático) na última hora;
  - não marca a conversa como lida: a pessoa continua vendo o contador na Central;
  - a mensagem aparece com a etiqueta "🤖 Resposta automática" no app e na Central;
  - o texto aceita `{primeiro_nome}`, `{funcionario}`, `{setor}` e `{nome_dp}`;
  - renomear um setor atualiza as respostas dele; excluir o setor apaga as respostas dele.
- As mensagens do DP chegam ao app **na hora**, pelo WebSocket, e aparecem só como contador, sem popup. As mensagens do funcionário aparecem na Central em até 10s, e a conversa aberta atualiza a cada 5s.
- Cada lado vê o que o outro já leu ("✓ lida").

### Funcionários e login no aplicativo

Na seção **Setores** da Central, o DP cria, renomeia e exclui os setores da fábrica.
- Renomear atualiza os funcionários do setor e as mensagens já enviadas a ele.
- Um setor com funcionários não pode ser excluído: mude as pessoas de setor antes.
- Nomes que diferem só em maiúsculas ou acentos contam como o mesmo setor.

Na seção **Funcionários**, o DP:
- cadastra nome, matrícula, setor (escolhido da lista de setores), turno e senha inicial;
- em **Editar**, altera nome, **matrícula**, setor e turno, e pode definir uma **nova senha** (ex.: esqueceu). Com senha nova, o funcionário sai dos PCs onde estiver logado; trocar a senha depois é opcional, em "Meu perfil" no app;
- **desativa**, bloqueando o acesso sem apagar (dá para reativar);
- **exclui** o funcionário, que sai dos computadores. O histórico de mensagens é mantido.

O funcionário entra no aplicativo desktop com a **matrícula e a senha**. Ele também pode trocar a própria senha, na tela "Meu perfil" do app. Com isso, a Central pode enviar para:

| Destino | Quem recebe |
|---|---|
| Todos | Todos os computadores |
| Funcionário | O computador onde a pessoa estiver logada (ou quando ela entrar) |
| Setor / Turno | Os funcionários ativos do setor/turno, onde estiverem logados |
| Computador | Só aquele PC, com ou sem funcionário logado |

- Com um funcionário logado, as leituras contam **para a pessoa**: se ela entrar em outro PC, o que já leu continua como lido.
- Sem login ("Continuar sem identificação"), o PC recebe os comunicados gerais (Todos e Computador).
- Um funcionário desativado sai automaticamente dos computadores.

### Pelo PowerShell

> **Importante (acentos):** o PowerShell 5.1 envia texto em Latin-1 por padrão, e o backend recusa acentos fora de UTF-8 com `INVALID_BODY`. Por isso os exemplos convertem o corpo com `[Text.Encoding]::UTF8.GetBytes(...)`.

```powershell
$base = "http://localhost:3000"
function Send-Json($method, $path, $obj, $headers = @{}) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json))
  Invoke-RestMethod -Method $method -Uri "$base$path" -Headers $headers `
    -ContentType "application/json; charset=utf-8" -Body $bytes
}

# 1) Login do DP -> token
$login = Send-Json Post "/api/auth/login" @{ username = "admin"; password = "SUA_SENHA" }
$auth = @{ Authorization = "Bearer $($login.token)" }

# 2) Enviar mensagem para todos
Send-Json Post "/api/messages" @{
  title   = "Reunião Geral"
  content = "A reunião será realizada hoje às 16:00."
  type    = "COMUNICADO"   # COMUNICADO | AVISO | INFORMATIVO | URGENTE
  target  = "ALL"          # ALL | EMPLOYEE | SECTOR | SHIFT | COMPUTER (os outros usam targetId)
} $auth

# 3) Histórico e computadores
Invoke-RestMethod "$base/api/messages"  -Headers $auth
Invoke-RestMethod "$base/api/computers" -Headers $auth
```

A resposta do envio inclui `deliveredTo`, com quantos computadores online receberam na hora. Os computadores desligados recebem a mensagem quando conectarem.

### Endpoints

| Método | Rota | Quem pode | Descrição |
|--------|------|-----------|-----------|
| GET    | `/api/health` | público | Status do servidor |
| POST   | `/api/auth/login` | público | Login do DP → `{ token, expiresAt, user }` |
| POST   | `/api/auth/logout` | DP | Encerra a sessão |
| GET    | `/api/auth/me` | DP | Usuário logado |
| POST   | `/api/computers/register` | público | Registro do aparelho (PC ou celular) → `{ computer, token }` |
| GET    | `/api/computers` | DP | Lista os computadores e o status online/offline |
| GET    | `/api/computers/:id` | DP | Detalhe de um computador |
| POST   | `/api/computers/:id/reset-credential` | DP | Libera o PC para se registrar de novo (ex.: Windows reinstalado) |
| GET    | `/api/employees` | DP | Lista os funcionários |
| POST   | `/api/employees` | DP | Cadastra um funcionário `{ name, registration, sector?, shift?, password }` |
| PATCH  | `/api/employees/:id` | DP | Altera nome, matrícula, setor, turno ou status (`ACTIVE`/`INACTIVE`) |
| DELETE | `/api/employees/:id` | DP | Exclui o funcionário (o histórico é mantido) |
| GET    | `/api/sectors` | DP | Lista os setores, com a quantidade de funcionários |
| POST   | `/api/sectors` | DP | Cria um setor `{ name }` |
| PATCH  | `/api/sectors/:id` | DP | Renomeia (propaga para os funcionários e as mensagens do setor) |
| DELETE | `/api/sectors/:id` | DP | Exclui um setor sem funcionários |
| POST   | `/api/employees/:id/password` | DP | Redefine a senha |
| GET    | `/api/session` | computador | Funcionário logado neste PC (ou `null`) |
| POST   | `/api/session/login` | computador | Login do funcionário `{ registration, password }` |
| POST   | `/api/session/logout` | computador | Funcionário sai do PC |
| POST   | `/api/session/password` | computador | Funcionário troca a própria senha |
| POST   | `/api/messages` | DP | Envia uma mensagem (tempo real). `target`: `ALL`, `EMPLOYEE`, `SECTOR`, `SHIFT` ou `COMPUTER`, com `targetId` = ID do funcionário, nome do setor/turno ou ID do PC. `attachmentIds` = anexos já enviados |
| POST   | `/api/attachments` | DP | Envia um arquivo (corpo binário, `Content-Type: application/octet-stream`, cabeçalhos `X-File-Name` e `X-File-Type`) → `{ attachment }` |
| DELETE | `/api/attachments/:id` | DP | Cancela um arquivo que ainda não saiu em nenhum comunicado |
| POST   | `/api/attachments/:id/link` | DP / computador | Link temporário (5 min) para abrir o anexo sem cabeçalho de autenticação |
| GET    | `/api/attachments/:id` | DP / computador destinatário | Conteúdo do anexo (com token, ou com `?t=` do link temporário) |
| GET    | `/api/messages` | DP / computador | DP: todas, com leituras. Computador: as suas, com `read` |
| GET    | `/api/messages/unread` | computador | Não lidas deste computador |
| GET    | `/api/messages/:id` | DP / computador | Detalhe (o computador só vê as mensagens dele) |
| GET    | `/api/messages/:id/reads` | DP | Quem leu (funcionário ou PC, onde e quando) e, para setor/turno/computador, quem ainda não leu |
| GET    | `/api/chats` | DP | **Minhas** conversas (da pessoa do DP logada), com a última mensagem e as não lidas |
| GET    | `/api/chats/:employeeId/messages` | DP | Minha conversa com um funcionário |
| POST   | `/api/chats/:employeeId/messages` | DP | Envio `{ content }` ao funcionário (chega na hora no app) |
| POST   | `/api/chats/:employeeId/read` | DP | Marca como lidas as mensagens do funcionário na minha conversa |
| GET    | `/api/chat/contacts` | computador (funcionário logado) | Pessoas do DP com quem conversar, com não lidas e última mensagem |
| GET    | `/api/chat/messages?dpUserId=` | computador (funcionário logado) | Conversa com uma pessoa do DP + não lidas |
| POST   | `/api/chat/messages` | computador (funcionário logado) | Funcionário envia `{ dpUserId, content }` |
| POST   | `/api/chat/read` | computador (funcionário logado) | Marca como lidas as mensagens de `{ dpUserId }` |
| DELETE | `/api/admin/messages/:id` | TI | Apaga um comunicado e as leituras dele |
| POST   | `/api/admin/messages/purge` | TI | Apaga comunicados: `{ olderThanDays }` (null = todos) |
| GET    | `/api/admin/chats` | TI | Conversas por pessoa do DP, **só em números** (sem conteúdo) |
| DELETE | `/api/admin/chats/:dpUserId/:employeeId` | TI | Apaga uma conversa |
| POST   | `/api/admin/chats/purge` | TI | Apaga conversas: `{ dpUserId?, olderThanDays? }` |
| GET    | `/api/admin/users` | TI | Logins do DP |
| POST   | `/api/admin/users` | TI | Cria login: `{ username, name, password, chatContact }` |
| PATCH  | `/api/admin/users/:id` | TI | Ativa/desativa: `{ status }` |
| POST   | `/api/admin/users/:id/password` | TI | Redefine a senha de um login |
| GET    | `/api/auto-replies` | DP | Minhas respostas automáticas |
| POST   | `/api/auto-replies` | DP | Cria `{ sector (null = todos os setores), content, active }` |
| PUT    | `/api/auto-replies/:id` | DP | Altera uma resposta minha (mesmo corpo) |
| DELETE | `/api/auto-replies/:id` | DP | Exclui uma resposta minha |
| PATCH  | `/api/messages/:id/read` | computador | Marca como lida |

Erros sempre em JSON: `{ "error": "CODIGO", "message": "descrição" }`.

### Anexos nos comunicados

O DP pode mandar **arquivos e imagens** junto com o comunicado. Na Central é o campo "Anexos"
(botão ou arrastando os arquivos para a área pontilhada).

Como funciona: o arquivo sobe assim que é escolhido (`POST /api/attachments`) e fica guardado sem
dono; só entra no comunicado quando o envio cita o `id` dele. O que nunca vira comunicado sai do
disco sozinho depois de 12 horas.

| Limite | Valor |
|---|---|
| Anexos por comunicado | 5 |
| Tamanho de cada arquivo | 10 MB |
| Soma dos anexos | 25 MB |
| Tipos aceitos | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.txt`, `.csv`, `.zip` |

- Além da extensão, o servidor confere os primeiros bytes do arquivo: um `.exe` renomeado para
  `.png` é recusado.
- O anexo só é entregue a quem recebeu o comunicado: o DP vê todos; um computador só baixa os
  anexos das mensagens que são dele (senão, 404).
- Os arquivos ficam em `UPLOADS_PATH` (padrão `data/uploads`), com o nome `ATT-....`. **Inclua essa
  pasta no backup**: o `backup-banco.cmd` copia só o banco.
- Quando o TI apaga um comunicado, os anexos dele saem do banco e do disco.

### WebSocket (Socket.IO)

- Só transporte `websocket` (sem long-polling). Handshake: `auth: { computerId, hostname, appVersion, platform, token }`.
- O servidor valida os dados e o token do computador. Ele recusa com `INVALID_HANDSHAKE` ou `UNAUTHORIZED`.
- Eventos enviados ao computador:
  - `message:new`: a mensagem;
  - `session:changed`: `{ employee }`, quando o servidor altera a sessão do funcionário (sessão expirada, funcionário desativado, senha redefinida, setor alterado).
- Salas: `all`, `computer:<ID>` e, com um funcionário logado, `employee:<ID>`, `sector:<setor>` e `shift:<turno>`. As salas são trocadas no login e no logout.

## 8. Testar a conexão a partir de outro computador da rede

1. No servidor, descubra o IP com `ipconfig` (campo "Endereço IPv4", ex.: `192.168.1.50`).
2. Libere a porta no Firewall do Windows (PowerShell **como administrador**):

   ```powershell
   New-NetFirewallRule -DisplayName "Sistema DP Backend" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```

3. Em outro computador da rede:

   ```powershell
   Invoke-RestMethod http://192.168.1.50:3000/api/health
   ```

   ou abra `http://192.168.1.50:3000/central` no navegador.

Se não responder, confira se as duas máquinas estão na mesma rede, se o firewall foi liberado e se `SERVER_HOST=0.0.0.0`.

---

## Conta do TI (poderes extras na Central)

O **primeiro login criado** (o do `.env`, hoje `ti`) é a conta do TI. Ela faz tudo o que o DP faz e, além disso, ganha a seção **TI** na Central:

- **Apagar comunicados:** um específico ou todos com mais de 90/180/365 dias (as leituras saem junto).
- **Apagar conversas do chat:** de uma pessoa do DP ou de todas. A tela mostra **só números** — quantas conversas, quantas mensagens e a data da última. **O conteúdo das conversas não é exibido em lugar nenhum**, nem pela API.
- **Gerenciar os logins do DP:** criar, ativar/desativar e redefinir senha, sem precisar de comando no servidor.

Detalhes:

- Os logins criados pela Central ou pelo `create-admin` **não** têm esses poderes; só a conta marcada como TI (coluna `users.super_admin`).
- A conta do TI não pode desativar a si mesma nem alterar outra conta de TI por essas telas (evita ficar sem acesso).
- Desativar um login ou redefinir a senha dele encerra a sessão aberta daquela pessoa na hora.
- As rotas `/api/admin/*` respondem **403** para quem não é TI, e a Central esconde a seção.

## Capacidade (muitos computadores)

O sistema foi medido com **300 computadores simulados, cada um com funcionário logado, chegando todos dentro de 1 segundo** (servidor de teste, `NODE_ENV=production`):

| Situação | Tempo para os 300 | Maior pausa do servidor |
|---|---|---|
| PCs conectando (WebSocket + sincronização) | 1,0 s | 9 ms |
| Comunicado para Todos chegando em todos os PCs | 11 ms | 1 ms |
| 300 funcionários marcando como lido | 1,0 s | 2 ms |
| 300 mensagens de chat + 300 respostas automáticas | 1,1 s | 11 ms |
| Central listando 300 conversas | 4 ms | 3 ms |
| Servidor reiniciado: 300 PCs voltando juntos | 1,3 s | 23 ms |
| 300 funcionários fazendo login no mesmo segundo | 5,6 s | 11 ms |

Com **500 computadores** (chegando em 2 s) tudo continuou funcionando: comunicado para Todos em 16 ms, 500 PCs voltando depois de reiniciar o servidor em 2,3 s, maior pausa do servidor 68 ms e **126 MB de memória** no processo do servidor.

O que foi feito para isso:

- **Segredo do PC com SHA-256** (256 bits aleatórios gerados pelo app). O scrypt, lento de propósito, fica só para senhas de pessoas. Segredos antigos em scrypt são convertidos sozinhos no próximo registro do PC.
- **SQLite em WAL com `synchronous = NORMAL`**: não faz um fsync a cada gravação e continua protegido contra corrupção.
- **Índices** para a lista de conversas de cada pessoa do DP, para a contagem por setor/turno e para o PC de cada funcionário (migração 11).
- **Envio em tempo real** conta os destinatários sem montar a lista de sockets.
- **Fila de conexões** (`backlog`) maior.
- **App 1.3.2** espalha a primeira reconexão depois de uma queda entre 1 e 6 s, para centenas de PCs não voltarem no mesmo instante.

Observações:

- O login do funcionário usa scrypt (proteção da senha). Ele atende ~50 logins por segundo; se centenas entrarem no **mesmo segundo**, os últimos esperam alguns segundos, mas o servidor não trava. Na prática, os logins do início do turno se espalham em minutos.
- Para o servidor definitivo, prefira **Windows Server** (ou Linux): o Windows 10/11 limita a fila de conexões pendentes e pode recusar parte de centenas de conexões abertas no mesmo milissegundo (o app tenta de novo sozinho).
- Deixe o arquivo do banco (`data/sistema-dp.db`) em disco local (de preferência SSD), nunca em pasta de rede.

## Banco de dados: SQLite ou PostgreSQL

O sistema roda nos dois bancos, e quem decide é o `.env`:

| `.env` | Banco usado |
| --- | --- |
| sem `DATABASE_URL` | SQLite, no arquivo de `DATABASE_PATH` (padrão) |
| com `DATABASE_URL` | PostgreSQL, no schema de `DATABASE_SCHEMA` (padrão `dp`) |

```env
DATABASE_URL=postgresql://sistema_dp:SUA_SENHA@localhost:5433/sistema_dp
DATABASE_SCHEMA=dp
```

As tabelas são criadas sozinhas na primeira execução, nos dois casos.

### Subir o PostgreSQL

Na pasta do projeto (uma pasta acima desta):

```bash
docker compose -f docker-compose.postgres.yml --env-file .env.postgres up -d
```

Sobe o banco em `localhost:5433` e o Adminer (consulta pelo navegador) em `http://localhost:8081`.

### Levar os dados do SQLite para o PostgreSQL

```bash
npm run migrar-postgres -- --sqlite ./data/sistema-dp.db
```

O SQLite é aberto somente para leitura. O script copia as tabelas em uma única
transação, mantém os IDs e as numerações automáticas, e no fim compara a contagem
de linhas de cada tabela. Se o PostgreSQL já tiver dados, ele para e avisa; para
apagar e importar do zero, use `--sobrescrever`.

Para copiar o banco que está rodando em um container, gere antes uma cópia
consistente (sem parar o serviço):

```bash
docker exec comunicacao-dp node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/sistema-dp.db',{readOnly:true});db.exec(\"VACUUM INTO '/tmp/copia.db'\");db.close()"
docker cp comunicacao-dp:/tmp/copia.db ./copia.db
npm run migrar-postgres -- --sqlite ./copia.db
```

Os anexos dos comunicados **não** ficam no banco: continuam na pasta de
`UPLOADS_PATH` e devem ser copiados junto.

## Testes automatizados

```powershell
npm test
```

Os testes usam um banco temporário em memória, então não mexem no seu banco. Eles cobrem:
- health check e rotas protegidas;
- login e bloqueio de tentativas;
- registro de PCs (chave, credencial por PC, `npm run liberar-pc` para PC formatado);
- regra de destinatários, leitura idempotente e validação das entradas.

Os mesmos testes rodam no PostgreSQL, em um schema separado (`teste_automatizado`)
que é apagado e recriado a cada execução, sem encostar nos dados reais:

```powershell
$env:TEST_DATABASE_URL = "postgresql://sistema_dp:SUA_SENHA@localhost:5433/sistema_dp"
npm run test:postgres
```

## Segurança

- O acesso exige identificação em tudo, exceto `/api/health`, o login e a página da Central. As regras:
  - **DP:** faz login com usuário e senha (hash scrypt) e recebe um token com validade. Depois de 5 tentativas erradas em 15 minutos, o login fica bloqueado por 5 minutos.
  - **Computadores e celulares:** o reg

Os mesmos testes também rodam no PostgreSQL (em um schema separado, `teste_automatizado`,
que é apagado e recriado a cada execução):

```bash
TEST_DATABASE_URL=postgresql://sistema_dp:SUA_SENHA@localhost:5433/sistema_dp npm run test:postgres
```
istro é **aberto** a qualquer aparelho que alcance o servidor — não há chave de registro. Na primeira vez, cada instalação guarda um segredo próprio; sem esse segredo ninguém consegue se passar por um aparelho já registrado. O token do aparelho vale para a API e para o WebSocket. Como não há chave, **o servidor só deve ser alcançável pela rede interna da empresa**.
  - **Funcionários:** entram no app com matrícula e senha (hash scrypt). Regras:
    - no primeiro acesso, e depois de uma redefinição pelo DP, a troca de senha é obrigatória;
    - erros de login são limitados por matrícula+PC, por PC (várias matrículas) e por matrícula (vários PCs), e a troca de senha também tem limite;
    - a sessão expira em `EMPLOYEE_SESSION_HOURS` e termina no logoff do Windows;
    - redefinir a senha ou desativar o funcionário tira ele de todos os PCs.
  - **Tokens:** o banco guarda só o hash (SHA-256) de cada token.
- Todos os dados recebidos pela API e pelo WebSocket são validados (JSON Schema / validação manual).
- Os aplicativos desktop conversam só com a API e o WebSocket. O banco nunca fica exposto aos clientes.
- As respostas levam cabeçalhos de segurança (`nosniff`, `X-Frame-Options: DENY`, `no-referrer`), e a Central tem CSP restritiva.

## Logs

O backend registra:
- inicialização e encerramento;
- conexão, desconexão e reconexão de PCs;
- envio e leitura de mensagens;
- logins e falhas de login, registros recusados;
- erros;
- uma linha por requisição (o health check só aparece em `debug`).

```
[2026-09-14 10:59:12] INFO: PC conectado: PC-3EB8A3FB8E56 (DESKTOP-52JOO93, v1.0.0)
[2026-09-14 10:59:12] INFO: Mensagem enviada: MSG-000001 (COMUNICADO, destino ALL) → 12 PC(s) online
[2026-09-14 10:59:17] INFO: Mensagem MSG-000001 lida por PC-3EB8A3FB8E56
```

## Estrutura

```
public/central/                 # Central do DP (HTML/CSS/JS puro, servida em /central)
test/api.test.ts                # testes automatizados (npm test)
src/
├── server.ts                   # ponto de entrada: abre o banco, sobe o servidor, encerra com segurança
├── app.ts                      # monta o Fastify: camadas, rotas, WebSocket, cabeçalhos
├── config/                     # leitura/validação do .env e configuração de logs
├── database/                   # conexão SQLite, migrações versionadas e fábrica de repositórios
├── scripts/                    # db:init (criar banco) e set-password (trocar senha do DP)
├── errors/                     # erros de negócio e tratamento centralizado
├── realtime/socket-server.ts   # WebSocket: handshake autenticado, salas e envio de mensagens
└── modules/
    ├── auth/                   # login, tokens, registro de PCs, bloqueio de tentativas
    ├── computers/              # computadores: types, repository, sqlite-repository, service, routes
    ├── messages/               # mensagens e leituras: types, repository, sqlite-repository, service, routes
    ├── attachments/            # anexos dos comunicados: armazenamento em disco, envio e download
    ├── employees/              # funcionários: cadastro pelo DP e sessão no app (login com matrícula)
    ├── users/                  # usuários (DP e funcionários): tipos e repositório
    └── health/                 # GET /api/health
```

Cada módulo segue a mesma divisão em camadas:
- `*.repository.ts` é a interface de dados;
- `*.sqlite-repository.ts` é a implementação para SQLite;
- `*.service.ts` guarda as regras de negócio;
- `*.routes.ts` é a entrada HTTP.

**Trocar para PostgreSQL ou Oracle:** crie novas classes que implementem as interfaces `*.repository.ts` e uma fábrica igual a `createSqliteRepositories()` (`src/database/repositories.ts`), e use essa fábrica em `src/server.ts`. O `buildApp()` só conhece as interfaces, então services, rotas e WebSocket continuam iguais.

**Novos destinos** (setor, turno, departamento, funcionário): o modelo já prevê esses tipos. Para implementar um deles:
1. Acrescente a regra em `isRecipient()` (`message.types.ts`) e no filtro SQL equivalente (`message.sqlite-repository.ts`).
2. Crie a sala em `roomFor()` (`socket-server.ts`).
3. Libere o destino em `IMPLEMENTED_TARGETS`.
