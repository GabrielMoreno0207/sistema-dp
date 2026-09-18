import type { FastifyBaseLogger } from 'fastify';
import { AppError, NotFoundError } from '../../errors/app-error';
import { resolveSectorName } from '../sectors/sector.service';
import type { SectorRepository } from '../sectors/sector.repository';
import { sameName } from '../sectors/sector.types';
import type { AutoReplyRepository } from './auto-reply.repository';
import { AUTO_REPLY_CONTENT_MAX, type AutoReply, type AutoReplyInput } from './auto-reply.types';

/**
 * Respostas automáticas do chat: cada pessoa do DP escolhe, na Central, o texto
 * que o funcionário recebe quando escreve para ela — um por setor, mais um
 * opcional para "todos os setores".
 */
export class AutoReplyService {
  constructor(
    private readonly repository: AutoReplyRepository,
    private readonly sectors: SectorRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  list(dpUserId: string): Promise<AutoReply[]> {
    return this.repository.listByDpUser(dpUserId);
  }

  private async own(dpUserId: string, id: string): Promise<AutoReply> {
    const rule = await this.repository.findById(id);
    if (!rule || rule.dpUserId !== dpUserId) throw new NotFoundError('Resposta automática não encontrada');
    return rule;
  }

  private async validInput(dpUserId: string, input: AutoReplyInput, exceptId?: string): Promise<AutoReplyInput> {
    const content = input.content.trim();
    if (!content) throw new AppError('Escreva o texto da resposta automática', 400, 'VALIDATION_ERROR');
    if (content.length > AUTO_REPLY_CONTENT_MAX) {
      throw new AppError(`Texto com no máximo ${AUTO_REPLY_CONTENT_MAX} caracteres`, 400, 'VALIDATION_ERROR');
    }
    const sector = await resolveSectorName(this.sectors, input.sector); // grafia cadastrada; vazio = todos
    const duplicate = (await this.repository.listByDpUser(dpUserId)).find(
      (r) => r.id !== exceptId && (r.sector === null ? sector === null : sector !== null && sameName(r.sector, sector)),
    );
    if (duplicate) {
      throw new AppError(
        sector ? `Você já tem uma resposta automática para o setor ${sector}` : 'Você já tem uma resposta automática para todos os setores',
        409,
        'AUTO_REPLY_EXISTS',
      );
    }
    return { sector, content, active: input.active };
  }

  async create(dpUserId: string, input: AutoReplyInput): Promise<AutoReply> {
    const rule = await this.repository.create(dpUserId, await this.validInput(dpUserId, input), new Date());
    this.log.info(`Resposta automática criada (${rule.sector ?? 'todos os setores'})`);
    return rule;
  }

  async update(dpUserId: string, id: string, input: AutoReplyInput): Promise<AutoReply> {
    await this.own(dpUserId, id);
    return this.repository.update(id, await this.validInput(dpUserId, input, id), new Date());
  }

  async remove(dpUserId: string, id: string): Promise<void> {
    await this.own(dpUserId, id);
    await this.repository.delete(id);
  }

  /** A resposta ativa para um funcionário do setor informado: a do setor ou, se não houver, a de todos os setores */
  async ruleFor(dpUserId: string, employeeSector: string | null): Promise<AutoReply | null> {
    const active = (await this.repository.listByDpUser(dpUserId)).filter((r) => r.active);
    const bySector = employeeSector ? active.find((r) => r.sector !== null && sameName(r.sector, employeeSector)) : undefined;
    return bySector ?? active.find((r) => r.sector === null) ?? null;
  }
}
