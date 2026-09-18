import type { FastifyBaseLogger } from 'fastify';
import { EventEmitter } from 'node:events';
import { AppError, NotFoundError } from '../../errors/app-error';
import { DUMMY_SECRET_HASH, hashSecret, verifySecret } from '../auth/crypto';
import { LoginThrottle } from '../auth/login-throttle';
import type { ComputerService } from '../computers/computer.service';
import type { SectorRepository } from '../sectors/sector.repository';
import { resolveSectorName, type SectorChangeListener } from '../sectors/sector.service';
import type { UserRepository } from '../users/user.repository';
import {
  toEmployee,
  toEmployeeProfile,
  type Employee,
  type EmployeeProfile,
  type User,
  type UserStatus,
} from '../users/user.types';

export const EMPLOYEE_LIMITS = { name: 120, registration: 32, group: 60, password: { min: 8, max: 128 } } as const;

const MINUTE = 60 * 1000;

export interface NewEmployeeInput {
  name: string;
  registration: string;
  sector?: string | null;
  shift?: string | null;
  password: string;
}

export interface EmployeeUpdateInput {
  name?: string;
  /** Nova matrícula (é também o login do funcionário no app) */
  registration?: string;
  sector?: string | null;
  shift?: string | null;
  status?: UserStatus;
}

interface EmployeeEvents {
  /** A sessão de um computador mudou (login, logout, expirou, desativado, senha redefinida, setor/turno) */
  sessionChanged: [computerId: string, employee: EmployeeProfile | null];
}

/** Texto opcional: espaços extras são removidos; vazio vira null */
function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed : null;
}

function checkPassword(password: string): void {
  if (password.length < EMPLOYEE_LIMITS.password.min) {
    throw new AppError(`A senha precisa ter pelo menos ${EMPLOYEE_LIMITS.password.min} caracteres`, 400, 'VALIDATION_ERROR');
  }
}

function tooManyAttempts(blockedMs: number): AppError {
  return new AppError(
    `Muitas tentativas inválidas. Tente novamente em ${Math.ceil(blockedMs / MINUTE)} minuto(s).`,
    429,
    'TOO_MANY_ATTEMPTS',
  );
}

/**
 * Funcionários: cadastro (pelo DP) e sessão no aplicativo desktop (login com matrícula).
 * O vínculo funcionário ↔ computador fica no servidor, sobrevive a reconexões e expira
 * após algumas horas (PCs compartilhados).
 */
export class EmployeeService extends EventEmitter<EmployeeEvents> implements SectorChangeListener {
  /** Bloqueios de tentativas erradas, em três níveis */
  private readonly throttles = {
    /** mesma matrícula no mesmo PC: 5 erros → 5 min */
    pair: new LoginThrottle(),
    /** um PC testando várias matrículas: 20 erros → 15 min */
    computer: new LoginThrottle({ maxFailures: 20, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE }),
    /** uma matrícula atacada de vários PCs: 10 erros → 15 min */
    registration: new LoginThrottle({ maxFailures: 10, windowMs: 15 * MINUTE, lockMs: 15 * MINUTE }),
    /** senha atual errada na troca de senha: 5 erros → 5 min */
    password: new LoginThrottle(),
  };

  constructor(
    private readonly users: UserRepository,
    private readonly computers: ComputerService,
    private readonly sectors: SectorRepository,
    private readonly options: { sessionHours: number },
    private readonly log: FastifyBaseLogger,
  ) {
    super();
  }

  // ------------------------------------------------------------------ cadastro (DP)

  async list(): Promise<Employee[]> {
    return (await this.users.listByRole('EMPLOYEE')).map(toEmployee);
  }

