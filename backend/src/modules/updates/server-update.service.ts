import type { FastifyBaseLogger } from 'fastify';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../../errors/app-error';

/**
 * Atualização do próprio servidor, publicada pelo versionador.
 *
 * O backend roda a partir de uma pasta em volume (APP_PATH, /app/aplicativo no
 * container), e não de dentro da imagem. Aqui o pacote recebido é conferido e
 * deixado pronto em "proximo"; ao sair, o Docker reinicia o container e o
 * entrypoint faz a troca. Se a versão nova não subir, ele devolve a anterior.
 *
 * Nada disso roda fora do container: em desenvolvimento a atualização é recusada.
 */
export class ServerUpdateService {
  constructor(
    private readonly appPath: string | null,
    private readonly log: FastifyBaseLogger,
    /** Separado para o teste conferir o preparo sem derrubar o processo */
    private readonly encerrar: () => void = () => process.exit(0),
  ) {}

  get disponivel(): boolean {
    return this.appPath !== null && existsSync(this.appPath);
  }

  /**
   * Extrai o pacote em "proximo" e agenda a saída do processo. A resposta HTTP
   * ainda sai antes: quem publicou recebe a confirmação e só então o servidor cai.
   */
  async aplicar(caminhoDoPacote: string, versao: string): Promise<void> {
    if (!this.appPath || !existsSync(this.appPath)) {
      throw new AppError(
        'Este servidor não está preparado para se atualizar sozinho (APP_PATH ausente). Atualize pelo docker compose.',
        409,
        'ATUALIZACAO_INDISPONIVEL',
      );
    }

    const preparo = join(this.appPath, 'proximo-parcial');
    const pronto = join(this.appPath, 'proximo');
    await rm(preparo, { recursive: true, force: true });
    await mkdir(preparo, { recursive: true });

    await this.extrair(caminhoDoPacote, preparo);
    await this.conferirPacote(preparo, versao);

    await rm(pronto, { recursive: true, force: true });
    await rename(preparo, pronto);

    this.log.warn(`Atualização do servidor ${versao} pronta: reiniciando para aplicar`);
    // Tempo para a resposta chegar a quem publicou antes de o processo sair
    setTimeout(() => this.encerrar(), 1_500).unref();
  }

  /** O tar do sistema faz o trabalho: nada de biblioteca nova só para descompactar. */
  private extrair(pacote: string, destino: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const processo = spawn('tar', ['-xzf', pacote, '-C', destino], { stdio: ['ignore', 'ignore', 'pipe'] });
      let erro = '';
      processo.stderr.on('data', (parte: Buffer) => {
        erro += parte.toString();
      });
      processo.on('error', (err) => reject(new AppError(`Não consegui abrir o pacote: ${err.message}`, 400, 'PACOTE_INVALIDO')));
      processo.on('close', (codigo) => {
        if (codigo === 0) resolve();
        else reject(new AppError(`O pacote não pôde ser aberto (tar ${codigo}): ${erro.trim()}`, 400, 'PACOTE_INVALIDO'));
      });
    });
  }

  /** Um pacote incompleto derrubaria o servidor: confere antes de deixá-lo pronto. */
  private async conferirPacote(pasta: string, versaoEsperada: string): Promise<void> {
    const obrigatorios = ['dist/server.js', 'node_modules', 'public', 'package.json'];
    for (const item of obrigatorios) {
      if (!existsSync(join(pasta, item))) {
        await rm(pasta, { recursive: true, force: true });
        throw new AppError(`O pacote do servidor não tem "${item}".`, 400, 'PACOTE_INCOMPLETO');
      }
    }

    try {
      const manifesto = JSON.parse(await readFile(join(pasta, 'package.json'), 'utf-8')) as { version?: string };
      if (manifesto.version !== versaoEsperada) {
        throw new AppError(
          `O pacote diz ser a versão ${manifesto.version ?? '(sem versão)'}, mas foi publicado como ${versaoEsperada}.`,
          400,
          'VERSAO_DIVERGENTE',
        );
      }
    } catch (err) {
      await rm(pasta, { recursive: true, force: true });
      if (err instanceof AppError) throw err;
      throw new AppError('O package.json do pacote não pôde ser lido.', 400, 'PACOTE_INVALIDO');
    }
  }

  /**
   * Apaga a marca deixada pelo entrypoint. É chamada quando o servidor termina
   * de subir: a partir daí a versão nova está aprovada e não volta mais sozinha.
   */
  async confirmarSubida(): Promise<void> {
    if (!this.appPath) return;
    const marca = join(this.appPath, 'em-teste');
    if (!existsSync(marca)) return;
    await rm(marca, { force: true });
    this.log.warn('Atualização do servidor confirmada: a versão nova subiu');
  }
}
