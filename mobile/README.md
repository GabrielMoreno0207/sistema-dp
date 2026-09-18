# Comunicação DP — app Android

App para os funcionários receberem os comunicados do DP e conversarem com as pessoas do DP pelo celular. Faz o mesmo que o app do computador e usa o mesmo servidor.

- **Só Android**, instalado por arquivo `.apk`, sem Google Play.
- **Só na rede da empresa:** o celular precisa estar no Wi-Fi da empresa, e o endereço é o mesmo dos computadores (ex.: `http://servidor-dp:3000`).
- **Liga sozinho com o celular:** um serviço em segundo plano mantém a conexão. Ele aparece como uma notificação fixa "Comunicação DP · Conectado". Os avisos chegam **com o app fechado**, com som e vibração; os **urgentes** podem aparecer em tela cheia. Não usa Firebase nem internet.

## Instalar em um celular

1. Copie `dist/ComunicacaoDP-<versão>.apk` para o celular (cabo USB, pasta de rede ou e-mail interno).
2. Abra o arquivo no celular e permita "instalar apps desta fonte", se o Android pedir.
3. Abra **Comunicação DP**:
   1. **Configurar servidor:** endereço do servidor (o mesmo usado nos computadores). Toque em **Testar** e depois em **Salvar e conectar**.
   2. **Permitir notificações**, quando o Android perguntar.
   3. **Entrar** com a matrícula e a senha do funcionário (as mesmas do computador).
   4. Na tela **Início**, toque em **Configurar** (ou vá em Perfil → **Configurar celular**) e faça os passos:
      - **Notificações** permitidas;
      - **Bateria sem restrição**: sem isso o Android desliga o app para economizar bateria;
      - **Início automático**: em Xiaomi, Samsung, Motorola e outras marcas há um ajuste a mais (o botão abre a tela certa);
      - **Tela cheia para urgentes** (opcional; Android 14 ou mais novo).
4. Pronto. Reinicie o celular uma vez para conferir: a notificação fixa "Comunicação DP" deve aparecer sozinha.

Na Central, o celular aparece em **Computadores** com 📱 e um ID `CEL-...`. Ele recebe os comunicados como um computador: para Todos, para o setor e o turno do funcionário logado e para aquele aparelho. O chat funciona igual ao do computador, com conversa individual com cada pessoa do DP.

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
| `App.tsx` | Telas e navegação (Início, Comunicados, Mensagens, Perfil) |
| `index.js` | Entrada do app e tarefa em segundo plano `DpConnectionTask` |
| `src/core/connection.ts` | Registro do aparelho, WebSocket, reconexão, avisos e ações |
| `src/core/api.ts`, `validation.ts`, `types.ts` | API REST do servidor e conferência dos dados recebidos |
| `src/core/storage.ts` | Endereço, chave e segredo do aparelho, cifrados pelo Android Keystore |
| `src/ui/` | Tema (claro e escuro), componentes e telas |
| `src/specs/NativeDpNative.ts` | Contrato do módulo nativo (Turbo Module) |
| `android/app/src/main/java/br/com/comunicacaodp/` | Kotlin: `DpService` (serviço em primeiro plano), `BootReceiver` (inicia com o celular), `Notifications`, `DpModule` |

## Desenvolvimento

```bash
npm install
npm run typecheck
npx react-native start        # Metro (JavaScript)
npx react-native run-android  # instala no emulador ou celular conectado (depuração)
```

No emulador, o servidor do PC é acessado em `http://10.0.2.2:3000`.
