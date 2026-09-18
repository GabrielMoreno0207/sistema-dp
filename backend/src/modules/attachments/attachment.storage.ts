import { createReadStream, existsSync, mkdirSync, type ReadStream } from 'node:fs';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
