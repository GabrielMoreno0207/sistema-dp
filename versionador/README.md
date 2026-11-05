# Versionador — Comunicação DP

Aplicativo próprio (separado do Comunicação DP) para publicar novas versões no
servidor. Quem publica é a **conta do TI**; nenhuma outra conta consegue.

## Como abrir

Dê dois cliques em **`versionador.vbs`**, na raiz do projeto. Ele abre só a
janela do aplicativo, sem terminal junto — o `versionador.cmd` ao lado faz o
mesmo, mas pisca um console por um instante.

Pela linha de comando, com o terminal preso enquanto o aplicativo estiver
aberto:

```powershell
cd versionador
npm install      # só na primeira vez
npm start
```

## Claro ou escuro

O botão **modo escuro / modo claro** na barra de cima troca o tema e guarda a
escolha (vale também para as caixas de diálogo do Windows). Sem escolher nada,
ele segue o tema do Windows.

## O que a tela mostra

- **Faixa de cima:** o servidor está respondendo e em quanto tempo, qual versão
  subiu lá, há quanto tempo está no ar, e quantos computadores e celulares estão
  ligados agora.
- **Coluna da esquerda:** a versão no ar de cada aplicativo e quando foi
  publicada.
- **Antes de publicar:** a próxima versão sugerida (um clique preenche), e um
  aviso quando o número já está publicado, quando não é maior que o que está no
  ar, quando o nome do arquivo não combina com a versão digitada, ou quando o
  arquivo passa de 100 MiB num endereço que vai pelo proxy (aí volta HTTP 413).
- **Quem já atualizou:** quantos estão na última, quem está ligado, quem está
  logado em cada máquina e em que versão cada um parou.
- **Versões publicadas:** data, há quanto tempo, tamanho, quem publicou,
  quantos aparelhos estão em cada uma, o SHA-256 que o aplicativo confere depois
  de baixar, e o total de espaço ocupado no servidor.

## Como usar

1. Informe o endereço do servidor e entre com a conta do TI. Use o servidor
   direto — `http://192.168.20.1:3000` —, não o domínio: pelo proxy o envio
   esbarra no teto de tamanho (hoje 100 MiB) e o instalador, com 107 MB, volta
   com **HTTP 413**.
2. Escolha o aplicativo na coluna da esquerda: **Computador**, **Celular · APK**,
   **Celular · rápida** ou **Servidor**. Embaixo de cada nome aparece a versão
   que está no ar.
   - **Celular · rápida** = atualização rápida do celular
     (`mobile/gerar-atualizacao-rapida.cmd` gera o `.zip`): só o JavaScript; a
     pessoa toca em "Buscar atualizações" e o app fecha e abre já atualizado.
     Mudou algo nativo? Aí é **Celular · APK**.
3. Arraste o arquivo para a área pontilhada (ou clique em *escolher no
   computador…*). A versão é preenchida sozinha a partir do nome do arquivo.
4. Escreva o que mudou (esse texto aparece para quem vai atualizar) e publique.

O endereço do servidor e o usuário ficam guardados; a senha é pedida a cada uso.

## O que acontece depois de publicar

O servidor guarda o arquivo, calcula o SHA-256 e passa a responder em
`/api/atualizacoes/<app>/verificar`. Os aplicativos consultam essa rota na
abertura e às 03:00, e baixam a versão nova conferindo o hash antes de instalar.

Publicar **não força ninguém a instalar**: fora de uma atualização obrigatória,
o aplicativo só instala com o computador parado há 5 minutos, para não fechar na
cara de quem está trabalhando.

## Colocar quem ficou atrás na última versão

O painel **Quem já atualizou** lista cada computador (ou celular) com a versão
que tem instalada, quem está logado nele e se está ligado agora.

O botão **Instalar a x.y.z nos N que faltam** marca a última versão como
obrigatória e manda o aviso na hora: quem está ligado atualiza em seguida, mesmo
com alguém usando o computador, e quem está desligado atualiza ao abrir o
aplicativo. Ninguém passa pelas versões do meio — o servidor sempre entrega a
mais nova.

Na lista de versões, *tornar obrigatória* / *deixar opcional* faz a mesma troca
em qualquer versão, sem reenviar o arquivo.

## Tirar uma versão do ar

Na lista, *tirar do ar* apaga o arquivo do servidor. Quem já instalou continua
com ela; quem ainda não atualizou deixa de recebê-la.

## Organização do código

| Arquivo | Para que serve |
| --- | --- |
| `main.js` | Processo principal do Electron: janela, diálogos e ações |
| `servidor-api.js` | Conversa com o backend (sem Electron, dá para testar com Node puro) |
| `preload.js` | Ponte entre a tela e o processo principal |
| `index.html`, `estilo.css`, `app.js` | A tela |

## Rotas do servidor que ele usa

| Rota | Para quê |
| --- | --- |
| `POST /api/auth/login` | Entrar (só conta do TI) |
| `GET /api/atualizacoes/<app>` | Versões publicadas |
| `POST /api/atualizacoes/<app>` | Publicar (arquivo no corpo, dados nos cabeçalhos) |
| `PATCH /api/atualizacoes/<app>/<versao>` | Ligar/desligar a obrigatoriedade |
| `POST /api/atualizacoes/<app>/avisar` | Reenviar o aviso para quem está conectado |
| `DELETE /api/atualizacoes/<app>/<versao>` | Tirar do ar |
| `GET /api/computers` | Aparelhos e a versão que cada um tem |
| `GET /api/health` | Servidor de pé, versão que subiu e desde quando |

`PATCH`, `avisar` e a versão no `health` existem a partir do **servidor
1.27.0**. Em servidor mais antigo, o painel avisa que é preciso publicar o
pacote do servidor primeiro, e a faixa de cima mostra a última versão publicada
no lugar da que está rodando.
