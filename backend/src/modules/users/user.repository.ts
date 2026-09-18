import type { NewUser, ProfileUpdate, User, UserRole, UserStatus, UserWithPassword } from './user.types';

export interface UserRepository {
  findByUsername(username: string): Promise<UserWithPassword | null>;
  findByRegistration(registration: string): Promise<UserWithPassword | null>;
  findById(id: string): Promise<User | null>;
  findWithPasswordById(id: string): Promise<UserWithPassword | null>;
  listByRole(role: UserRole): Promise<User[]>;
  countByRole(role: UserRole): Promise<number>;
  /** Funcionários ativos com esse setor/turno (para validar envio e contar destinatários) */
  countActiveEmployees(field: 'sector' | 'shift', value: string): Promise<number>;
  create(data: NewUser, now: Date): Promise<User>;
  updateProfile(id: string, data: ProfileUpdate): Promise<void>;
  /** Ativa/desativa um login (usado pelo TI na Central) */
  updateStatus(id: string, status: UserStatus): Promise<void>;
  /** Troca a matrícula (que também é o login do funcionário) */
  updateRegistration(id: string, registration: string): Promise<void>;
  delete(id: string): Promise<void>;
  /** mustChangePassword = true obriga a troca no próximo acesso */
  updatePassword(id: string, passwordHash: string, mustChangePassword?: boolean): Promise<void>;
  /** Setores ou turnos já usados (para reaproveitar a grafia existente) */
  distinctGroups(field: 'sector' | 'shift'): Promise<string[]>;
}
