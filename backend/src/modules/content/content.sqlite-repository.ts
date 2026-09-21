import { nullableText, text, type Row, type SqliteDatabase } from '../../database/sqlite';
import type { AtalhoRepository, MidiaRepository, MuralRepository } from './content.repository';
import type { Atalho, DestinoAtalho, Midia, MidiaTipo, MuralPost, NovoAtalho } from './content.types';

function toMidia(row: Row): Midia {
  return {
    id: text(row, 'id'),
    tipo: text(row, 'tipo') as MidiaTipo,
    nome: text(row, 'nome'),
    mimeType: text(row, 'mime_type'),
    tamanho: Number(row.tamanho),
    sha256: text(row, 'sha256'),
    storedName: text(row, 'stored_name'),
    enviadoPor: text(row, 'enviado_por'),
    createdAt: text(row, 'created_at'),
  };
}

function toMural(row: Row): MuralPost {
  return {
    id: text(row, 'id'),
    titulo: text(row, 'titulo'),
    texto: text(row, 'texto'),
    midiaId: nullableText(row, 'midia_id'),
    ativo: Number(row.ativo) === 1,
    criadoPor: text(row, 'criado_por'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function toAtalho(row: Row): Atalho {
  return {
    id: text(row, 'id'),
    userId: text(row, 'user_id'),
    ordem: Number(row.ordem),
    rotulo: text(row, 'rotulo'),
    icone: text(row, 'icone'),
    cor: text(row, 'cor'),
    destino: text(row, 'destino') as DestinoAtalho,
    createdAt: text(row, 'created_at'),
  };
}

export class SqliteMidiaRepository implements MidiaRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async create(midia: Midia): Promise<Midia> {
    this.db
      .prepare(
        `INSERT INTO midias (id, tipo, nome, mime_type, tamanho, sha256, stored_name, enviado_por, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        midia.id,
        midia.tipo,
        midia.nome,
        midia.mimeType,
        midia.tamanho,
        midia.sha256,
        midia.storedName,
        midia.enviadoPor,
        midia.createdAt,
      );
    return midia;
  }

  async findById(id: string): Promise<Midia | null> {
    const row = this.db.prepare('SELECT * FROM midias WHERE id = ?').get(id);
    return row ? toMidia(row as Row) : null;
  }

  async delete(id: string): Promise<boolean> {
    return Number(this.db.prepare('DELETE FROM midias WHERE id = ?').run(id).changes) > 0;
  }

  async listStoredNames(): Promise<string[]> {
    return this.db
      .prepare('SELECT stored_name FROM midias')
      .all()
      .map((row) => text(row as Row, 'stored_name'));
  }

  async listSemUso(antesDe: string): Promise<Midia[]> {
    return this.db
      .prepare(
        `SELECT * FROM midias m
         WHERE m.created_at < ?
           AND NOT EXISTS (SELECT 1 FROM mural_posts p WHERE p.midia_id = m.id)
           AND NOT EXISTS (SELECT 1 FROM users u WHERE u.foto_midia_id = m.id)`,
      )
      .all(antesDe)
      .map((row) => toMidia(row as Row));
  }
}

export class SqliteMuralRepository implements MuralRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async findAtivo(): Promise<MuralPost | null> {
    const row = this.db.prepare('SELECT * FROM mural_posts WHERE ativo = 1 ORDER BY created_at DESC LIMIT 1').get();
    return row ? toMural(row as Row) : null;
  }

  async listAll(limite: number): Promise<MuralPost[]> {
    return this.db
      .prepare('SELECT * FROM mural_posts ORDER BY created_at DESC LIMIT ?')
      .all(limite)
      .map((row) => toMural(row as Row));
  }

  async findById(id: string): Promise<MuralPost | null> {
    const row = this.db.prepare('SELECT * FROM mural_posts WHERE id = ?').get(id);
    return row ? toMural(row as Row) : null;
  }

  async create(post: MuralPost): Promise<MuralPost> {
    this.db
      .prepare(
        `INSERT INTO mural_posts (id, titulo, texto, midia_id, ativo, criado_por, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(post.id, post.titulo, post.texto, post.midiaId, post.ativo ? 1 : 0, post.criadoPor, post.createdAt, post.updatedAt);
    return post;
  }

  async update(
    id: string,
    dados: Pick<MuralPost, 'titulo' | 'texto' | 'midiaId' | 'ativo'>,
    agora: string,
  ): Promise<MuralPost> {
    const row = this.db
      .prepare(
        `UPDATE mural_posts SET titulo = ?, texto = ?, midia_id = ?, ativo = ?, updated_at = ?
         WHERE id = ? RETURNING *`,
      )
      .get(dados.titulo, dados.texto, dados.midiaId, dados.ativo ? 1 : 0, agora, id);
    return toMural(row as Row);
  }

  async delete(id: string): Promise<boolean> {
    return Number(this.db.prepare('DELETE FROM mural_posts WHERE id = ?').run(id).changes) > 0;
  }
}

export class SqliteAtalhoRepository implements AtalhoRepository {
  constructor(private readonly db: SqliteDatabase) {}

  async listByUser(userId: string): Promise<Atalho[]> {
    return this.db
      .prepare('SELECT * FROM atalhos WHERE user_id = ? ORDER BY ordem, created_at')
      .all(userId)
      .map((row) => toAtalho(row as Row));
  }

  async findById(id: string): Promise<Atalho | null> {
    const row = this.db.prepare('SELECT * FROM atalhos WHERE id = ?').get(id);
    return row ? toAtalho(row as Row) : null;
  }

  async countByUser(userId: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM atalhos WHERE user_id = ?').get(userId) as Row;
    return Number(row.total);
  }

  async create(atalho: Atalho): Promise<Atalho> {
    this.db
      .prepare(
        `INSERT INTO atalhos (id, user_id, ordem, rotulo, icone, cor, destino, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        atalho.id,
        atalho.userId,
        atalho.ordem,
        atalho.rotulo,
        atalho.icone,
        atalho.cor,
        atalho.destino,
        atalho.createdAt,
      );
    return atalho;
  }

  async update(id: string, dados: Omit<NovoAtalho, 'userId'>): Promise<Atalho> {
    const row = this.db
      .prepare('UPDATE atalhos SET rotulo = ?, icone = ?, cor = ?, destino = ?, ordem = ? WHERE id = ? RETURNING *')
      .get(dados.rotulo, dados.icone, dados.cor, dados.destino, dados.ordem, id);
    return toAtalho(row as Row);
  }

  async delete(id: string): Promise<boolean> {
    return Number(this.db.prepare('DELETE FROM atalhos WHERE id = ?').run(id).changes) > 0;
  }

  async reordenar(userId: string, idsNaOrdem: string[]): Promise<void> {
    const atualizar = this.db.prepare('UPDATE atalhos SET ordem = ? WHERE id = ? AND user_id = ?');
    this.db.exec('BEGIN');
    try {
      idsNaOrdem.forEach((id, indice) => atualizar.run(indice, id, userId));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
