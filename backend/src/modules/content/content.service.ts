import type { FastifyBaseLogger } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { EmployeeService } from '../employees/employee.service';
import type { MuralNotifier } from '../../realtime/socket-server';
import type { UserRepository } from '../users/user.repository';
import type { AtalhoRepository, MidiaRepository, MuralRepository } from './content.repository';
import { ERRO_TAMANHO, type MidiaStorage } from './content.storage';
import {
  DESTINOS,
  LIMITES_CONTEUDO,
  gerarIdAtalho,
  gerarIdMidia,
  gerarIdMural,
  limiteDoTipo,
  midiaPublica,
  tipoAceito,
  type Atalho,
  type DestinoAtalho,
  type Midia,
  type MidiaPublica,
  type MuralPost,
  type MuralPostCompleto,
} from './content.types';

export interface EnvioMidia {
  mimeType: string;
  nome: string;
  enviadoPor: string;
}

export interface DadosMural {
  titulo: string;
  texto: string;
  midiaId: string | null;
  ativo: boolean;
}

export interface DadosAtalho {
  rotulo: string;
  icone: string;
  cor: string;
  destino: DestinoAtalho;
}

const COR_VALIDA = /^#[0-9a-f]{6}$/i;

function textoObrigatorio(valor: string, campo: string, maximo: number): string {
  const limpo = valor.trim();
  if (!limpo) throw new AppError(`Informe ${campo}.`, 400, 'CAMPO_OBRIGATORIO');
  if (limpo.length > maximo) throw new AppError(`${campo} passa de ${maximo} caracteres.`, 400, 'CAMPO_LONGO');
  return limpo;
}

/** Link de curta duração: a Central exibe a mídia em <img>/<video>, que não mandam cabeçalho. */
interface Ticket {
  midiaId: string;
  expiraEm: number;
}

/** Cinco minutos: tempo de sobra para carregar a página e começar o vídeo */
const TICKET_TTL_MS = 5 * 60 * 1000;

export class ContentService {
  private readonly tickets = new Map<string, Ticket>();

