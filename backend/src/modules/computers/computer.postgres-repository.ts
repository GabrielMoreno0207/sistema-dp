import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { ComputerRepository } from './computer.repository';
import type { Computer, ComputerInfo, ComputerStatus } from './computer.types';

function toComputer(row: Row): Computer {
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

export class PostgresComputerRepository implements ComputerRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async setCurrentUser(computerId: string, userId: string | null): Promise<void> {
    await this.db.run('UPDATE computers SET current_user_id = $1, current_user_since = $2 WHERE computer_id = $3', [
      userId,
      userId ? new Date().toISOString() : null,
      computerId,
    ]);
  }

  async findByCurrentUser(userId: string): Promise<Computer[]> {
    return (await this.db.all('SELECT * FROM computers WHERE current_user_id = $1', [userId])).map(toComputer);
  }

  async findWithCurrentUser(): Promise<Computer[]> {
    return (await this.db.all('SELECT * FROM computers WHERE current_user_id IS NOT NULL')).map(toComputer);
  }

  async getSecretHash(computerId: string): Promise<string | null> {
    const row = await this.db.one('SELECT secret_hash FROM computers WHERE computer_id = $1', [computerId]);
    return row && row.secret_hash ? String(row.secret_hash) : null;
  }

  async setSecretHash(computerId: string, secretHash: string | null): Promise<void> {
    await this.db.run('UPDATE computers SET secret_hash = $1 WHERE computer_id = $2', [secretHash, computerId]);
  }

  async upsert(info: ComputerInfo, now: Date): Promise<{ computer: Computer; created: boolean }> {
    const iso = now.toISOString();
    // Um único comando evita que dois registros simultâneos do mesmo PC se atropelem.
    // xmax = 0 identifica a linha recém-inserida (não foi um UPDATE).
    const row = await this.db.one(
      `INSERT INTO computers (computer_id, hostname, app_version, platform, status, registered_at, last_seen_at)
       VALUES ($1, $2, $3, $4, 'OFFLINE', $5, $5)
       ON CONFLICT (computer_id) DO UPDATE
         SET hostname = EXCLUDED.hostname,
             app_version = EXCLUDED.app_version,
             platform = EXCLUDED.platform,
             last_seen_at = EXCLUDED.last_seen_at
       RETURNING *, (xmax = 0) AS inserido`,
      [info.computerId, info.hostname, info.appVersion, info.platform, iso],
    );
    const data = row as Row;
    return { computer: toComputer(data), created: data.inserido === true };
  }

  async findById(computerId: string): Promise<Computer | null> {
    const row = await this.db.one('SELECT * FROM computers WHERE computer_id = $1', [computerId]);
    return row ? toComputer(row) : null;
  }

  async findAll(): Promise<Computer[]> {
    return (await this.db.all('SELECT * FROM computers ORDER BY hostname')).map(toComputer);
  }

  async updateStatus(computerId: string, status: ComputerStatus, now: Date): Promise<void> {
    await this.db.run('UPDATE computers SET status = $1, last_seen_at = $2 WHERE computer_id = $3', [
      status,
      now.toISOString(),
      computerId,
    ]);
  }

  async markAllOffline(): Promise<void> {
    await this.db.run("UPDATE computers SET status = 'OFFLINE' WHERE status <> 'OFFLINE'");
  }
}
