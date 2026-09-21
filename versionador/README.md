# Versionador — Comunicação DP

Aplicativo próprio (separado do Comunicação DP) para publicar novas versões no
servidor. Quem publica é a **conta do TI**; nenhuma outra conta consegue.

## Como usar

```powershell
cd versionador
npm install      # só na primeira vez
npm start
```

1. Informe o endereço do servidor e entre com a conta do TI.
2. Escolha a aba do aplicativo: **desktop**, **mobile** ou **backend**.
3. Clique em *escolher arquivo…* e selecione o instalador (`.exe`), o APK ou o
   pacote do servidor. A versão é preenchida sozinha a partir do nome do arquivo.
4. Escreva o que mudou (esse texto aparece para quem vai atualizar) e publique.

O endereço do servidor e o usuário ficam guardados; a senha é pedida a cada uso.

## O que acontece depois de publicar

O servidor guarda o arquivo, calcula o SHA-256 e passa a responder em
`/api/atualizacoes/<app>/verificar`. Os aplicativos consultam essa rota no
horário configurado e baixam a versão nova, conferindo o hash antes de instalar.

Marcar **atualização obrigatória** faz o aplicativo não permitir adiar.

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
