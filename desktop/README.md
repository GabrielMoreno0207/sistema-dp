# sistema-dp-desktop — Comunicação DP

Aplicativo para Windows que recebe as mensagens do Departamento Pessoal em tempo real.

- Roda em segundo plano, com ícone e contador de não lidas na bandeja do Windows
- Pode iniciar junto com o Windows
- **Alerta chamativo com som**: popup do tamanho de uma notificação, no canto inferior direito, sempre por cima das outras janelas. As mensagens **URGENTE** aparecem em vermelho, piscando e com som insistente, e passam na frente das outras.
- Histórico de mensagens com filtros (Todas / Não lidas / Comunicados), busca e tela de detalhe
- Abre e salva os **anexos** (arquivos e imagens) que o DP mandou junto com o comunicado
- Mostra o status da conexão (🟢 conectado, 🟡 reconectando, 🔴 servidor indisponível) e reconecta sozinho
- Funciona offline: o histórico continua disponível, e as leituras são enviadas quando a conexão voltar

Stack: Electron + React + TypeScript + Vite (electron-vite).

---

## 1. Instalação

Pré-requisito: **Node.js 22 LTS** (https://nodejs.org).

Dentro da pasta `desktop/`:

```powershell
npm install
```

## 2. Configuração do endereço do backend

O aplicativo precisa de uma informação, fornecida pela TI:

| Configuração | Variável | Exemplo |
|---|---|---|
| Endereço do servidor | `SERVER_URL` | `http://192.168.1.50:3000` |

Existem três formas de informá-la. Quando mais de uma está preenchida, vale a primeira da lista:

1. **Tela Configurações do aplicativo.** Fica salva por usuário do Windows.
2. **Arquivo `.env` ao lado do executável** (`ComunicacaoDP.exe`), para a TI distribuir já configurado:
   ```
   SERVER_URL=http://192.168.1.50:3000
   ```
3. **Arquivo `.env` na pasta `desktop/`**, só em desenvolvimento. Copie o exemplo com `Copy-Item .env.example .env`.

> O IP nunca fica fixo no código. Em Configurações também há o botão **Testar conexão**.

> **Atenção:** o `.env` ao lado do executável só é lido na **primeira execução**. Nela, o endereço é copiado para o `config.json` do usuário, e a partir daí o `config.json` é que vale. Para mudar depois, use a tela **Configurações**, ou apague `%APPDATA%\Comunicação DP\config.json` para o `.env` ser lido de novo.

### HTTPS com certificado da empresa

Se o backend usar HTTPS com um certificado emitido pela CA interna da empresa (ex.: AD CS), use `SERVER_URL=https://servidor:3000`. Na inicialização, o app acrescenta às CAs públicas as CAs confiáveis do **repositório de certificados do Windows**, tanto para a API quanto para o WebSocket. Assim, um certificado que o Windows já considera confiável (distribuído pela TI/AD) também é aceito pelo app. O log (`logs\app.log`) mostra `[tls] N certificados confiáveis (... do Windows)`.

## 3. Execução em desenvolvimento

Com o backend rodando (veja o README do backend):

```powershell
npm run dev
```

O comando abre o aplicativo com recarga automática da interface. Em desenvolvimento, os dados ficam em `%APPDATA%\Comunicação DP-dev`, separados do app instalado. Assim os dois podem rodar juntos, e o teste não mexe na configuração, na identidade nem no cache da instalação real.

Para testar o fluxo completo:

1. Abra a Central do DP: `http://localhost:3000/central`.
2. Envie uma mensagem.
3. O alerta aparece no canto da tela, com som, e a mensagem entra na lista.

Outros comandos:

```powershell
npm run typecheck   # checagem de tipos
npm run build       # compila para out/
npm run preview     # roda a versão compilada
```

## 4. Build para Windows

```powershell
npm run build                      # código compilado em out/ (processo principal, preloads e telas)
npx electron-builder --win --dir   # app executável em dist/win-unpacked/, sem instalador
```

A pasta `dist/win-unpacked/` já roda direto (`ComunicacaoDP.exe`). Serve para testar antes de gerar o instalador.

## 5. Geração do instalador

```powershell
npm run dist:win
```

- Gera `dist/ComunicacaoDP-Setup-1.3.2.exe`, um instalador NSIS para Windows 64 bits. Instalar a versão nova por cima da antiga atualiza o app e mantém as configurações.
- Instala por usuário, por padrão em `%LOCALAPPDATA%\Programs\Comunicação DP\`, e cria atalhos na Área de Trabalho e no Menu Iniciar.
- Depois de instalado, o início automático com o Windows vem ligado. Pode ser desligado em Configurações.
- Para distribuir já configurado, coloque um `.env` (item 2) na pasta de instalação, ao lado de `ComunicacaoDP.exe`. Na primeira execução, o endereço e a chave são copiados para o `config.json` do usuário (a chave vai cifrada), então continuam valendo depois de atualizações do app.
- **Instalação por máquina:** por padrão cada usuário do Windows instala o seu, e cada conta vira um computador diferente no painel. Para instalar uma vez só para todas as contas, troque `perMachine: false` por `perMachine: true` em `electron-builder.yml`. Nesse caso o instalador pede permissão de administrador e instala em `C:\Program Files\Comunicação DP\`.

> Os ícones ficam em `resources/`. Para gerá-los de novo: `node scripts/generate-icons.mjs`.

---

## Como funciona

```
Windows inicia → app sobe na bandeja (--hidden)
  → gera/recupera o computerId (PC-XXXXXXXXXXXX) e o segredo da instalação
  → registra o PC no backend (com o segredo da instalação) → recebe um token
  → abre o WebSocket com o token → sincroniza mensagens pendentes
  → aguarda "message:new" → salva → atualiza contador → mostra alerta com som
Funcionário clica em "Visualizar" → abre a mensagem → avisa o backend que foi lida
```

- **Sem polling:** enquanto está conectado, só o WebSocket fica aberto.
- **Reconexão:** as tentativas são espaçadas de forma progressiva (1s, 2s, 4s… até 30s), com variação aleatória para os PCs não reconectarem todos juntos.
- **Fechar a janela** só esconde o aplicativo, que continua na bandeja. Para sair de verdade, use a bandeja → Sair.
- **Instância única:** abrir o aplicativo de novo só mostra a janela que já existe.

### Comunicados

- Tudo o que o DP publica (Comunicado, Aviso, Informativo e Urgente) fica na página **Comunicados**, com as abas **Todos / Não lidos / Urgentes**, busca e o texto completo ao clicar.
- Cada comunicado novo mostra o **alerta com som** no canto da tela. **Visualizar** abre o comunicado nessa página.
- O item **Comunicados** da barra lateral mostra quantos ainda não foram lidos.
- **Anexos**: quando o DP manda arquivos ou imagens, eles aparecem no fim do comunicado (📎 na lista e no alerta). As imagens aparecem em miniatura; cada anexo tem **Abrir** (abre no programa padrão do Windows) e **Salvar** (escolhe a pasta). O download precisa do servidor conectado (🟢) e é feito pelo processo principal — a interface não acessa a rede nem o disco.

### Mensagens (chat com as pessoas do DP)

- A página **Mensagens** mostra, à esquerda, a **lista de contatos do DP** (ex.: Livia, Fabricio, Carol, Andressa) e, à direita, a **conversa individual** com a pessoa escolhida. Cada pessoa do DP tem as próprias conversas: o que você fala com a Livia só a Livia vê.
- Qualquer funcionário pode falar com qualquer pessoa do DP, e os dois lados podem começar: a pessoa do DP escreve pela Central, e o funcionário escolhe o contato e escreve pelo app.
- Cada contato mostra a prévia da última mensagem, o horário e quantas mensagens dele ainda não foram lidas.
- O chat é **da pessoa**: é preciso entrar com a matrícula. Se ela entrar em outro PC, as conversas vão junto. Sem login, a página explica e oferece **Entrar com minha matrícula**.
- **Enter** envia e **Shift+Enter** quebra a linha (até 2000 caracteres). As minhas mensagens mostram **✓ lida** quando a pessoa do DP já leu.
- Se a pessoa do DP configurou uma **resposta automática** na Central, ela chega na hora, com a etiqueta **🤖 Resposta automática**. A pessoa do DP continua vendo a sua mensagem como não lida e responde depois.
- Mensagem nova **não abre alerta nem toca som**: o aviso é só o **contador** (total de todas as conversas) no item **Mensagens**, no Início (com o nome de quem mandou), no título da janela e na bandeja. Abrir a conversa com uma pessoa marca como lidas as mensagens dela.
- Enviar exige o servidor conectado (🟢). Sem conexão, o app avisa e a mensagem não é enviada.

### Login do funcionário

- Ao abrir o app aparece a tela **Entrar no Comunicação DP**: matrícula e senha. Quem cadastra os funcionários (matrícula, senha inicial, setor, turno) é o **DP, na Central**.
- O login é **opcional**. Em **Continuar sem identificação**, o computador segue recebendo os comunicados gerais enviados a todos. Para entrar depois: **Meu perfil → Entrar com minha matrícula**.
- Logado, o funcionário recebe também os comunicados enviados para o seu setor ou turno, e usa o chat com o DP. O vínculo funcionário ↔ computador fica no servidor e sobrevive a reinícios do app, mas **expira** depois de algumas horas (padrão 12h, `EMPLOYEE_SESSION_HOURS` no backend). Ele também termina no **logoff do Windows**, para o próximo usuário de um PC compartilhado não herdar a sessão.
- **Primeiro acesso:** com a senha inicial (ou uma senha redefinida pelo DP), o app mostra **Defina sua nova senha** antes de liberar o uso.
- Se o DP desativar o funcionário, redefinir a senha ou mudar o setor ou turno, o app se atualiza na hora.
- Em **Meu perfil**: dados do funcionário, **Alterar senha** (mínimo de 8 caracteres) e **Sair (trocar de funcionário)**. Ao sair, as mensagens pessoais somem da tela e a tela de login volta.
- Se não der para entrar, a tela de login mostra o motivo (servidor não configurado, indisponível ou PC não autorizado) e oferece um atalho para **Configurações**.
- Clicar em **Visualizar** num alerta abre a mensagem mesmo sem ninguém logado.
- O nome de quem está logado aparece no rodapé da barra lateral e no menu da bandeja.
- Entrar, sair e trocar a senha só funcionam com o servidor conectado (🟢).

### Arquivos locais (`%APPDATA%\Comunicação DP\`; em desenvolvimento, `%APPDATA%\Comunicação DP-dev\`)

| Arquivo | Conteúdo |
|---|---|
| `identity.json` | `computerId` e segredo da instalação (cifrado com DPAPI do Windows) |
| `config.json` | Endereço do servidor e início automático |
| `messages-cache.json` | Cópia local das mensagens, usada no modo offline e para não repetir alertas |
| `logs\app.log` | Log do aplicativo, útil para diagnosticar problemas. Acima de 1 MB vira `app.old.log` |

### Segurança

- A interface não tem acesso ao Node, à rede nem ao disco: tudo passa pelo processo principal via IPC. O aplicativo usa `contextIsolation`, `sandbox` e CSP, e bloqueia navegação e janelas externas.
- Todas as mensagens recebidas (WebSocket e REST) e todas as chamadas da interface são validadas.
- O aplicativo conversa **só** com a API e o WebSocket do backend, nunca com o banco de dados.

### Estrutura

```
src/
├── main/                   # processo principal (Node)
│   ├── index.ts            # ciclo de vida, IPC, bandeja, instância única, início automático
│   ├── connection.ts       # registro + WebSocket + reconexão progressiva
│   ├── api-client.ts       # chamadas REST ao backend
│   ├── message-store.ts    # mensagens, não lidas, cache local, leituras offline
│   ├── popup-manager.ts    # fila de alertas (URGENTE fura a fila)
│   ├── windows.ts          # janela principal e janela do alerta
│   ├── tray.ts             # ícone e menu da bandeja
│   ├── config.ts           # SERVER_URL / configurações salvas
│   ├── computer-identity.ts
│   ├── secure-storage.ts   # cifra segredos com DPAPI (safeStorage)
│   └── logger.ts           # log em arquivo (logs\app.log, com rotação)
├── preload/
│   ├── index.ts            # ponte segura da janela principal (window.dp)
│   └── popup.ts            # ponte mínima do alerta (window.dpPopup)
├── shared/                 # tipos e canais IPC compartilhados (types.ts, popup-channels.ts)
└── renderer/               # interface React
    ├── index.html          # janela principal
    ├── popup.html          # alerta
    └── src/
        ├── components/     # LoginScreen, ForcePasswordScreen (troca obrigatória), Sidebar, MessageList, MessageAttachments...
        ├── pages/          # Início, Mensagens, Meu perfil, Configurações
        ├── popup/          # tela do alerta
        └── lib/            # tipos de mensagem, som
```

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| 🔴 "Servidor indisponível" | Confira o endereço em Configurações → **Testar conexão**. Veja se o backend está rodando e se a porta está liberada no firewall do servidor |
| 🔴 "Registro não autorizado" | Confira o endereço do servidor em Configurações → **Testar conexão** |
| "Este computador já foi registrado com outra credencial" | O TI libera o PC no servidor (pasta `backend`): `npm run liberar-pc -- PC-XXXXXXXXXXXX` (o ID aparece em Meu perfil) |
| Erro de certificado com `https://` | O certificado do servidor precisa ser confiável no Windows (CA da empresa instalada no repositório de certificados). Veja "HTTPS com certificado da empresa" |
| Alerta sem som | Em Configurações → **Testar som**. Confira o volume do Windows |
