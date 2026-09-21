import { randomUUID } from 'node:crypto';
import { text, type PostgresDatabase, type Row } from '../../database/postgres';
import type { SectorRepository } from './sector.repository';
import type { Sector } from './sector.types';

function toSector(row: Row): Sector {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    employeeCount: Number(row.employee_count ?? 0),
    createdAt: text(row, 'created_at'),
  };
}

const WITH_COUNT = `SELECT s.*,
  (SELECT COUNT(*) FROM users u WHERE u.role = 'EMPLOYEE' AND u.sector = s.name) AS employee_count
  FROM sectors s`;

export class PostgresSectorRepository implements SectorRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async list(): Promise<Sector[]> {
    return (await this.db.all(`${WITH_COUNT} ORDER BY lower(s.name)`)).map(toSector);
  }

  async findById(id: string): Promise<Sector | null> {
    const row = await this.db.one(`${WITH_COUNT} WHERE s.id = $1`, [id]);
    return row ? toSector(row) : null;
  }

  async create(name: string, now: Date): Promise<Sector> {
    const id = randomUUID();
    await this.db.run('INSERT INTO sectors (id, name, created_at) VALUES ($1, $2, $3)', [id, name, now.toISOString()]);
    return { id, name, employeeCount: 0, createdAt: now.toISOString() };
  }

  async rename(id: string, oldName: string, newName: string): Promise<void> {
    // Tudo ou nada: setor, funcionários e histórico de mensagens mudam juntos
    await this.db.transaction(async (tx) => {
      await tx.run('UPDATE sectors SET name = $1 WHERE id = $2', [newName, id]);
      await tx.run("UPDATE users SET sector = $1 WHERE role = 'EMPLOYEE' AND sector = $2", [newName, oldName]);
      await tx.run("UPDATE messages SET target_id = $1 WHERE target = 'SECTOR' AND target_id = $2", [newName, oldName]);
      await tx.run('UPDATE auto_replies SET sector = $1 WHERE sector = $2', [newName, oldName]);
    });
  }

  async delete(id: string): Promise<void> {
    // As respostas automáticas daquele setor saem junto
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM auto_replies WHERE sector = (SELECT name FROM sectors WHERE id = $1)', [id]);
      await tx.run('DELETE FROM sectors WHERE id = $1', [id]);
    });
  }
}
