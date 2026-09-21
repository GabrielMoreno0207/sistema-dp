import { nullableText, text, type PostgresDatabase, type Row } from '../../database/postgres';
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

export class PostgresMidiaRepository implements MidiaRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async create(midia: Midia): Promise<Midia> {
    await this.db.run(
      `INSERT INTO midias (id, tipo, nome, mime_type, tamanho, sha256, stored_name, enviado_por, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        midia.id,
        midia.tipo,
        midia.nome,
        midia.mimeType,
        midia.tamanho,
        midia.sha256,
        midia.storedName,
        midia.enviadoPor,
        midia.createdAt,
      ],
    );
    return midia;
  }

  async findById(id: string): Promise<Midia | null> {
    const row = await this.db.one('SELECT * FROM midias WHERE id = $1', [id]);
    return row ? toMidia(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM midias WHERE id = $1', [id])) > 0;
  }

  async listStoredNames(): Promise<string[]> {
    return (await this.db.all('SELECT stored_name FROM midias')).map((row) => text(row, 'stored_name'));
  }

  async listSemUso(antesDe: string): Promise<Midia[]> {
    const rows = await this.db.all(
      `SELECT * FROM midias m
       WHERE m.created_at < $1
         AND NOT EXISTS (SELECT 1 FROM mural_posts p WHERE p.midia_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.foto_midia_id = m.id)`,
      [antesDe],
    );
    return rows.map(toMidia);
  }
}

export class PostgresMuralRepository implements MuralRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async findAtivo(): Promise<MuralPost | null> {
    const row = await this.db.one('SELECT * FROM mural_posts WHERE ativo = 1 ORDER BY created_at DESC LIMIT 1');
    return row ? toMural(row) : null;
  }

  async listAll(limite: number): Promise<MuralPost[]> {
    const rows = await this.db.all('SELECT * FROM mural_posts ORDER BY created_at DESC LIMIT $1', [limite]);
    return rows.map(toMural);
  }

  async findById(id: string): Promise<MuralPost | null> {
    const row = await this.db.one('SELECT * FROM mural_posts WHERE id = $1', [id]);
    return row ? toMural(row) : null;
  }

  async create(post: MuralPost): Promise<MuralPost> {
    await this.db.run(
      `INSERT INTO mural_posts (id, titulo, texto, midia_id, ativo, criado_por, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [post.id, post.titulo, post.texto, post.midiaId, post.ativo ? 1 : 0, post.criadoPor, post.createdAt, post.updatedAt],
    );
    return post;
  }

  async update(
    id: string,
    dados: Pick<MuralPost, 'titulo' | 'texto' | 'midiaId' | 'ativo'>,
    agora: string,
  ): Promise<MuralPost> {
    const row = await this.db.one(
      `UPDATE mural_posts SET titulo = $1, texto = $2, midia_id = $3, ativo = $4, updated_at = $5
       WHERE id = $6 RETURNING *`,
      [dados.titulo, dados.texto, dados.midiaId, dados.ativo ? 1 : 0, agora, id],
    );
    return toMural(row as Row);
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM mural_posts WHERE id = $1', [id])) > 0;
  }
}

export class PostgresAtalhoRepository implements AtalhoRepository {
  constructor(private readonly db: PostgresDatabase) {}

  async listByUser(userId: string): Promise<Atalho[]> {
    const rows = await this.db.all('SELECT * FROM atalhos WHERE user_id = $1 ORDER BY ordem, created_at', [userId]);
    return rows.map(toAtalho);
  }

  async findById(id: string): Promise<Atalho | null> {
    const row = await this.db.one('SELECT * FROM atalhos WHERE id = $1', [id]);
    return row ? toAtalho(row) : null;
  }

  async countByUser(userId: string): Promise<number> {
    const row = await this.db.one('SELECT COUNT(*) AS total FROM atalhos WHERE user_id = $1', [userId]);
    return Number(row?.total ?? 0);
  }

  async create(atalho: Atalho): Promise<Atalho> {
    await this.db.run(
      `INSERT INTO atalhos (id, user_id, ordem, rotulo, icone, cor, destino, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [atalho.id, atalho.userId, atalho.ordem, atalho.rotulo, atalho.icone, atalho.cor, atalho.destino, atalho.createdAt],
    );
    return atalho;
  }

  async update(id: string, dados: Omit<NovoAtalho, 'userId'>): Promise<Atalho> {
    const row = await this.db.one(
      'UPDATE atalhos SET rotulo = $1, icone = $2, cor = $3, destino = $4, ordem = $5 WHERE id = $6 RETURNING *',
      [dados.rotulo, dados.icone, dados.cor, dados.destino, dados.ordem, id],
    );
    return toAtalho(row as Row);
  }

  async delete(id: string): Promise<boolean> {
    return (await this.db.run('DELETE FROM atalhos WHERE id = $1', [id])) > 0;
  }

  async reordenar(userId: string, idsNaOrdem: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [indice, id] of idsNaOrdem.entries()) {
        await tx.run('UPDATE atalhos SET ordem = $1 WHERE id = $2 AND user_id = $3', [indice, id, userId]);
      }
    });
  }
}
