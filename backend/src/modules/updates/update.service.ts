import type { FastifyBaseLogger } from 'fastify';
import type { Readable } from 'node:stream';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { UpdateStorage } from './update.storage';
import {
  compararVersoes,
  LIMITES,
  versaoValida,
  arquivoValido,
  type AppName,
  type CheckResult,
  type Release,
  type ReleasePublico,
} from './update.types';

export interface PublicarInput {
  versao: string;
  arquivo: string;
  notas: string;
  obrigatoria: boolean;
  publicadoPor: string;
}

function paraPublico(release: Release): ReleasePublico {
  const { arquivo: _arquivo, ...resto } = release;
  return { ...resto, url: `/api/atualizacoes/${release.app}/download/${release.versao}` };
}

export class UpdateService {
  constructor(
    private readonly storage: UpdateStorage,
    private readonly log: FastifyBaseLogger,
  ) {}

  async listar(app: AppName): Promise<ReleasePublico[]> {
    return (await this.storage.listar(app)).map(paraPublico);
  }

  async ultima(app: AppName): Promise<ReleasePublico | null> {
    const [mais_nova] = await this.storage.listar(app);
    return mais_nova ? paraPublico(mais_nova) : null;
  }

  /** O app manda a versão que tem instalada e descobre se existe uma mais nova. */
  async verificar(app: AppName, versaoInstalada: string | null): Promise<CheckResult> {
    const ultima = await this.ultima(app);
    const temAtualizacao =
      ultima !== null && (versaoInstalada === null || compararVersoes(ultima.versao, versaoInstalada) > 0);
    return { temAtualizacao, versaoInstalada, release: temAtualizacao ? ultima : null };
  }

  async publicar(app: AppName, input: PublicarInput, dados: Readable): Promise<ReleasePublico> {
    if (!versaoValida(input.versao)) {
      throw new AppError(`Versão inválida: "${input.versao}". Use o formato 1.2.3.`, 400, 'VERSAO_INVALIDA');
    }
    if (!arquivoValido(input.arquivo)) {
      throw new AppError(`Nome de arquivo inválido: "${input.arquivo}".`, 400, 'ARQUIVO_INVALIDO');
    }
    if (input.notas.length > LIMITES.maxNotas) {
      throw new AppError(`As notas da versão passam de ${LIMITES.maxNotas} caracteres.`, 400, 'NOTAS_LONGAS');
    }

    const jaExiste = (await this.storage.listar(app)).some((r) => r.versao === input.versao);
    if (jaExiste) {
      throw new AppError(
        `A versão ${input.versao} do ${app} já está publicada. Suba o número da versão ou remova a atual antes.`,
        409,
        'VERSAO_DUPLICADA',
      );
    }

    let gravado: { tamanho: number; sha256: string };
    try {
      gravado = await this.storage.salvarArquivo(app, input.arquivo, dados, LIMITES.maxBytes);
    } catch (err) {
      if ((err as Error).message === 'ARQUIVO_GRANDE_DEMAIS') {
        throw new AppError(
          `O arquivo passa do limite de ${Math.round(LIMITES.maxBytes / 1024 / 1024)} MB.`,
          413,
          'ARQUIVO_GRANDE_DEMAIS',
        );
      }
      throw err;
    }
    if (gravado.tamanho === 0) {
      throw new AppError('O arquivo enviado está vazio.', 400, 'ARQUIVO_VAZIO');
    }

    const release: Release = {
      app,
      versao: input.versao,
      arquivo: input.arquivo,
      tamanho: gravado.tamanho,
      sha256: gravado.sha256,
      notas: input.notas.trim(),
      obrigatoria: input.obrigatoria,
      publicadoEm: new Date().toISOString(),
      publicadoPor: input.publicadoPor,
    };
    await this.storage.registrar(release);
    this.log.info(
      `Versão publicada: ${app} ${release.versao} (${(release.tamanho / 1024 / 1024).toFixed(1)} MB) por ${release.publicadoPor}`,
    );
    return paraPublico(release);
  }

  async remover(app: AppName, versao: string, quem: string): Promise<void> {
    const removida = await this.storage.remover(app, versao);
    if (!removida) throw new NotFoundError(`Versão ${versao} do ${app} não encontrada`);
    this.log.warn(`Versão retirada do ar: ${app} ${versao} por ${quem}`);
  }

  /** Arquivo para download, junto com os dados da versão. */
  async abrirDownload(app: AppName, versao: string): Promise<{ release: Release; conteudo: Readable }> {
    const release = (await this.storage.listar(app)).find((r) => r.versao === versao);
    if (!release) throw new NotFoundError(`Versão ${versao} do ${app} não encontrada`);
    if (!this.storage.existeArquivo(app, release.arquivo)) {
      throw new NotFoundError(`O arquivo da versão ${versao} não está mais no servidor`);
    }
    return { release, conteudo: this.storage.abrirArquivo(app, release.arquivo) };
  }
}
