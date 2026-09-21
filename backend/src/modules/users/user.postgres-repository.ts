import { randomUUID } from 'node:crypto';
import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { UserRepository } from './user.repository';
import type { NewUser, ProfileUpdate, User, UserRole, UserStatus, UserWithPassword } from './user.types';

function toUser(row: Row): UserWithPassword {
  return {
    id: text(row, 'id'),
    username: text(row, 'username'),
    name: text(row, 'name'),
    registration: nullableText(row, 'registration'),
    sector: nullableText(row, 'sector'),
    shift: nullableText(row, 'shift'),
    role: text(row, 'role') as UserRole,
    status: text(row, 'status') as UserStatus,
    mustChangePassword: Number(row.must_change_password) === 1,
    chatContact: Number(row.chat_contact ?? 1) === 1,
    superAdmin: Number(row.super_admin ?? 0) === 1,
    passwordHash: text(row, 'password_hash'),
    createdAt: text(row, 'created_at'),
  };
}

function withoutPassword({ passwordHash: _hash, ...user }: UserWithPassword): User {
  return user;
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async findByUsername(username: string): Promise<UserWithPassword | null> {
    // username é CITEXT: a comparação já ignora maiúsculas e minúsculas
    const row = await this.db.one('SELECT * FROM users WHERE username = $1', [username]);
    return row ? toUser(row) : null;
  }

  async findByRegistration(registration: string): Promise<UserWithPassword | null> {
    const row = await this.db.one("SELECT * FROM users WHERE registration = $1 AND role = 'EMPLOYEE'", [registration]);
    return row ? toUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db.one('SELECT * FROM users WHERE id = $1', [id]);
    return row ? withoutPassword(toUser(row)) : null;
  }

  async findWithPasswordById(id: string): Promise<UserWithPassword | null> {
    const row = await this.db.one('SELECT * FROM users WHERE id = $1', [id]);
    return row ? toUser(row) : null;
  }

  async listByRole(role: UserRole): Promise<User[]> {
    const rows = await this.db.all('SELECT * FROM users WHERE role = $1 ORDER BY lower(name)', [role]);
    return rows.map((row) => withoutPassword(toUser(row)));
  }

  async countByRole(role: UserRole): Promise<number> {
    const row = await this.db.one('SELECT COUNT(*) AS total FROM users WHERE role = $1', [role]);
    return Number(row?.total ?? 0);
  }

  async countActiveEmployees(field: 'sector' | 'shift', value: string): Promise<number> {
    // A coluna não vem de fora: só existem os dois valores do tipo
    const column = field === 'sector' ? 'sector' : 'shift';
    const row = await this.db.one(
      `SELECT COUNT(*) AS total FROM users WHERE role = 'EMPLOYEE' AND status = 'ACTIVE' AND ${column} = $1`,
      [value],
    );
    return Number(row?.total ?? 0);
  }

  async create(data: NewUser, now: Date): Promise<User> {
    const id = randomUUID();
    await this.db.run(
      `INSERT INTO users (id, username, name, registration, sector, shift, role, status, must_change_password, chat_contact, super_admin, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        data.username,
        data.name,
        data.registration,
        data.sector,
        data.shift,
        data.role,
        data.status,
        data.mustChangePassword ? 1 : 0,
        data.chatContact ? 1 : 0,
        data.superAdmin ? 1 : 0,
        data.passwordHash,
        now.toISOString(),
      ],
    );
    return withoutPassword({ ...data, id, createdAt: now.toISOString() });
  }

  async updateStatus(id: string, status: UserStatus): Promise<void> {
    await this.db.run('UPDATE users SET status = $1 WHERE id = $2', [status, id]);
  }

  async updateProfile(id: string, data: ProfileUpdate): Promise<void> {
    await this.db.run('UPDATE users SET name = $1, sector = $2, shift = $3, status = $4 WHERE id = $5', [
      data.name,
      data.sector,
      data.shift,
      data.status,
      id,
    ]);
  }

  async updateRegistration(id: string, registration: string): Promise<void> {
    await this.db.run('UPDATE users SET registration = $1, username = $2 WHERE id = $3', [registration, registration, id]);
  }

  async delete(id: string): Promise<void> {
    await this.db.run('DELETE FROM users WHERE id = $1', [id]);
  }

  async updatePassword(id: string, passwordHash: string, mustChangePassword = false): Promise<void> {
    await this.db.run('UPDATE users SET password_hash = $1, must_change_password = $2 WHERE id = $3', [
      passwordHash,
      mustChangePassword ? 1 : 0,
      id,
    ]);
  }

  async distinctGroups(field: 'sector' | 'shift'): Promise<string[]> {
    const column = field === 'sector' ? 'sector' : 'shift';
    const rows = await this.db.all(
      `SELECT DISTINCT ${column} AS value FROM users WHERE role = 'EMPLOYEE' AND ${column} IS NOT NULL`,
    );
    return rows.map((row) => String(row.value));
  }
}