  private async getEmployeeUser(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user || user.role !== 'EMPLOYEE') throw new NotFoundError('Funcionário não encontrado');
    return user;
  }

  /** Funcionário ativo ou inativo (404 se não existir) */
  async getAny(id: string): Promise<Employee> {
    return toEmployee(await this.getEmployeeUser(id));
  }

  /** Funcionário ativo (para envio de mensagem individual) */
  async getActive(id: string): Promise<Employee> {
    const user = await this.users.findById(id);
    if (!user || user.role !== 'EMPLOYEE' || user.status !== 'ACTIVE') {
      throw new NotFoundError('Funcionário não encontrado ou inativo');
    }
    return toEmployee(user);
  }

  countActive(field: 'sector' | 'shift', value: string): Promise<number> {
    return this.users.countActiveEmployees(field, value);
  }

  /**
   * Setor/turno: reaproveita a grafia já cadastrada quando só muda maiúscula/acento
   * ("producao" vira "Produção"), para não criar grupos diferentes por engano.
   */
  private async canonicalGroup(field: 'sector' | 'shift', value: string | null | undefined): Promise<string | null> {
    const normalized = optional(value);
    if (!normalized) return null;
    const existing = await this.users.distinctGroups(field);
    return existing.find((e) => e.localeCompare(normalized, 'pt-BR', { sensitivity: 'base' }) === 0) ?? normalized;
  }

  async create(input: NewEmployeeInput): Promise<Employee> {
    const name = optional(input.name);
    const registration = input.registration.trim();
    if (!name || !registration) throw new AppError('Nome e matrícula são obrigatórios', 400, 'VALIDATION_ERROR');
    checkPassword(input.password);

    if ((await this.users.findByRegistration(registration)) || (await this.users.findByUsername(registration))) {
      throw new AppError(`A matrícula ${registration} já está cadastrada`, 409, 'REGISTRATION_TAKEN');
    }

    const user = await this.users.create(
      {
        username: registration,
        name,
        registration,
        sector: await resolveSectorName(this.sectors, input.sector), // precisa estar cadastrado em Setores
        shift: await this.canonicalGroup('shift', input.shift),
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        mustChangePassword: false, // troca de senha opcional (decisão do DP): quem quiser troca em "Meu perfil"
        chatContact: false, // campo só vale para usuários do DP
        superAdmin: false,
        passwordHash: await hashSecret(input.password),
      },
      new Date(),
    );
    this.log.info(`Funcionário cadastrado: ${name} (matrícula ${registration})`);
    return toEmployee(user);
  }

  async update(id: string, input: EmployeeUpdateInput): Promise<Employee> {
    const current = await this.getEmployeeUser(id);
    const next = {
      name: input.name !== undefined ? optional(input.name) ?? current.name : current.name,
      sector: input.sector !== undefined ? await resolveSectorName(this.sectors, input.sector) : current.sector,
      shift: input.shift !== undefined ? await this.canonicalGroup('shift', input.shift) : current.shift,
      status: input.status ?? current.status,
    };

    // Matrícula nova: precisa ser única (ela é o login do funcionário)
    let registration = current.registration ?? current.username;
    if (input.registration !== undefined) {
      const wanted = input.registration.trim();
      if (!wanted) throw new AppError('A matrícula não pode ficar em branco', 400, 'VALIDATION_ERROR');
      if (wanted !== registration) {
        const taken = (await this.users.findByRegistration(wanted)) ?? (await this.users.findByUsername(wanted));
        if (taken && taken.id !== id) throw new AppError(`A matrícula ${wanted} já está cadastrada`, 409, 'REGISTRATION_TAKEN');
        await this.users.updateRegistration(id, wanted);
        this.log.info(`Matrícula alterada: ${registration} → ${wanted} (${current.name})`);
        registration = wanted;
      }
    }

    await this.users.updateProfile(id, next);
    const updated = { ...current, ...next, registration, username: registration };
    this.log.info(`Funcionário atualizado: ${updated.name} (matrícula ${updated.registration})`);

    // Inativo: sai de todos os computadores. Setor/turno/nome mudou: o app e as salas do WebSocket se atualizam.
    if (updated.status === 'INACTIVE') await this.endSessions(id);
    else {
      for (const computer of await this.computers.findByCurrentUser(id)) {
        if (this.sessionValid(computer)) this.emit('sessionChanged', computer.computerId, toEmployeeProfile(updated));
      }
    }
    return toEmployee(updated);
  }

  /** DP redefine a senha (ex.: funcionário esqueceu) e encerra as sessões abertas. A troca depois é opcional. */
  async resetPassword(id: string, password: string): Promise<void> {
    const user = await this.getEmployeeUser(id);
    checkPassword(password);
    await this.users.updatePassword(id, await hashSecret(password), false);
    await this.endSessions(id);
    this.log.info(`Senha redefinida pelo DP: ${user.name} (matrícula ${user.registration})`);
  }

  /** Tira o funcionário de todos os computadores (exceto, opcionalmente, um). */
  private async endSessions(userId: string, exceptComputerId?: string): Promise<void> {
    for (const computer of await this.computers.findByCurrentUser(userId)) {
      if (computer.computerId === exceptComputerId) continue;
      await this.computers.setCurrentUser(computer.computerId, null);
      this.emit('sessionChanged', computer.computerId, null);
    }
  }

  /** Exclui o funcionário: sai dos computadores; o histórico de mensagens e leituras é mantido. */
  async remove(id: string): Promise<void> {
    const user = await this.getEmployeeUser(id);
    await this.endSessions(id);
    await this.users.delete(id);
    this.log.info(`Funcionário excluído: ${user.name} (matrícula ${user.registration})`);
  }

  /** Setor renomeado: funcionários logados desse setor trocam de sala e o app atualiza o perfil */
  async sectorRenamed(newName: string): Promise<void> {
    for (const user of await this.users.listByRole('EMPLOYEE')) {
      if (user.sector !== newName || user.status !== 'ACTIVE') continue;
      for (const computer of await this.computers.findByCurrentUser(user.id)) {
        if (this.sessionValid(computer)) this.emit('sessionChanged', computer.computerId, toEmployeeProfile(user));
      }
    }
  }

  // ------------------------------------------------------------------ sessão no computador

  /** A sessão do funcionário neste computador ainda está dentro da validade? */
  private sessionValid(computer: { currentUserSince: string | null }): boolean {
    const since = computer.currentUserSince ? Date.parse(computer.currentUserSince) : 0;
    return Date.now() - since <= this.options.sessionHours * 3_600_000;
  }

  /**
   * Varredura periódica: encerra as sessões vencidas pelo mesmo caminho do logout
   * (tira o PC das salas do WebSocket e avisa o app), mesmo que o PC não faça nenhuma chamada.
   */
  async sweepExpiredSessions(): Promise<void> {
    for (const computer of await this.computers.findWithCurrentUser()) {
      if (this.sessionValid(computer)) continue;
      await this.computers.setCurrentUser(computer.computerId, null);
      this.log.info(`Sessão de funcionário expirou no PC ${computer.computerId}`);
      this.emit('sessionChanged', computer.computerId, null);
    }
  }

  /** Funcionário logado neste computador (null = sem identificação, sessão expirada ou inativo) */
  async getSessionEmployee(computerId: string): Promise<Employee | null> {
    const computer = await this.computers.get(computerId);
    if (!computer.currentUserId) return null;

    if (!this.sessionValid(computer)) {
      await this.computers.setCurrentUser(computerId, null);
      this.log.info(`Sessão de funcionário expirou no PC ${computerId}`);
      this.emit('sessionChanged', computerId, null);
      return null;
    }

    const user = await this.users.findById(computer.currentUserId);
    if (!user || user.role !== 'EMPLOYEE' || user.status !== 'ACTIVE') return null;
    return toEmployee(user);
  }

  async login(computerId: string, registration: string, password: string): Promise<EmployeeProfile> {
    const reg = registration.toLowerCase();
    const keys: [LoginThrottle, string][] = [
      [this.throttles.pair, `${reg}|${computerId}`],
      [this.throttles.computer, computerId],
      [this.throttles.registration, reg],
    ];
    const blockedMs = Math.max(...keys.map(([throttle, key]) => throttle.blockedFor(key)));
    if (blockedMs > 0) throw tooManyAttempts(blockedMs);

    const user = await this.users.findByRegistration(registration);
    // Mesmo sem funcionário, calcula um hash: o tempo de resposta não revela quais matrículas existem
    const passwordOk = await verifySecret(password, user?.passwordHash ?? DUMMY_SECRET_HASH);
    if (!user || !passwordOk || user.status !== 'ACTIVE') {
      for (const [throttle, key] of keys) throttle.registerFailure(key);
      this.log.warn(`Falha de login de funcionário: matrícula "${registration}" no PC ${computerId}`);
      throw new AppError('Matrícula ou senha inválidas', 401, 'INVALID_CREDENTIALS');
    }

    this.throttles.pair.reset(keys[0][1]);
    await this.computers.setCurrentUser(computerId, user.id);
    const profile = toEmployeeProfile(user);
    this.log.info(`Funcionário entrou: ${user.name} (matrícula ${profile.registration}) no PC ${computerId}`);
    this.emit('sessionChanged', computerId, profile);
    return profile;
  }

  async logout(computerId: string): Promise<void> {
    const employee = await this.getSessionEmployee(computerId);
    await this.computers.setCurrentUser(computerId, null);
    if (employee) this.log.info(`Funcionário saiu: ${employee.name} (matrícula ${employee.registration}) do PC ${computerId}`);
    this.emit('sessionChanged', computerId, null);
  }

  /** O próprio funcionário troca a senha: encerra as sessões dele em outros PCs. */
  async changePassword(computerId: string, currentPassword: string, newPassword: string): Promise<void> {
    const employee = await this.getSessionEmployee(computerId);
    if (!employee) throw new AppError('Nenhum funcionário conectado neste computador', 401, 'UNAUTHORIZED');

    const blockedMs = this.throttles.password.blockedFor(employee.id);
    if (blockedMs > 0) throw tooManyAttempts(blockedMs);

    const user = await this.users.findWithPasswordById(employee.id);
    if (!user || !(await verifySecret(currentPassword, user.passwordHash))) {
      this.throttles.password.registerFailure(employee.id);
      throw new AppError('Senha atual incorreta', 401, 'INVALID_CREDENTIALS');
    }
    checkPassword(newPassword);
    if (newPassword === currentPassword) throw new AppError('A nova senha precisa ser diferente da atual', 400, 'VALIDATION_ERROR');

    this.throttles.password.reset(employee.id);
    await this.users.updatePassword(user.id, await hashSecret(newPassword), false);
    await this.endSessions(user.id, computerId);
    this.log.info(`Senha alterada pelo funcionário: ${user.name} (matrícula ${employee.registration})`);
  }

  /** Limpeza periódica dos bloqueios de tentativas */
  prune(): void {
    for (const throttle of Object.values(this.throttles)) throttle.prune();
  }
}
