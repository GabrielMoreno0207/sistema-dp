import { randomUUID } from 'node:crypto';
import { text, type SqliteDatabase } from '../../database/sqlite';
import type { SectorRepository } from './sector.repository';
import type { Sector } from './sector.types';

function toSector(row: Record<string, unknown>): Sector {
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

export class SqliteSectorRepository implements SectorRepository {
  private readonly sql;

  constructor(private readonly db: SqliteDatabase) {
    this.sql = {
      list: db.prepare(`${WITH_COUNT} ORDER BY s.name COLLATE NOCASE`),
      findById: db.prepare(`${WITH_COUNT} WHERE s.id = ?`),
      insert: db.prepare('INSERT INTO sectors (id, name, created_at) VALUES (?, ?, ?)'),
      rename: db.prepare('UPDATE sectors SET name = ? WHERE id = ?'),
      renameUsers: db.prepare(`UPDATE users SET sector = ? WHERE role = 'EMPLOYEE' AND sector = ?`),
      renameMessages: db.prepare(`UPDATE messages SET target_id = ? WHERE target = 'SECTOR' AND target_id = ?`),
      renameAutoReplies: db.prepare(`UPDATE auto_replies SET sector = ? WHERE sector = ?`),
      deleteAutoReplies: db.prepare(`DELETE FROM auto_replies WHERE sector = (SELECT name FROM sectors WHERE id = ?)`),
      delete: db.prepare('DELETE FROM sectors WHERE id = ?'),
    };
  }

  async list(): Promise<Sector[]> {
    return this.sql.list.all().map(toSector);
  }

  async findById(id: string): Promise<Sector | null> {
    const row = this.sql.findById.get(id);
    return row ? toSector(row) : null;
  }

  async create(name: string, now: Date): Promise<Sector> {
    const id = randomUUID();
    this.sql.insert.run(id, name, now.toISOString());
    return { id, name, employeeCount: 0, createdAt: now.toISOString() };
  }

  async rename(id: string, oldName: string, newName: string): Promise<void> {
    // Tudo ou nada: setor, funcionários e histórico de mensagens mudam juntos
    this.db.exec('BEGIN');
    try {
      this.sql.rename.run(newName, id);
      this.sql.renameUsers.run(newName, oldName);
      this.sql.renameMessages.run(newName, oldName);
      this.sql.renameAutoReplies.run(newName, oldName);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    // As respostas automáticas daquele setor saem junto
    this.db.exec('BEGIN');
    try {
      this.sql.deleteAutoReplies.run(id);
      this.sql.delete.run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
