import { app, powerMonitor } from 'electron';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiClient } from './api-client';
import { horarioValido, msAteHorario } from './horario';

/** Horário da verificação diária (madrugada: o PC costuma estar ligado e ocioso). */
const HORARIO_PADRAO = '03:00';
/** Primeira verificação depois de abrir o aplicativo (cobre o PC que estava desligado às 3h). */
const ESPERA_INICIAL_MS = 3 * 60_000;
/** Ninguém mexendo no PC há esse tempo = pode instalar sem atrapalhar. */
const OCIOSO_MINIMO_S = 5 * 60;
/** PC em uso na hora marcada: tenta de novo mais tarde, em vez de fechar o app na cara de alguém. */
const REVERIFICAR_SE_EM_USO_MS = 30 * 60_000;
/**
 * Tempo que o aviso fica na tela antes de fechar o aplicativo.
 *
 * A atualização obrigatória instala mesmo com alguém usando o computador, então
 * a pessoa precisa de um momento para ler que o programa vai fechar e voltar
 * sozinho — sem isso, a janela some do nada e parece que travou.
 */
const AVISO_NA_TELA_MS = 10_000;
/** Sem ninguém na frente (atualização comum, PC ocioso), só o tempo de o aviso aparecer. */
const AVISO_CURTO_MS = 1_500;

export interface AtualizadorOpcoes {
  /** Cliente da API, ou null quando o servidor ainda não está configurado */
  obterApi: () => ApiClient | null;
  estaConectado: () => boolean;
  versaoAtual: string;
  /** "HH:MM"; o padrão é 03:00 */
  horario?: string;
  log?: (mensagem: string) => void;
  /**
   * Avisa a janela de que o aplicativo vai fechar para instalar. Chamado antes
   * de o instalador começar, para a tela mostrar o recado a quem está usando.
   * Com null, tira o aviso: a instalação não aconteceu e o app segue aberto.
   */
  avisarTela?: (info: { versao: string; obrigatoria: boolean } | null) => void;
}

/**
 * Atualização automática do aplicativo.
 *
 * Todo dia no horário marcado (03:00) pergunta ao servidor se há versão nova.
 * Havendo, baixa, confere o SHA-256 e roda o instalador em modo silencioso,
 * que fecha o aplicativo, atualiza e abre de novo.
 *
 * Não usamos electron-updater: o download já passa pela API autenticada do
 * servidor (mesmo token do PC) e o próprio backend entrega o hash do arquivo.
 */
export class Atualizador {
  private readonly horario: string;
  private readonly log: (mensagem: string) => void;
  private timerDiario: NodeJS.Timeout | null = null;
  private timerInicial: NodeJS.Timeout | null = null;
  private timerEmUso: NodeJS.Timeout | null = null;
  private verificando = false;
  /** Quando terminou a última verificação (evita repetir a cada reconexão) */
  private ultimaVerificacao = 0;
  /** Instalador já baixado e conferido, esperando a hora de instalar */
  private pendente: { versao: string; caminho: string; obrigatoria: boolean } | null = null;
  /**
   * Instalação em andamento (o aviso está na tela e o aplicativo vai fechar).
   * Trava daqui em diante: sem isso, uma verificação disparada no meio do aviso
   * baixaria e rodaria o instalador uma segunda vez.
   */
  private instalando = false;

  constructor(private readonly opcoes: AtualizadorOpcoes) {
    this.horario = horarioValido(opcoes.horario) ?? HORARIO_PADRAO;
    this.log = opcoes.log ?? ((mensagem) => console.log(`[atualizador] ${mensagem}`));
  }

  iniciar(): void {
    this.timerInicial = setTimeout(() => void this.verificar('abertura do aplicativo'), ESPERA_INICIAL_MS);
    this.agendarProximo();
    this.log(`verificação diária às ${this.horario} (versão instalada: ${this.opcoes.versaoAtual})`);
  }

  parar(): void {
    for (const timer of [this.timerDiario, this.timerInicial, this.timerEmUso]) {
      if (timer) clearTimeout(timer);
    }
    this.timerDiario = this.timerInicial = this.timerEmUso = null;
  }

  private agendarProximo(): void {
    if (this.timerDiario) clearTimeout(this.timerDiario);
    const espera = msAteHorario(this.horario);
    this.timerDiario = setTimeout(() => {
      void this.verificar('horário diário').finally(() => this.agendarProximo());
    }, espera);
    // setTimeout não é preciso em dias longos de suspensão; reagendar a cada disparo corrige a deriva
    this.timerDiario.unref?.();
  }

