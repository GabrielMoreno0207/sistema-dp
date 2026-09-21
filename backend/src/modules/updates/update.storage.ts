import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { arquivoValido, ordenarPorVersao, type AppName, type Release } from './update.types';

/**
 * Os arquivos das versões ficam em pasta, não no banco: são grandes, não mudam
 * depois de publicados e precisam ser servidos como download.
 *
 *   <base>/desktop/versoes.json          catálogo do aplicativo
 *   <base>/desktop/ComunicacaoDP-Setup-1.5.0.exe
 */
export class UpdateStorage {
  constructor(private readonly base: string) {}

  private pastaApp(app: AppName): string {
    return join(this.base, app);
  }

  private catalogo(app: AppName): string {
    return join(this.pastaApp(app), 'versoes.json');
  }

  /** Caminho do arquivo, garantindo que o nome não escape da pasta do aplicativo. */
  caminhoArquivo(app: AppName, arquivo: string): string {
    if (!arquivoValido(arquivo)) throw new Error(`Nome de arquivo inválido: ${arquivo}`);
    const pasta = resolve(this.pastaApp(app));
    const caminho = resolve(pasta, arquivo);
    if (!caminho.startsWith(pasta)) throw new Error(`Nome de arquivo inválido: ${arquivo}`);
    return caminho;
  }

  async listar(app: AppName): Promise<Release[]> {
    try {
      const conteudo = await readFile(this.catalogo(app), 'utf-8');
      const lista = JSON.parse(conteudo) as Release[];
      return ordenarPorVersao(Array.isArray(lista) ? lista : []);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  /** Grava o catálogo em arquivo temporário e troca no fim: nunca fica pela metade. */
  private async gravarCatalogo(app: AppName, releases: Release[]): Promise<void> {
    await mkdir(this.pastaApp(app), { recursive: true });
    const destino = this.catalogo(app);
    const temporario = `${destino}.tmp`;
    await writeFile(temporario, JSON.stringify(ordenarPorVersao(releases), null, 2), 'utf-8');
    await rename(temporario, destino);
  }

  /**
   * Salva o arquivo enviado e devolve tamanho e SHA-256, calculados durante a gravação.
   */
  async salvarArquivo(
    app: AppName,
    arquivo: string,
    dados: Readable,
    maxBytes: number,
  ): Promise<{ tamanho: number; sha256: string }> {
    const caminho = this.caminhoArquivo(app, arquivo);
    await mkdir(this.pastaApp(app), { recursive: true });
    const temporario = `${caminho}.parcial`;

    const hash = createHash('sha256');
    let tamanho = 0;
    dados.on('data', (parte: Buffer) => {
      hash.update(parte);
      tamanho += parte.length;
      // Corta o envio no limite, em vez de encher o disco
      if (tamanho > maxBytes) dados.destroy(new Error('ARQUIVO_GRANDE_DEMAIS'));
    });

    try {
      await pipeline(dados, createWriteStream(temporario));
      await rename(temporario, caminho);
    } catch (err) {
      await rm(temporario, { force: true });
      throw err;
    }
    return { tamanho, sha256: hash.digest('hex') };
  }

  async registrar(release: Release): Promise<void> {
    const atuais = (await this.listar(release.app)).filter((r) => r.versao !== release.versao);
    await this.gravarCatalogo(release.app, [...atuais, release]);
  }

  /** Tira a versão do ar: sai do catálogo e o arquivo é apagado. */
  async remover(app: AppName, versao: string): Promise<Release | null> {
    const atuais = await this.listar(app);
    const alvo = atuais.find((r) => r.versao === versao);
    if (!alvo) return null;
    await this.gravarCatalogo(
      app,
      atuais.filter((r) => r.versao !== versao),
    );
    await rm(this.caminhoArquivo(app, alvo.arquivo), { force: true });
    return alvo;
  }

  existeArquivo(app: AppName, arquivo: string): boolean {
    return existsSync(this.caminhoArquivo(app, arquivo));
  }

  abrirArquivo(app: AppName, arquivo: string): Readable {
    return createReadStream(this.caminhoArquivo(app, arquivo));
  }
}
