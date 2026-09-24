import { createReadStream, createWriteStream, existsSync, mkdirSync, type ReadStream } from 'node:fs';
import { readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** Erro usado quando o arquivo passa do teto (o serviço traduz para 413) */
export const ERRO_TAMANHO = 'ARQUIVO_GRANDE_DEMAIS';

/**
 * Guarda o conteúdo dos anexos em disco (uma pasta, um arquivo por anexo).
 * Trocar por outro destino (compartilhamento de rede, S3) = outra implementação desta classe.
 */
export class AttachmentStorage {
  constructor(private readonly directory: string) {
    mkdirSync(this.directory, { recursive: true });
  }

  /** Caminho absoluto, garantindo que storedName não escapa da pasta de anexos */
  private pathOf(storedName: string): string {
    const full = resolve(this.directory, storedName);
    if (!full.startsWith(resolve(this.directory))) throw new Error(`Nome de arquivo inválido: ${storedName}`);
    return full;
  }

  async save(storedName: string, content: Buffer): Promise<void> {
    await writeFile(this.pathOf(storedName), content, { flag: 'wx' }); // wx: nunca sobrescreve
  }

  /**
   * Grava o arquivo conforme ele chega, sem carregar tudo na memória: é assim
   * que uma imagem grande entra sem estourar o servidor. Devolve o tamanho.
   */
  async saveStream(storedName: string, dados: AsyncIterable<Buffer>, maxBytes: number): Promise<number> {
    const destino = this.pathOf(storedName);
    const parcial = `${destino}.parcial`;
    let tamanho = 0;

    async function* contando(): AsyncGenerator<Buffer> {
      for await (const parte of dados) {
        tamanho += parte.length;
        if (tamanho > maxBytes) throw new Error(ERRO_TAMANHO);
        yield parte;
      }
    }

    try {
      await pipeline(contando(), createWriteStream(parcial, { flags: 'wx' }));
      await rename(parcial, destino);
    } catch (err) {
      await rm(parcial, { force: true });
      throw err;
    }
    return tamanho;
  }

  exists(storedName: string): boolean {
    return existsSync(this.pathOf(storedName));
  }

  /** Stream para enviar o arquivo na resposta (não carrega tudo na memória) */
  read(storedName: string): ReadStream {
    return createReadStream(this.pathOf(storedName));
  }

  async size(storedName: string): Promise<number> {
    return (await stat(this.pathOf(storedName))).size;
  }

  async remove(storedName: string): Promise<void> {
    await rm(this.pathOf(storedName), { force: true });
  }

  /** Todos os arquivos que estão na pasta (para achar os que não têm mais registro no banco) */
  async list(): Promise<string[]> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  /** Quando o arquivo foi gravado (evita apagar um upload que está acontecendo agora) */
  async modifiedAt(storedName: string): Promise<number> {
    return (await stat(this.pathOf(storedName))).mtimeMs;
  }

  get path(): string {
    return join(this.directory);
  }
}
