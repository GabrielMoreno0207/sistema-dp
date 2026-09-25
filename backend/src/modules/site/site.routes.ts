/**
 * Página que aparece quando alguém abre o endereço do servidor no navegador
 * (https://comunica.trinys.com.br): o que é o Comunica Trinys e os downloads
 * da versão mais recente do aplicativo do computador e do celular.
 *
 * Os downloads são públicos (quem instala ainda não tem login) e sempre
 * entregam a última versão publicada no versionador.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../../config/env';
import type { UpdateService } from '../updates/update.service';
import type { AppName, ReleasePublico } from '../updates/update.types';
import { paginaInicial, paginaSemVersao } from './site.pagina';

/** /baixar/<nome> -> aplicativo no versionador */
const DOWNLOADS: Record<string, { app: AppName; semVersao: string }> = {
  desktop: { app: 'desktop', semVersao: 'Ainda não há versão publicada do aplicativo do computador.' },
  celular: { app: 'mobile', semVersao: 'Ainda não há versão publicada do aplicativo do celular.' },
};

/** Nada de página do sistema dentro de outro site; a página não roda script */
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function lerPublico(nome: string): Buffer | null {
  const caminho = join(PROJECT_ROOT, 'public', nome);
  return existsSync(caminho) ? readFileSync(caminho) : null;
}

/** Endereço que a pessoa digitou (atrás do nginx vem em X-Forwarded-*) */
function enderecoDoServidor(request: FastifyRequest): string {
  const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol).split(',')[0].trim();
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').split(',')[0].trim();
  return host ? `${proto === 'https' ? 'https' : 'http'}://${host}` : '';
}

function html(reply: FastifyReply, corpo: string, status = 200) {
  return reply
    .code(status)
    .header('Content-Security-Policy', CSP)
    .header('Cache-Control', 'no-cache')
    .type('text/html; charset=utf-8')
    .send(corpo);
}

export const siteRoutes: FastifyPluginAsync<{ updates: UpdateService }> = async (app, { updates }) => {
  const icone = lerPublico('icone.png');
  // Animação da página (a única página com script; o CSP só aceita script vindo daqui)
  const animacao = lerPublico('site-animacao.js');

  app.get('/site-animacao.js', async (_request, reply) => {
    if (!animacao) return reply.code(404).send();
    return reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'no-cache').send(animacao);
  });

  app.get('/', async (request, reply) => {
    const [desktop, celular] = await Promise.all([ultimaOuNada(updates, 'desktop'), ultimaOuNada(updates, 'mobile')]);
    return html(reply, paginaInicial({ desktop, celular, servidor: enderecoDoServidor(request) }));
  });

  app.get('/icone.png', async (_request, reply) => {
    if (!icone) return reply.code(404).send();
    return reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(icone);
  });

  app.get('/favicon.ico', async (_request, reply) => {
    if (!icone) return reply.code(404).send();
    return reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(icone);
  });

  app.get('/baixar/:qual', async (request, reply) => {
    const { qual } = request.params as { qual: string };
    const destino = DOWNLOADS[qual];
    if (!destino) return html(reply, paginaSemVersao('Download não encontrado.'), 404);

    const ultima = await ultimaOuNada(updates, destino.app);
    if (!ultima) return html(reply, paginaSemVersao(destino.semVersao), 404);

    const { release, conteudo } = await updates.abrirDownload(destino.app, ultima.versao);
    const tipo = destino.app === 'mobile' ? 'application/vnd.android.package-archive' : 'application/octet-stream';
    request.log.info(`Download público: ${release.arquivo} (${request.ip})`);
    return reply
      .header('Content-Type', tipo)
      .header('Content-Length', String(release.tamanho))
      .header('Content-Disposition', `attachment; filename="${release.arquivo}"`)
      .header('Cache-Control', 'no-cache')
      .header('X-Sha256', release.sha256)
      .send(conteudo);
  });
};

/** Última versão publicada; um problema no catálogo não derruba a página */
async function ultimaOuNada(updates: UpdateService, app: AppName): Promise<ReleasePublico | null> {
  try {
    return await updates.ultima(app);
  } catch {
    return null;
  }
}
