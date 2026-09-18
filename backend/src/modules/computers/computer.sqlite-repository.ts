import { nullableText, text, type SqliteDatabase } from '../../database/sqlite';
import type { ComputerRepository } from './computer.repository';
import type { Computer, ComputerInfo, ComputerStatus } from './computer.types';

function toComputer(row: Record<string, unknown>): Computer {
  return {
    computerId: text(row, 'computer_id'),
    hostname: text(row, 'hostname'),
    appVersion: text(row, 'app_version'),
    platform: text(row, 'platform'),
    status: text(row, 'status') as ComputerStatus,
    registeredAt: text(row, 'registered_at'),
    lastSeenAt: text(row, 'last_seen_at'),
    currentUserId: nullableText(row, 'current_user_id'),
    currentUserSince: nullableText(row, 'current_user_since'),
  };
}

export class SqliteComputerRepository implements ComputerRepository {
  private readonly sql;

  constructor(db: SqliteDatabase) {
    this.sql = {
      findById: db.prepare('SELECT * FROM computers WHERE computer_id = ?'),
      findAll: db.prepare('SELECT * FROM computers ORDER BY hostname'),
      insert: db.prepare(
        `INSERT INTO computers (computer_id, hostname, app_version, platform, status, registered_at, last_seen_at)
         VALUES (?, ?, ?, ?, 'OFFLINE', ?, ?)`,
      ),
      update: db.prepare(
        'UPDATE computers SET hostname = ?, app_version = ?, platform = ?, last_seen_at = ? WHERE computer_id = ?',
      ),
      updateStatus: db.prepare('UPDATE computers SET status = ?, last_seen_at = ? WHERE computer_id = ?'),
      markAllOffline: db.prepare(`UPDATE computers SET status = 'OFFLINE' WHERE status <> 'OFFLINE'`),
      getSecretHash: db.prepare('SELECT secret_hash FROM computers WHERE computer_id = ?'),
      setSecretHash: db.prepare('UPDATE computers SET secret_hash = ? WHERE computer_id = ?'),
      setCurrentUser: db.prepare('UPDATE computers SET current_user_id = ?, current_user_since = ? WHERE computer_id = ?'),
      findByCurrentUser: db.prepare('SELECT * FROM computers WHERE current_user_id = ?'),
      findWithCurrentUser: db.prepare('SELECT * FROM computers WHERE current_user_id IS NOT NULL'),
    };
  }

  async setCurrentUser(computerId: string, userId: string | null): Promise<void> {
    this.sql.setCurrentUser.run(userId, userId ? new Date().toISOString() : null, computerId);
  }

  async findByCurrentUser(userId: string): Promise<Computer[]> {
    return this.sql.findByCurrentUser.all(userId).map(toComputer);
  }

  async findWithCurrentUser(): Promise<Computer[]> {
    return this.sql.findWithCurrentUser.all().map(toComputer);
  }

  async getSecretHash(computerId: string): Promise<string | null> {
    const row = this.sql.getSecretHash.get(computerId);
    return row && row.secret_hash ? String(row.secret_hash) : null;
  }

  async setSecretHash(computerId: string, secretHash: string | null): Promise<void> {
    this.sql.setSecretHash.run(secretHash, computerId);
  }

  async upsert(info: ComputerInfo, now: Date): Promise<{ computer: Computer; created: boolean }> {
    const iso = now.toISOString();
    const existing = this.sql.findById.get(info.computerId);
    if (existing) {
      this.sql.update.run(info.hostname, info.appVersion, info.platform, iso, info.computerId);
    } else {
      this.sql.insert.run(info.computerId, info.hostname, info.appVersion, info.platform, iso, iso);
    }
    const row = this.sql.findById.get(info.computerId) as Record<string, unknown>;
    return { computer: toComputer(row), created: !existing };
  }

  async findById(computerId: string): Promise<Computer | null> {
    const row = this.sql.findById.get(computerId);
    return row ? toComputer(row) : null;
  }

  async findAll(): Promise<Computer[]> {
    return this.sql.findAll.all().map(toComputer);
  }

  async updateStatus(computerId: string, status: ComputerStatus, now: Date): Promise<void> {
    this.sql.updateStatus.run(status, now.toISOString(), computerId);
  }

  async markAllOffline(): Promise<void> {
    this.sql.markAllOffline.run();
  }
}
