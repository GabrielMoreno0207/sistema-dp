/**
 * Entrada do app.
 * - A tela (App) aparece quando o funcionário abre o app.
 * - "DpConnectionTask" roda dentro do serviço em segundo plano (DpService.kt), iniciado quando o
 *   celular liga: mantém a conexão com o servidor mesmo com o app fechado.
 * Os dois usam o mesmo estado (src/core/store.ts) e a mesma conexão (src/core/connection.ts).
 */
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { boot } from './src/core/connection';

AppRegistry.registerComponent(appName, () => App);

AppRegistry.registerHeadlessTask('DpConnectionTask', () => async () => {
  try {
    await boot();
  } catch (err) {
    console.warn('[serviço] falha ao iniciar a conexão', err);
  }
  // Nunca termina: enquanto a tarefa roda, o Android mantém os timers do JavaScript ativos
  await new Promise(() => {});
});
