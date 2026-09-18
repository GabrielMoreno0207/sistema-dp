import { randomUUID } from 'node:crypto';
import { nullableText, text, type SqliteDatabase } from '../../database/sqlite';
import type { UserRepository } from './user.repository';
import type { NewUser, ProfileUpdate, User, UserRole, UserStatus, UserWithPassword } from './user.types';

function toUser(row: Record<string, unknown>): UserWithPassword {
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

export class SqliteUserRepository implements UserRepository {
  private readonly sql;

  constructor(db: SqliteDatabase) {
    this.sql = {
      findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
      findByRegistration: db.prepare(`SELECT * FROM users WHERE registration = ? AND role = 'EMPLOYEE'`),
      findById: db.prepare('SELECT * FROM users WHERE id = ?'),
      listByRole: db.prepare('SELECT * FROM users WHERE role = ? ORDER BY name COLLATE NOCASE'),
      countByRole: db.prepare('SELECT COUNT(*) AS total FROM users WHERE role = ?'),
      countBySector: db.prepare(
        `SELECT COUNT(*) AS total FROM users WHERE role = 'EMPLOYEE' AND status = 'ACTIVE' AND sector = ?`,
      ),
      countByShift: db.prepare(
        `SELECT COUNT(*) AS total FROM users WHERE role = 'EMPLOYEE' AND status = 'ACTIVE' AND shift = ?`,
      ),
      insert: db.prepare(
        `INSERT INTO users (id, username, name, registration, sector, shift, role, status, must_change_password, chat_contact, super_admin, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      updateStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
      updateProfile: db.prepare('UPDATE users SET name = ?, sector = ?, shift = ?, status = ? WHERE id = ?'),
      updateRegistration: db.prepare('UPDATE users SET registration = ?, username = ? WHERE id = ?'),
      delete: db.prepare('DELETE FROM users WHERE id = ?'),
      updatePassword: db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?'),
      distinctSectors: db.prepare(`SELECT DISTINCT sector AS value FROM users WHERE role = 'EMPLOYEE' AND sector IS NOT NULL`),
      distinctShifts: db.prepare(`SELECT DISTINCT shift AS value FROM users WHERE role = 'EMPLOYEE' AND shift IS NOT NULL`),
    };
  }

  async findByUsername(username: string): Promise<UserWithPassword | null> {
    const row = this.sql.findByUsername.get(username);
    return row ? toUser(row) : null;
  }

  async findByRegistration(registration: string): Promise<UserWithPassword | null> {
    const row = this.sql.findByRegistration.get(registration);
    return row ? toUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = this.sql.findById.get(id);
    return row ? withoutPassword(toUser(row)) : null;
  }

  async findWithPasswordById(id: string): Promise<UserWithPassword | null> {
    const row = this.sql.findById.get(id);
    return row ? toUser(row) : null;
  }

  async listByRole(role: UserRole): Promise<User[]> {
    return this.sql.listByRole.all(role).map((row) => withoutPassword(toUser(row)));
  }

  async countByRole(role: UserRole): Promise<number> {
    return Number((this.sql.countByRole.get(role) as Record<string, unknown>).total);
  }

  async countActiveEmployees(field: 'sector' | 'shift', value: string): Promise<number> {
    const statement = field === 'sector' ? this.sql.countBySector : this.sql.countByShift;
    return Number((statement.get(value) as Record<string, unknown>).total);
  }

  async create(data: NewUser, now: Date): Promise<User> {
    const id = randomUUID();
    this.sql.insert.run(
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
    );
    return withoutPassword({ ...data, id, createdAt: now.toISOString() });
  }

  async updateStatus(id: string, status: UserStatus): Promise<void> {
    this.sql.updateStatus.run(status, id);
  }

  async updateProfile(id: string, data: ProfileUpdate): Promise<void> {
    this.sql.updateProfile.run(data.name, data.sector, data.shift, data.status, id);
  }

  async updateRegistration(id: string, registration: string): Promise<void> {
    this.sql.updateRegistration.run(registration, registration, id);
  }

  async delete(id: string): Promise<void> {
    this.sql.delete.run(id);
  }

  async updatePassword(id: string, passwordHash: string, mustChangePassword = false): Promise<void> {
    this.sql.updatePassword.run(passwordHash, mustChangePassword ? 1 : 0, id);
  }

  async distinctGroups(field: 'sector' | 'shift'): Promise<string[]> {
    const statement = field === 'sector' ? this.sql.distinctSectors : this.sql.distinctShifts;
    return statement.all().map((row) => String(row.value));
  }
}
