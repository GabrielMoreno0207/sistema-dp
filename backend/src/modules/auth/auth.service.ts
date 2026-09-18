import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../errors/app-error';
import type { ComputerService } from '../computers/computer.service';
import type { Computer, ComputerInfo } from '../computers/computer.types';
import type { UserRepository } from '../users/user.repository';
import { toPublicUser, type PublicUser } from '../users/user.types';
import {
  DUMMY_SECRET_HASH,
  generateToken,
  hashComputerSecret,
  hashSecret,
  hashToken,
  verifyComputerSecret,
  verifySecret,
} from './crypto';
import { LoginThrottle } from './login-throttle';
import type { Principal } from './principal';
import type { TokenRepository } from './token.repository';

export interface AuthOptions {
  sessionTtlHours: number;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: PublicUser;
}

export class AuthService {
  private readonly throttle = new LoginThrottle();

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenRepository,
    private readonly computers: ComputerService,
    private readonly options: AuthOptions,
    private readonly log: FastifyBaseLogger,
  ) {}

  /** Cria o primeiro usuário do DP a partir do .env, se ainda não houver nenhum. */
  async ensureInitialAdmin(admin: { username: string; password: string | null; name: string }): Promise<void> {
    if ((await this.users.countByRole('ADMIN')) > 0) return;
    if (!admin.password) {
      this.log.warn('Nenhum usuário do DP cadastrado. Defina ADMIN_PASSWORD no .env e reinicie.');
      return;
    }
    await this.users.create(
      {
        username: admin.username,
        name: admin.name,
        registration: null,
        sector: 'Departamento Pessoal',
        shift: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false,
        chatContact: false, // login genérico do sistema: não aparece como contato no chat do app
        superAdmin: true, // primeiro login = conta do TI, com os poderes extras da Central
        passwordHash: await hashSecret(admin.password),
      },
      new Date(),
    );
    this.log.info(`Usuário inicial do DP criado: ${admin.username}`);
  }

  async login(username: string, password: string, ip: string): Promise<LoginResult> {
    const throttleKey = `${username.toLowerCase()}|${ip}`;
    const blockedMs = this.throttle.blockedFor(throttleKey);
    if (blockedMs > 0) {
      throw new AppError(
        `Muitas tentativas inválidas. Tente novamente em ${Math.ceil(blockedMs / 60_000)} minuto(s).`,
        429,
        'TOO_MANY_ATTEMPTS',
      );
    }

    const user = await this.users.findByUsername(username);
    // Mesmo sem usuário, calcula um hash: o tempo de resposta não revela quais usuários existem
    const passwordOk = await verifySecret(password, user?.passwordHash ?? DUMMY_SECRET_HASH);
    if (!user || !passwordOk || user.status !== 'ACTIVE' || user.role !== 'ADMIN') {
      this.throttle.registerFailure(throttleKey);
      this.log.warn(`Falha de login na Central do DP: "${username}" (${ip})`);
      throw new AppError('Usuário ou senha inválidos', 401, 'INVALID_CREDENTIALS');
    }

    this.throttle.reset(throttleKey);
    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlHours * 3_600_000).toISOString();
    await this.tokens.save({
      tokenHash: hashToken(token),
      subjectType: 'USER',
      subjectId: user.id,
      createdAt: now.toISOString(),
      expiresAt,
    });
    this.log.info(`Login na Central do DP: ${user.username} (${ip})`);
    return { token, expiresAt, user: toPublicUser(user) };
  }

  async logout(token: string): Promise<void> {
    await this.tokens.delete(hashToken(token));
  }

  /** Converte um token em "quem é" (ou null se inválido/expirado). */
  async authenticate(token: string): Promise<Principal | null> {
    const stored = await this.tokens.find(hashToken(token));
    if (!stored) return null;

    if (stored.expiresAt && Date.parse(stored.expiresAt) <= Date.now()) {
      await this.tokens.delete(stored.tokenHash);
      return null;
    }

    if (stored.subjectType === 'COMPUTER') return { type: 'COMPUTER', computerId: stored.subjectId };

    const user = await this.users.findById(stored.subjectId);
    if (!user || user.status !== 'ACTIVE' || user.role !== 'ADMIN') return null;
    return { type: 'ADMIN', userId: user.id, name: user.name, superAdmin: user.superAdmin };
  }

  /**
   * Registra o computador e devolve um token novo para ele.
   * - no primeiro registro guarda o segredo da instalação; nos seguintes exige o mesmo segredo,
   *   para que ninguém se passe por um aparelho já registrado.
   */
  async registerComputer(
    info: ComputerInfo,
    credentials: { computerSecret: string },
  ): Promise<{ computer: Computer; token: string }> {
    const storedSecret = await this.computers.getSecretHash(info.computerId);
    const check = storedSecret ? await verifyComputerSecret(credentials.computerSecret, storedSecret) : null;
    if (check && !check.ok) {
      this.log.warn(`Registro de computador recusado (credencial diferente): ${info.computerId} (${info.hostname})`);
      throw new AppError(
        'Este computador já foi registrado com outra credencial. Peça ao DP para liberar o registro.',
        403,
        'COMPUTER_CREDENTIAL_MISMATCH',
      );
    }

    const computer = await this.computers.register(info);
    // Primeiro registro, ou segredo guardado no formato antigo (scrypt): grava no formato rápido
    if (!check || check.legacy) {
      await this.computers.setSecretHash(info.computerId, hashComputerSecret(credentials.computerSecret));
    }

    // Um token válido por computador: o anterior deixa de valer
    await this.tokens.deleteBySubject('COMPUTER', info.computerId);
    const token = generateToken();
    await this.tokens.save({
      tokenHash: hashToken(token),
      subjectType: 'COMPUTER',
      subjectId: info.computerId,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    });
    return { computer, token };
  }

  /** Libera um PC para se registrar de novo com outra credencial (ex.: reinstalação). */
  async resetComputerCredential(computerId: string): Promise<void> {
    await this.computers.get(computerId); // 404 se não existir
    await this.computers.setSecretHash(computerId, null);
    await this.computers.setCurrentUser(computerId, null); // quem registrar de novo não herda o funcionário logado
    await this.tokens.deleteBySubject('COMPUTER', computerId);
    this.log.info(`Credencial do computador ${computerId} liberada para novo registro`);
  }

  /**
   * Cria um login da Central do DP (usado pelo script create-admin).
   * A troca da senha é opcional: a pessoa troca pelo botão "Minha senha" se quiser.
   */
  async createAdmin(
    username: string,
    name: string,
    password: string,
    options: { chatContact?: boolean; superAdmin?: boolean } = {},
  ): Promise<PublicUser> {
    const login = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,64}$/.test(login)) {
      throw new AppError('Usuário inválido: use letras minúsculas, números, ponto, hífen ou sublinhado', 400, 'VALIDATION_ERROR');
    }
    if (!name.trim()) throw new AppError('Informe o nome', 400, 'VALIDATION_ERROR');
    if (password.length < 8) throw new AppError('A senha precisa ter pelo menos 8 caracteres', 400, 'VALIDATION_ERROR');
    if (await this.users.findByUsername(login)) throw new AppError(`O usuário "${login}" já existe`, 409, 'USERNAME_TAKEN');

    const user = await this.users.create(
      {
        username: login,
        name: name.trim(),
        registration: null,
        sector: 'Departamento Pessoal',
        shift: null,
        role: 'ADMIN',
        status: 'ACTIVE',
        mustChangePassword: false, // troca de senha opcional na Central (decisão do DP)
        chatContact: options.chatContact ?? true, // pessoas do DP aparecem como contato no chat do app
        superAdmin: options.superAdmin ?? false, // poderes extras só na conta do TI
        passwordHash: await hashSecret(password),
      },
      new Date(),
    );
    this.log.info(`Login da Central criado: ${login} (${user.name})`);
    return toPublicUser(user);
  }

  /** Dados do usuário do DP logado (para a Central saber se precisa trocar a senha) */
  async getAdmin(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user || user.role !== 'ADMIN' || user.status !== 'ACTIVE') throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    return toPublicUser(user);
  }

  /** O próprio usuário do DP troca a senha (obrigatório no primeiro acesso). */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<PublicUser> {
    const blockedMs = this.throttle.blockedFor(`pwd|${userId}`);
    if (blockedMs > 0) {
      throw new AppError(`Muitas tentativas inválidas. Tente novamente em ${Math.ceil(blockedMs / 60_000)} minuto(s).`, 429, 'TOO_MANY_ATTEMPTS');
    }
    const user = await this.users.findWithPasswordById(userId);
    if (!user || user.role !== 'ADMIN') throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    if (!(await verifySecret(currentPassword, user.passwordHash))) {
      this.throttle.registerFailure(`pwd|${userId}`);
      throw new AppError('Senha atual incorreta', 400, 'INVALID_CURRENT_PASSWORD');
    }
    if (newPassword.length < 8) throw new AppError('A nova senha precisa ter pelo menos 8 caracteres', 400, 'VALIDATION_ERROR');
    if (newPassword === currentPassword) throw new AppError('A nova senha precisa ser diferente da atual', 400, 'VALIDATION_ERROR');

    this.throttle.reset(`pwd|${userId}`);
    await this.users.updatePassword(userId, await hashSecret(newPassword), false);
    this.log.info(`Senha da Central alterada pelo próprio usuário: ${user.username}`);
    return toPublicUser({ ...user, mustChangePassword: false });
  }

  /** Troca a senha de um usuário do DP e encerra as sessões abertas dele. */
  async setPassword(username: string, password: string): Promise<boolean> {
    if (password.length < 8) throw new AppError('A senha precisa ter pelo menos 8 caracteres', 400, 'VALIDATION_ERROR');
    const user = await this.users.findByUsername(username);
    if (!user) return false;
    await this.users.updatePassword(user.id, await hashSecret(password));
    await this.tokens.deleteBySubject('USER', user.id);
    this.log.info(`Senha alterada: ${user.username}`);
    return true;
  }

  /** Limpeza periódica: sessões expiradas e registros antigos de tentativas de login. */
  async purgeExpired(): Promise<void> {
    this.throttle.prune();
    const removed = await this.tokens.deleteExpired(new Date());
    if (removed > 0) this.log.debug(`${removed} sessão(ões) expirada(s) removida(s)`);
  }
}
