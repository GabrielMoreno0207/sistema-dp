import type { Sector } from './sector.types';

/** Cadastro de setores. O funcionário guarda o NOME do setor (users.sector). */
export interface SectorRepository {
  list(): Promise<Sector[]>;
  findById(id: string): Promise<Sector | null>;
  create(name: string, now: Date): Promise<Sector>;
  /** Renomeia e propaga o nome novo para os funcionários e as mensagens enviadas ao setor */
  rename(id: string, oldName: string, newName: string): Promise<void>;
  delete(id: string): Promise<void>;
}
