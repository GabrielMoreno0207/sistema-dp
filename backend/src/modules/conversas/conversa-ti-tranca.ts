import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../errors/app-error';
import { hashToken } from '../auth/crypto';
import { LoginThrottle } from '../auth/login-throttle';

/**
 * Segunda tranca da área Conversas (TI).
 *
 * Ter a conta (ou o setor) do TI abre a tela, mas não abre conversa de ninguém:
 * antes de ler, baixar ou apagar, o servidor pede a senha do TI — a mesma que
 * encerra o aplicativo no computador. Quem deixa o aplicativo aberto com a
 * conta do TI não expõe as conversas de quem passar na frente da máquina.
 *
 * A liberação é por sessão, não por conta: a chave é o resumo do token, então
 * outro computador (ou o mesmo depois de o servidor reiniciar) digita de novo.
 */
export const VALIDADE_DA_LIBERACAO_MS = 30 * 60 * 1000;

export class TrancaDaAreaTi {
  /** resumo do token -> instante em que a liberação vence */
  private readonly liberadas = new Map<string, number>();
  private readonly tentativas = new LoginThrottle();

  /**
   * @param resumoDaSenha resumo SHA-256 da senha do TI (a senha em si não fica
   *                      guardada em lugar nenhum, nem no código, nem aqui)
   */
  constructor(
    private readonly resumoDaSenha: string,
    private readonly validadeMs = VALIDADE_DA_LIBERACAO_MS,
  ) {}

  /** Libera a área para esta sessão. Senha errada: 401; insistiu: 429. */
  liberar(token: string | null, quemId: string, senha: string, ip: string, agora = Date.now()): { validoAte: string } {
    const chave = this.chaveDaSessao(token);
    const alvo = `conversas-ti|${quemId}|${ip}`;
    const bloqueadoMs = this.tentativas.blockedFor(alvo, agora);
    if (bloqueadoMs > 0) {
      throw new AppError(
        `Muitas tentativas inválidas. Tente novamente em ${Math.ceil(bloqueadoMs / 60_000)} minuto(s).`,
        429,
        'TOO_MANY_ATTEMPTS',
      );
    }
    if (!this.senhaConfere(senha)) {
      this.tentativas.registerFailure(alvo, agora);
      throw new AppError('Senha do TI incorreta.', 401, 'SENHA_TI_INVALIDA');
    }

    this.tentativas.reset(alvo);
    const vence = agora + this.validadeMs;
    this.liberadas.set(chave, vence);
    return { validoAte: new Date(vence).toISOString() };
  }

  /** Barra quem ainda não digitou a senha (ou cuja liberação venceu). */
  exigir(token: string | null, agora = Date.now()): void {
    const chave = this.chaveDaSessao(token);
    const vence = this.liberadas.get(chave) ?? 0;
    if (vence <= agora) {
      this.liberadas.delete(chave);
      throw new AppError('Digite a senha do TI para abrir as conversas.', 423, 'AREA_TI_TRANCADA');
    }
  }

  /** Tranca de novo (o botão da tela, e ao sair da conta). */
  trancar(token: string | null): void {
    this.liberadas.delete(this.chaveDaSessao(token));
  }

  /** Tira as liberações vencidas (o mapa não cresce sem limite). */
  prune(agora = Date.now()): void {
    for (const [chave, vence] of this.liberadas) {
      if (vence <= agora) this.liberadas.delete(chave);
    }
    this.tentativas.prune(agora);
  }

  /** Guardamos só o resumo do token, como a tabela de sessões já faz. */
  private chaveDaSessao(token: string | null): string {
    if (!token) throw new AppError('Autenticação necessária', 401, 'UNAUTHORIZED');
    return hashToken(token);
  }

  private senhaConfere(senha: string): boolean {
    const recebido = createHash('sha256').update(senha).digest('hex');
    // timingSafeEqual: comparar byte a byte não conta o tempo a favor de quem tenta adivinhar
    return timingSafeEqual(Buffer.from(recebido, 'hex'), Buffer.from(this.resumoDaSenha, 'hex'));
  }
}
