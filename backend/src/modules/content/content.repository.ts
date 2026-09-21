import type { Atalho, Midia, MuralPost, NovoAtalho } from './content.types';

export interface MidiaRepository {
  create(midia: Midia): Promise<Midia>;
  findById(id: string): Promise<Midia | null>;
  delete(id: string): Promise<boolean>;
  /** Nomes de arquivo que ainda têm registro (para achar os órfãos em disco) */
  listStoredNames(): Promise<string[]>;
  /** Mídias que não estão em nenhum mural nem em nenhuma foto de perfil */
  listSemUso(antesDe: string): Promise<Midia[]>;
}

export interface MuralRepository {
  /** O recado em exibição (o mais recente que estiver ativo) */
  findAtivo(): Promise<MuralPost | null>;
  listAll(limite: number): Promise<MuralPost[]>;
  findById(id: string): Promise<MuralPost | null>;
  create(post: MuralPost): Promise<MuralPost>;
  update(id: string, dados: Pick<MuralPost, 'titulo' | 'texto' | 'midiaId' | 'ativo'>, agora: string): Promise<MuralPost>;
  delete(id: string): Promise<boolean>;
}

export interface AtalhoRepository {
  listByUser(userId: string): Promise<Atalho[]>;
  findById(id: string): Promise<Atalho | null>;
  countByUser(userId: string): Promise<number>;
  create(atalho: Atalho): Promise<Atalho>;
  update(id: string, dados: Omit<NovoAtalho, 'userId'>): Promise<Atalho>;
  delete(id: string): Promise<boolean>;
  /** Grava a ordem escolhida pela pessoa (arrastar e soltar) */
  reordenar(userId: string, idsNaOrdem: string[]): Promise<void>;
}
