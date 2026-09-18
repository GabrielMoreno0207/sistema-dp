import { readFileSync } from 'node:fs';
import { env } from './config/env';
import { buildApp } from './app';
import { createSqliteRepositories } from './database/repositories';
import { openSqliteDatabase, type SqliteDatabase } from './database/sqlite';

async function main(): Promise<void> {
  let database: SqliteDatabase;
  let https: { cert: Buffer; key: Buffer } | null = null;
  try {
    database = openSqliteDatabase(env.databasePath);
    if (env.tls) https = { cert: readFileSync(env.tls.certFile), key: readFileSync(env.tls.keyFile) };
  } catch (err) {
    console.error('Falha ao iniciar:', err);
    process.exit(1);
  }

  const app = buildApp({ repositories: createSqliteRepositories(database), https });
  app.log.info(`Banco de dados SQLite: ${env.databasePath}`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Sinal ${signal} recebido. Encerrando backend...`);
    try {
      await app.close();
      database.close();
      app.log.info('Backend encerrado');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Erro ao encerrar backend');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  const protocol = https ? 'https' : 'http';
  try {
    // Fila de conexões pendentes maior: muitos PCs reconectando juntos não recebem "conexão recusada"
    await app.listen({ host: env.host, port: env.port, backlog: 2048 });
    app.log.info(`Backend iniciado na porta ${env.port} (ambiente: ${env.nodeEnv}, ${protocol.toUpperCase()})`);
    if (!https && env.nodeEnv === 'production' && !env.trustProxy) {
      app.log.warn('Produção sem HTTPS: senhas e tokens trafegam sem cifra. Veja "HTTPS" no README.');
    }
    console.log(`Servidor DP rodando em ${protocol}://${env.host}:${env.port}`);
  } catch (err) {
    app.log.fatal({ err }, 'Falha ao iniciar o backend');
    process.exit(1);
  }
}

void main();