  constructor(
    private readonly midias: MidiaRepository,
    private readonly mural: MuralRepository,
    private readonly atalhos: AtalhoRepository,
    private readonly users: UserRepository,
    private readonly employees: EmployeeService,
    private readonly storage: MidiaStorage,
    private readonly realtime: MuralNotifier,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ---------------------------------------------------------------- mídias

  /** Recebe o arquivo como fluxo, grava em disco e registra no banco. */
  async enviarMidia(envio: EnvioMidia, dados: Readable): Promise<MidiaPublica> {
    const aceito = tipoAceito(envio.mimeType);
    if (!aceito) {
      throw new AppError(
        `Tipo de arquivo não aceito: ${envio.mimeType}. Envie imagem (JPG, PNG, WEBP, GIF) ou vídeo (MP4, WEBM).`,
        415,
        'TIPO_NAO_ACEITO',
      );
    }

    const id = gerarIdMidia();
    const storedName = `${id}${aceito.extensao}`;
    let gravado: { tamanho: number; sha256: string };
    try {
      gravado = await this.storage.salvar(storedName, dados, limiteDoTipo(aceito.tipo));
    } catch (err) {
      if ((err as Error).message === ERRO_TAMANHO) {
        const limite = Math.round(limiteDoTipo(aceito.tipo) / 1024 / 1024);
        throw new AppError(`O arquivo passa do limite de ${limite} MB.`, 413, 'MIDIA_GRANDE_DEMAIS');
      }
      throw err;
    }
    if (gravado.tamanho === 0) {
      await this.storage.remover(storedName);
      throw new AppError('O arquivo enviado está vazio.', 400, 'MIDIA_VAZIA');
    }

    const midia: Midia = {
      id,
      tipo: aceito.tipo,
      nome: envio.nome.slice(0, LIMITES_CONTEUDO.maxNomeArquivo) || storedName,
      mimeType: envio.mimeType.toLowerCase(),
      tamanho: gravado.tamanho,
      sha256: gravado.sha256,
      storedName,
      enviadoPor: envio.enviadoPor,
      createdAt: new Date().toISOString(),
    };
    await this.midias.create(midia);
    this.log.info(`Mídia enviada: ${midia.id} (${midia.tipo}, ${(midia.tamanho / 1024 / 1024).toFixed(1)} MB) por ${midia.enviadoPor}`);
    return midiaPublica(midia);
  }

  /** Dados da mídia + tamanho em disco, para a rota montar a resposta (inclusive por partes). */
  async abrirMidia(id: string): Promise<{ midia: Midia; tamanho: number }> {
    const midia = await this.midias.findById(id);
    if (!midia || !this.storage.existe(midia.storedName)) throw new NotFoundError('Mídia não encontrada');
    return { midia, tamanho: await this.storage.tamanho(midia.storedName) };
  }

  fluxoDaMidia(midia: Midia, inicio?: number, fim?: number): Readable {
    return this.storage.ler(midia.storedName, inicio, fim);
  }

  /**
   * Cria um link temporário para a mídia. Quem chama já conferiu quem é a pessoa;
   * o link serve para o navegador exibir a imagem ou tocar o vídeo, já que
   * <img> e <video> não têm como enviar o token.
   */
  criarTicket(midiaId: string): { url: string; expiraEmSegundos: number } {
    this.limparTickets();
    const ticket = randomBytes(24).toString('hex');
    this.tickets.set(ticket, { midiaId, expiraEm: Date.now() + TICKET_TTL_MS });
    return {
      url: `/api/midias/${encodeURIComponent(midiaId)}?t=${ticket}`,
      expiraEmSegundos: Math.floor(TICKET_TTL_MS / 1000),
    };
  }

  /** O link vale para esta mídia e ainda está no prazo? */
  conferirTicket(midiaId: string, ticket: string): boolean {
    const achado = this.tickets.get(ticket);
    if (!achado) return false;
    if (achado.expiraEm < Date.now()) {
      this.tickets.delete(ticket);
      return false;
    }
    return achado.midiaId === midiaId;
  }

  private limparTickets(): void {
    const agora = Date.now();
    for (const [ticket, dados] of this.tickets) if (dados.expiraEm < agora) this.tickets.delete(ticket);
  }

  // ---------------------------------------------------------------- mural

  /** O recado em exibição na tela inicial (com a mídia já resolvida). */
  async muralAtivo(): Promise<MuralPostCompleto | null> {
    const post = await this.mural.findAtivo();
    return post ? this.completar(post) : null;
  }

  async listarMural(limite = 30): Promise<MuralPostCompleto[]> {
    const posts = await this.mural.listAll(limite);
    return Promise.all(posts.map((post) => this.completar(post)));
  }

  private async completar(post: MuralPost): Promise<MuralPostCompleto> {
    const { midiaId, ...resto } = post;
    if (!midiaId) return { ...resto, midia: null };
    const midia = await this.midias.findById(midiaId);
    return { ...resto, midia: midia ? midiaPublica(midia) : null };
  }

  async criarMural(dados: DadosMural, criadoPor: string): Promise<MuralPostCompleto> {
    const agora = new Date().toISOString();
    const post: MuralPost = {
      id: gerarIdMural(),
      titulo: textoObrigatorio(dados.titulo, 'o título', LIMITES_CONTEUDO.maxTitulo),
      texto: textoObrigatorio(dados.texto, 'o texto', LIMITES_CONTEUDO.maxTexto),
      midiaId: await this.midiaExistente(dados.midiaId),
      ativo: dados.ativo,
      criadoPor,
      createdAt: agora,
      updatedAt: agora,
    };
    await this.mural.create(post);
    this.realtime.muralAtualizado();
    this.log.info(`Mural publicado por ${criadoPor}: ${post.titulo}`);
    return this.completar(post);
  }

  async atualizarMural(id: string, dados: DadosMural): Promise<MuralPostCompleto> {
    const atual = await this.mural.findById(id);
    if (!atual) throw new NotFoundError('Recado do mural não encontrado');
    const atualizado = await this.mural.update(
      id,
      {
        titulo: textoObrigatorio(dados.titulo, 'o título', LIMITES_CONTEUDO.maxTitulo),
        texto: textoObrigatorio(dados.texto, 'o texto', LIMITES_CONTEUDO.maxTexto),
        midiaId: await this.midiaExistente(dados.midiaId),
        ativo: dados.ativo,
      },
      new Date().toISOString(),
    );
    this.realtime.muralAtualizado();
    return this.completar(atualizado);
  }

  async removerMural(id: string): Promise<void> {
    const removido = await this.mural.delete(id);
    if (!removido) throw new NotFoundError('Recado do mural não encontrado');
    this.realtime.muralAtualizado();
  }

  private async midiaExistente(midiaId: string | null): Promise<string | null> {
    if (!midiaId) return null;
    const midia = await this.midias.findById(midiaId);
    if (!midia) throw new AppError('A imagem ou vídeo escolhido não existe mais.', 400, 'MIDIA_INEXISTENTE');
    return midia.id;
  }

  // ---------------------------------------------------------------- atalhos do colaborador

  async listarAtalhos(computerId: string): Promise<Atalho[]> {
    const employee = await this.employeeDoPc(computerId);
    return this.atalhos.listByUser(employee.id);
  }

  async criarAtalho(computerId: string, dados: DadosAtalho): Promise<Atalho> {
    const employee = await this.employeeDoPc(computerId);
    const quantos = await this.atalhos.countByUser(employee.id);
    if (quantos >= LIMITES_CONTEUDO.atalhosPorUsuario) {
      throw new AppError(
        `Você já tem ${LIMITES_CONTEUDO.atalhosPorUsuario} atalhos. Apague um antes de criar outro.`,
        409,
        'ATALHOS_NO_LIMITE',
      );
    }
    const atalho: Atalho = {
      id: gerarIdAtalho(),
      userId: employee.id,
      ordem: quantos,
      ...this.validarAtalho(dados),
      createdAt: new Date().toISOString(),
    };
    return this.atalhos.create(atalho);
  }

  async atualizarAtalho(computerId: string, id: string, dados: DadosAtalho): Promise<Atalho> {
    const atalho = await this.atalhoDoFuncionario(computerId, id);
    return this.atalhos.update(id, { ...this.validarAtalho(dados), ordem: atalho.ordem });
  }

  async removerAtalho(computerId: string, id: string): Promise<void> {
    await this.atalhoDoFuncionario(computerId, id);
    await this.atalhos.delete(id);
  }

  async reordenarAtalhos(computerId: string, ids: string[]): Promise<Atalho[]> {
    const employee = await this.employeeDoPc(computerId);
    const meus = await this.atalhos.listByUser(employee.id);
    const meusIds = new Set(meus.map((a) => a.id));
    if (ids.length !== meus.length || ids.some((id) => !meusIds.has(id))) {
      throw new AppError('A lista de atalhos não confere com a sua.', 400, 'ORDEM_INVALIDA');
    }
    await this.atalhos.reordenar(employee.id, ids);
    return this.atalhos.listByUser(employee.id);
  }

  /** Um atalho só pode ser mexido por quem o criou. */
  private async atalhoDoFuncionario(computerId: string, id: string): Promise<Atalho> {
    const employee = await this.employeeDoPc(computerId);
    const atalho = await this.atalhos.findById(id);
    if (!atalho || atalho.userId !== employee.id) throw new NotFoundError('Atalho não encontrado');
    return atalho;
  }

  private validarAtalho(dados: DadosAtalho): DadosAtalho {
    if (!DESTINOS.includes(dados.destino)) {
      throw new AppError(`Destino inválido: ${dados.destino}.`, 400, 'DESTINO_INVALIDO');
    }
    if (!COR_VALIDA.test(dados.cor)) {
      throw new AppError('A cor precisa estar no formato #RRGGBB.', 400, 'COR_INVALIDA');
    }
    return {
      rotulo: textoObrigatorio(dados.rotulo, 'o nome do atalho', LIMITES_CONTEUDO.maxRotulo),
      icone: textoObrigatorio(dados.icone, 'o ícone', 8),
      cor: dados.cor.toLowerCase(),
      destino: dados.destino,
    };
  }

  // ---------------------------------------------------------------- foto de perfil

  /** Troca a foto do funcionário logado no PC e apaga a anterior. */
  async definirFotoDoFuncionario(computerId: string, midiaId: string): Promise<MidiaPublica> {
    const employee = await this.employeeDoPc(computerId);
    const midia = await this.midias.findById(midiaId);
    if (!midia) throw new NotFoundError('Foto não encontrada');
    if (midia.tipo !== 'IMAGEM') throw new AppError('A foto de perfil precisa ser uma imagem.', 400, 'FOTO_INVALIDA');

    const atual = await this.users.findById(employee.id);
    await this.users.updateFotoMidia(employee.id, midia.id);
    if (atual?.fotoMidiaId && atual.fotoMidiaId !== midia.id) await this.apagarMidia(atual.fotoMidiaId);
    return midiaPublica(midia);
  }

  async removerFotoDoFuncionario(computerId: string): Promise<void> {
    const employee = await this.employeeDoPc(computerId);
    const atual = await this.users.findById(employee.id);
    await this.users.updateFotoMidia(employee.id, null);
    if (atual?.fotoMidiaId) await this.apagarMidia(atual.fotoMidiaId);
  }

  /** Foto de quem está logado no computador. */
  async fotoDoFuncionario(computerId: string): Promise<MidiaPublica | null> {
    const employee = await this.employeeDoPc(computerId);
    return this.fotoDoUsuario(employee.id);
  }

  async fotoDoUsuario(userId: string): Promise<MidiaPublica | null> {
    const user = await this.users.findById(userId);
    if (!user?.fotoMidiaId) return null;
    const midia = await this.midias.findById(user.fotoMidiaId);
    return midia ? midiaPublica(midia) : null;
  }

  /** Apaga o registro e o arquivo. Usado ao trocar a foto e na faxina. */
  async apagarMidia(id: string): Promise<void> {
    const midia = await this.midias.findById(id);
    if (!midia) return;
    await this.midias.delete(id);
    await this.storage.remover(midia.storedName);
  }

  private async employeeDoPc(computerId: string) {
    const employee = await this.employees.getSessionEmployee(computerId);
    if (!employee) throw new AppError('Entre com sua matrícula para usar esta função', 401, 'NO_EMPLOYEE');
    return employee;
  }
}
