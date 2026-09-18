import type { Computer, ComputerInfo, ComputerStatus } from './computer.types';

/**
 * Contrato de persistência dos computadores.
 * Trocar o banco (SQLite, PostgreSQL, Oracle) = criar outra implementação desta interface.
 */
export interface ComputerRepository {
  /** Cria ou atualiza os dados do computador. Retorna o registro e se ele já existia. */
  upsert(info: ComputerInfo, now: Date): Promise<{ computer: Computer; created: boolean }>;
  findById(computerId: string): Promise<Computer | null>;
  findAll(): Promise<Computer[]>;
  updateStatus(computerId: string, status: ComputerStatus, now: Date): Promise<void>;
  /** Na inicialização do backend nenhum PC está conectado ainda. */
  markAllOffline(): Promise<void>;
  getSecretHash(computerId: string): Promise<string | null>;
  setSecretHash(computerId: string, secretHash: string | null): Promise<void>;
  /** Funcionário logado no computador (null = ninguém) */
  setCurrentUser(computerId: string, userId: string | null): Promise<void>;
  findByCurrentUser(userId: string): Promise<Computer[]>;
  /** Computadores com algum funcionário logado (para a varredura de sessões vencidas) */
  findWithCurrentUser(): Promise<Computer[]>;
}
