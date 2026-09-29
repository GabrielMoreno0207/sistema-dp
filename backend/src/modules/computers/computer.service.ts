import type { FastifyBaseLogger } from 'fastify';
import { NotFoundError } from '../../errors/app-error';
import type { ComputerRepository } from './computer.repository';
import type { Computer, ComputerInfo } from './computer.types';

export class ComputerService {
  constructor(
    private readonly repository: ComputerRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  async register(info: ComputerInfo): Promise<Computer> {
    const { computer, created } = await this.repository.upsert(info, new Date());
    if (created) {
      this.log.info(`Computador registrado: ${info.computerId} (${info.hostname}, v${info.appVersion})`);
    }
    return computer;
  }

  async markOnline(info: ComputerInfo): Promise<void> {
    const now = new Date();
    await this.repository.upsert(info, now);
    await this.repository.updateStatus(info.computerId, 'ONLINE', now);
  }

  async markOffline(computerId: string): Promise<void> {
    await this.repository.updateStatus(computerId, 'OFFLINE', new Date());
  }

  markAllOffline(): Promise<void> {
    return this.repository.markAllOffline();
  }

  getSecretHash(computerId: string): Promise<string | null> {
    return this.repository.getSecretHash(computerId);
  }

  setSecretHash(computerId: string, secretHash: string | null): Promise<void> {
    return this.repository.setSecretHash(computerId, secretHash);
  }

  setCurrentUser(computerId: string, userId: string | null): Promise<void> {
    return this.repository.setCurrentUser(computerId, userId);
  }

  findByCurrentUser(userId: string): Promise<Computer[]> {
    return this.repository.findByCurrentUser(userId);
  }

  findWithCurrentUser(): Promise<Computer[]> {
    return this.repository.findWithCurrentUser();
  }

  list(): Promise<Computer[]> {
    return this.repository.findAll();
  }

  async get(computerId: string): Promise<Computer> {
    const computer = await this.repository.findById(computerId);
    if (!computer) throw new NotFoundError(`Computador ${computerId} não encontrado`);
    return computer;
  }
}
