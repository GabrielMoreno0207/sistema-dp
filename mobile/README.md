# Comunica Trinys — app Android

App do celular com as mesmas funções do app do computador, no mesmo servidor:

- **Início:** meus atalhos, mural, calendário (anotações e eventos da empresa) e conversas recentes.
- **Comunicados:** lista, anexos e "Li e estou ciente" nos comunicados que pedem ciência.
- **Mensagens:** conversas com colegas e com o DP, grupos, fotos, vídeos e documentos (galeria, câmera ou arquivos), responder citando, encaminhar, apagar e procurar na conversa.
- **Mais:** perfil, foto com enquadramento, troca de senha e, para quem é do setor do **DP** ou do **TI**, as telas de administração: enviar comunicados e ver quem leu, mural, cadastros (funcionários, setores e aparelhos) e ajustes (resposta automática, "receber mensagens só do DP e do TI" e, para o TI, as contas próprias (hoje só a `ti`) e a limpeza de dados).
- Chamados para o TI, Fila do TI e Conversas (TI) aparecem como **em construção**, como no computador.
- O layout se ajusta à tela: em tablet ou celular deitado o conteúdo fica centralizado e a grade de atalhos ganha colunas.

- **Só Android**, instalado por arquivo `.apk`, sem Google Play.
- **Só na rede da empresa:** o celular precisa estar no Wi-Fi da empresa, e o endereço é o mesmo dos computadores (ex.: `http://servidor-dp:3000`).
- **Liga sozinho com o celular:** um serviço em segundo plano mantém a conexão. Ele aparece como uma notificação fixa "Comunica Trinys · Conectado". Os avisos chegam **com o app fechado**, com som e vibração; os **urgentes** podem aparecer em tela cheia. Não usa Firebase nem internet.

## Instalar em um celular

1. Copie `dist/ComunicacaoDP-<versão>.apk` para o celular (cabo USB, pasta de rede ou e-mail interno).
2. Abra o arquivo no celular e permita "instalar apps desta fonte", se o Android pedir.
3. Abra **Comunica Trinys**:
   1. **Configurar servidor:** endereço do servidor (o mesmo usado nos computadores). Toque em **Testar** e depois em **Salvar e conectar**.
   2. **Permitir notificações**, quando o Android perguntar.
   3. **Entrar** com o usuário e a senha do funcionário (as mesmas do computador).
   4. Na tela **Início**, toque em **Configurar** (ou vá em Mais → **Configurar celular**) e faça os passos:
      - **Notificações** permitidas;
      - **Bateria sem restrição**: sem isso o Android desliga o app para economizar bateria;
      - **Início automático**: em Xiaomi, Samsung, Motorola e outras marcas há um ajuste a mais (o botão abre a tela certa);
      - **Tela cheia para urgentes** (opcional; Android 14 ou mais novo).
4. Pronto. Reinicie o celular uma vez para conferir: a notificação fixa "Comunica Trinys" deve aparecer sozinha.

Em **Cadastros → Aparelhos**, o celular aparece com 📱 e um ID `CEL-...`. Ele recebe os comunicados como um computador: para Todos, para o setor e o turno do funcionário logado e para aquele aparelho.

## Atualização automática

Depois da primeira instalação, as versões novas chegam sozinhas:

1. O TI publica o APK no **versionador**, aba **[ mobile ]**, com a mesma versão do `package.json`.
2. Cada celular conectado baixa o APK na hora (ou ao abrir o app), confere o SHA-256 e mostra **"Versão x pronta para instalar"** no Início e em Mais → **Sobre e atualização**. Com o app fechado, chega uma notificação.
3. A pessoa toca em **Instalar** e confirma na tela do Android. Na primeira vez o Android pede para permitir "instalar apps desta fonte" para o Comunica Trinys.

A instalação sem confirmação só seria possível com MDM ou app de sistema.

> Se alguém usar **Forçar parada** nas configurações do Android, o app só volta a funcionar depois de ser aberto de novo. Isso é uma regra do Android.

## Gerar o APK (neste PC)

Dê dois cliques em **`gerar-apk.cmd`**. O arquivo sai em `dist/ComunicacaoDP-<versão>.apk`.

- Usa o JDK 17 e o Android SDK instalados em `C:\android-dev`.
- A primeira vez demora mais (o Gradle baixa as dependências).
- O APK é assinado com a chave da empresa: `android/app/comunicacaodp-release.keystore`, com as senhas em `android/keystore.properties` (a senha também está na nota **"Usuários e senhas"**). **Guarde cópia dos dois arquivos.** Sem essa chave, uma versão nova não instala por cima da antiga, e cada celular teria que desinstalar e configurar de novo.
- Para lançar uma versão nova: aumente `version` no `package.json` e `versionCode` e `versionName` em `android/app/build.gradle`, depois gere de novo.

## Estrutura

| Pasta/arquivo | O que é |
|---|---|
| `App.tsx` | Navegação: abas (Início, Comunicados, Mensagens, Mais) e telas empilhadas |
| `index.js` | Entrada do app e tarefa em segundo plano `DpConnectionTask` |
| `src/core/connection.ts` | Registro do aparelho, WebSocket, reconexão, avisos e ações |
| `src/core/api.ts`, `validation.ts`, `types.ts` | API REST do servidor e conferência dos dados recebidos |
| `src/core/storage.ts` | Endereço, chave e segredo do aparelho, cifrados pelo Android Keystore |
| `src/core/arquivos.ts` | Escolher arquivo ou foto, enviar ao servidor e abrir o que chegou |
| `src/core/atualizacao.ts` | Atualização automática: verifica, baixa, confere o SHA-256 e abre o instalador |
| `src/ui/` | Tema (claro e escuro), componentes, navegação (`nav.tsx`) e telas (`screens/`, com as do DP/TI em `Admin*.tsx`) |
| `src/specs/NativeDpNative.ts` | Contrato do módulo nativo (Turbo Module) |
| `android/app/src/main/java/br/com/comunicacaodp/` | Kotlin: `DpService` (serviço em primeiro plano), `BootReceiver` (inicia com o celular), `Notifications`, `DpModule` e `DpFiles` (envio, download, recorte de foto e instalação do APK) |

## Desenvolvimento

```bash
npm install
npm run typecheck
npx react-native start        # Metro (JavaScript)
npx react-native run-android  # instala no emulador ou celular conectado (depuração)
```

No emulador, o servidor do PC é acessado em `http://10.0.2.2:3000`.
