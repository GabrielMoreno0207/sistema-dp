import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, type ReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Erro usado quando o arquivo passa do limite do tipo (imagem ou vídeo). */
export const ERRO_TAMANHO = 'MIDIA_GRANDE_DEMAIS';

/**
 * Guarda imagens e vídeos em disco (data/midias), um arquivo por mídia.
 * O banco guarda só os dados; o conteúdo nunca passa inteiro pela memória.
 */
export class MidiaStorage {
  constructor(private readonly directory: string) {
    mkdirSync(this.directory, { recursive: true });
  }

  /** Caminho absoluto, garantindo que o nome não escapa da pasta de mídias */
  private caminho(storedName: string): string {
    const completo = resolve(this.directory, storedName);
    if (!completo.startsWith(resolve(this.directory))) throw new Error(`Nome de arquivo inválido: ${storedName}`);
    return completo;
  }

  /**
   * Grava o que chega da requisição, calculando tamanho e SHA-256 no caminho.
   * Passou do limite: o arquivo parcial é apagado e o erro ERRO_TAMANHO sobe.
   */
  async salvar(storedName: string, dados: Readable, maxBytes: number): Promise<{ tamanho: number; sha256: string }> {
    const destino = this.caminho(storedName);
    const parcial = `${destino}.parcial`;
    const hash = createHash('sha256');
    let tamanho = 0;

    dados.on('data', (parte: Buffer) => {
      hash.update(parte);
      tamanho += parte.length;
      if (tamanho > maxBytes) dados.destroy(new Error(ERRO_TAMANHO));
    });

    try {
      await pipeline(dados, createWriteStream(parcial));
      const { rename } = await import('node:fs/promises');
      await rename(parcial, destino);
    } catch (err) {
      await rm(parcial, { force: true });
      throw err;
    }
    return { tamanho, sha256: hash.digest('hex') };
  }

  existe(storedName: string): boolean {
    return existsSync(this.caminho(storedName));
  }

  /**
   * Fluxo de leitura. Com início e fim, lê só esse pedaço — é o que permite
   * o vídeo começar do meio quando a pessoa arrasta a barra (Range).
   */
  ler(storedName: string, inicio?: number, fim?: number): ReadStream {
    return createReadStream(this.caminho(storedName), inicio === undefined ? undefined : { start: inicio, end: fim });
  }

  async tamanho(storedName: string): Promise<number> {
    return (await stat(this.caminho(storedName))).size;
  }

  async remover(storedName: string): Promise<void> {
    await rm(this.caminho(storedName), { force: true });
  }

  /** Arquivos na pasta (para achar os que não têm mais registro no banco) */
  async listar(): Promise<string[]> {
    const entradas = await readdir(this.directory, { withFileTypes: true });
    return entradas.filter((e) => e.isFile() && !e.name.endsWith('.parcial')).map((e) => e.name);
  }
}
