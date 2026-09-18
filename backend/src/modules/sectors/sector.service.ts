import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { SectorRepository } from './sector.repository';
import { normalizeName, sameName, SECTOR_NAME_MAX, type Sector } from './sector.types';

/**
 * Confere um nome de setor contra o cadastro e devolve a grafia cadastrada
 * ("producao" → "Produção"). Vazio = sem setor (null).
 */
export async function resolveSectorName(repository: SectorRepository, raw: string | null | undefined): Promise<string | null> {
  const name = normalizeName(raw);
  if (!name) return null;
  const match = (await repository.list()).find((s) => sameName(s.name, name));
  if (!match) throw new AppError(`O setor "${name}" não está cadastrado. Cadastre-o na seção Setores.`, 400, 'SECTOR_NOT_FOUND');
  return match.name;
}

/** Quem precisa saber quando um setor muda de nome (salas do WebSocket dos funcionários logados) */
export interface SectorChangeListener {
  sectorRenamed(newName: string): Promise<void>;
}

export class SectorService {
  constructor(
    private readonly repository: SectorRepository,
    private readonly listener: SectorChangeListener,
    private readonly log: FastifyBaseLogger,
  ) {}

  list(): Promise<Sector[]> {
    return this.repository.list();
  }

  private async get(id: string): Promise<Sector> {
    const sector = await this.repository.findById(id);
    if (!sector) throw new NotFoundError('Setor não encontrado');
    return sector;
  }

  private validName(raw: string): string {
    const name = normalizeName(raw);
    if (!name) throw new AppError('Informe o nome do setor', 400, 'VALIDATION_ERROR');
    if (name.length > SECTOR_NAME_MAX) throw new AppError(`Nome do setor com no máximo ${SECTOR_NAME_MAX} caracteres`, 400, 'VALIDATION_ERROR');
    return name;
  }

  private async ensureUnique(name: string, exceptId?: string): Promise<void> {
    const duplicate = (await this.repository.list()).find((s) => s.id !== exceptId && sameName(s.name, name));
    if (duplicate) throw new AppError(`O setor "${duplicate.name}" já existe`, 409, 'SECTOR_EXISTS');
  }

  async create(raw: string): Promise<Sector> {
    const name = this.validName(raw);
    await this.ensureUnique(name);
    const sector = await this.repository.create(name, new Date());
    this.log.info(`Setor criado: ${name}`);
    return sector;
  }

  async rename(id: string, raw: string): Promise<Sector> {
    const sector = await this.get(id);
    const name = this.validName(raw);
    if (name === sector.name) return sector;
    await this.ensureUnique(name, id);
    await this.repository.rename(id, sector.name, name);
    await this.listener.sectorRenamed(name);
    this.log.info(`Setor renomeado: ${sector.name} → ${name}`);
    return { ...sector, name };
  }

  async delete(id: string): Promise<void> {
    const sector = await this.get(id);
    if (sector.employeeCount > 0) {
      throw new AppError(
        `O setor "${sector.name}" tem ${sector.employeeCount} funcionário(s). Mude-os de setor (ou exclua-os) antes de excluir o setor.`,
        409,
        'SECTOR_IN_USE',
      );
    }
    await this.repository.delete(id);
    this.log.info(`Setor excluído: ${sector.name}`);
  }
}
