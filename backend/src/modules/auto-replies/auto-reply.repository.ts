import type { AutoReply, AutoReplyInput } from './auto-reply.types';

export interface AutoReplyRepository {
  /** Da pessoa do DP: a de "todos os setores" primeiro, depois por setor */
  listByDpUser(dpUserId: string): Promise<AutoReply[]>;
  findById(id: string): Promise<AutoReply | null>;
  create(dpUserId: string, input: AutoReplyInput, now: Date): Promise<AutoReply>;
  update(id: string, input: AutoReplyInput, now: Date): Promise<AutoReply>;
  delete(id: string): Promise<void>;
}
