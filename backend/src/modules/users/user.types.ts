export type UserRole = 'ADMIN' | 'EMPLOYEE';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Usuário do sistema: o DP (ADMIN), que entra na Central,
 * e os funcionários (EMPLOYEE), que entram no aplicativo desktop com a matrícula.
 */
export interface User {
  id: string;
  username: string;
  name: string;
  registration: string | null;
  sector: string | null;
  shift: string | null;
  role: UserRole;
  status: UserStatus;
  /** Precisa trocar a senha no próximo acesso (senha inicial ou redefinida pelo DP) */
  mustChangePassword: boolean;
  /** Usuário do DP que aparece na lista de contatos do chat no app (ex.: TI e admin ficam fora) */
  chatContact: boolean;
  /** Conta do TI: poderes extras na Central (apagar comunicados e conversas, gerenciar logins) */
  superAdmin: boolean;
  /** Foto de perfil enviada pela pessoa (id da mídia) */
  fotoMidiaId: string | null;
  createdAt: string;
}

export interface UserWithPassword extends User {
  passwordHash: string;
}

export type NewUser = Omit<UserWithPassword, 'id' | 'createdAt' | 'fotoMidiaId'> & { fotoMidiaId?: string | null };

/** Dados do usuário do DP que podem ir para o cliente */
export interface PublicUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  /** Senha inicial: a Central pede para trocar antes de continuar */
  mustChangePassword: boolean;
  /** Conta do TI: a Central mostra a seção de administração */
  superAdmin: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    superAdmin: user.superAdmin,
  };
}

/** Funcionário como o aplicativo desktop vê (sessão no computador) */
export interface EmployeeProfile {
  id: string;
  name: string;
  registration: string;
  sector: string | null;
  shift: string | null;
  mustChangePassword: boolean;
}

/** Funcionário como o DP vê (Central) */
export interface Employee extends EmployeeProfile {
  status: UserStatus;
  createdAt: string;
}

export function toEmployee(user: User): Employee {
  return {
    id: user.id,
    name: user.name,
    registration: user.registration ?? user.username,
    sector: user.sector,
    shift: user.shift,
    mustChangePassword: user.mustChangePassword,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export function toEmployeeProfile(user: User): EmployeeProfile {
  const { id, name, registration, sector, shift, mustChangePassword } = toEmployee(user);
  return { id, name, registration, sector, shift, mustChangePassword };
}

export interface ProfileUpdate {
  name: string;
  sector: string | null;
  shift: string | null;
  status: UserStatus;
}