  /** Verificação manual ou agendada. Nunca deixa erro escapar: no máximo fica para o próximo dia. */
  async verificar(origem: string): Promise<void> {
    if (this.verificando || this.instalando) return;
    // Já baixado numa verificação anterior: só falta instalar
    if (this.pendente) {
      this.instalarSePuder();
      return;
    }

    const api = this.opcoes.obterApi();
    if (!api || !this.opcoes.estaConectado()) {
      this.log(`${origem}: sem conexão com o servidor, fica para a próxima`);
      return;
    }

    this.verificando = true;
    try {
      const versao = await api.verificarAtualizacao(this.opcoes.versaoAtual);
      if (!versao) {
        this.log(`${origem}: nenhuma versão nova (instalada: ${this.opcoes.versaoAtual})`);
        return;
      }

      this.log(`${origem}: versão ${versao.versao} disponível (${(versao.tamanho / 1024 / 1024).toFixed(1)} MB), baixando`);
      const caminho = join(app.getPath('temp'), `ComunicacaoDP-${versao.versao}.exe`);
      const integro = await api.baixarAtualizacao(versao, caminho);
      if (!integro) {
        rmSync(caminho, { force: true });
        this.log(`${origem}: o arquivo baixado não confere com o hash do servidor; descartado`);
        return;
      }

      this.pendente = { versao: versao.versao, caminho, obrigatoria: versao.obrigatoria };
      this.log(`versão ${versao.versao} baixada e conferida`);
      this.instalarSePuder();
    } catch (err) {
      this.log(`${origem}: falha ao verificar/baixar (${(err as Error).message})`);
    } finally {
      this.verificando = false;
      this.ultimaVerificacao = Date.now();
    }
  }

  /**
   * Verificação fora de hora (aviso do servidor, volta da conexão). Só vale se
   * a última já tiver um tempo: reconexão é comum e não precisa consultar toda vez.
   */
  async verificarSeVelha(origem: string, intervaloMinimoMs: number): Promise<void> {
    if (Date.now() - this.ultimaVerificacao < intervaloMinimoMs) return;
    await this.verificar(origem);
  }

  /**
   * Instala se ninguém estiver usando o computador. Em uso, tenta de novo mais
   * tarde — exceto quando a versão é obrigatória, que instala assim mesmo.
   */
  private instalarSePuder(): void {
    if (!this.pendente) return;
    const ocioso = powerMonitor.getSystemIdleTime();
    if (!this.pendente.obrigatoria && ocioso < OCIOSO_MINIMO_S) {
      this.log(`computador em uso (ocioso há ${ocioso}s); nova tentativa em 30 minutos`);
      if (this.timerEmUso) clearTimeout(this.timerEmUso);
      this.timerEmUso = setTimeout(() => this.instalarSePuder(), REVERIFICAR_SE_EM_USO_MS);
      return;
    }
    this.instalar();
  }

  /**
   * Avisa na tela e roda o instalador em modo silencioso (/S). O instalador
   * troca os arquivos e abre o aplicativo de novo (runAfterFinish do
   * electron-builder).
   *
   * Na obrigatória o aviso fica alguns segundos antes de fechar: quem está
   * usando o computador vê o que está acontecendo, em vez de a janela sumir.
   */
  private instalar(): void {
    if (!this.pendente || this.instalando) return;
    const { caminho, versao, obrigatoria } = this.pendente;
    // Tranca agora: o aviso demora, e uma nova verificação nesse meio-tempo não pode reinstalar
    this.pendente = null;
    this.instalando = true;

    this.log(`instalando a versão ${versao} e reiniciando o aplicativo`);
    try {
      this.opcoes.avisarTela?.({ versao, obrigatoria });
    } catch (err) {
      // Janela fechada ou destruída: o aviso é um extra, a instalação segue
      this.log(`não foi possível mostrar o aviso na tela: ${(err as Error).message}`);
    }

    const espera = obrigatoria ? AVISO_NA_TELA_MS : AVISO_CURTO_MS;
    setTimeout(() => {
      try {
        const processo = spawn(caminho, ['/S'], { detached: true, stdio: 'ignore' });
        processo.unref();
        setTimeout(() => app.quit(), 1_500);
      } catch (err) {
        // Destrava e tira o aviso da frente: o aplicativo continua aberto e
        // utilizável, e a próxima verificação tenta de novo
        this.instalando = false;
        this.opcoes.avisarTela?.(null);
        this.log(`falha ao iniciar o instalador: ${(err as Error).message}`);
      }
    }, espera);
  }
}
