import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { AuthService } from '../modules/auth/auth.service';
import type { ComputerService } from '../modules/computers/computer.service';
import { env } from '../config/env';
import { limparIp, parseComputerInfo, type ComputerInfo } from '../modules/computers/computer.types';
import type { EmployeeService } from '../modules/employees/employee.service';
import type { MessageNotifier } from '../modules/messages/message.service';
import type { Message, RecipientMessage } from '../modules/messages/message.types';
import type { EmployeeProfile } from '../modules/users/user.types';

export interface ServerToClientEvents {
  'session:ready': (payload: { computerId: string; serverTime: string }) => void;
  'message:new': (message: RecipientMessage) => void;
  /** A sessão do funcionário neste PC mudou por ação do servidor (expirou, desativado, senha redefinida...) */
  'session:changed': (payload: { employee: EmployeeProfile | null }) => void;
  /** O recado do mural mudou: o app busca o novo (o conteúdo não vai no evento) */
  'mural:atualizado': () => void;
  /** Saiu versão nova de um aplicativo: quem estiver conectado confere na hora */
  'atualizacao:publicada': (payload: { app: string; versao: string }) => void;
  /** O TI apagou comunicados ou conversas: os aplicativos buscam a lista de novo */
  'dados:limpos': (payload: { o: 'comunicados' | 'conversas' }) => void;
  /** Um chamado de quem está logado neste PC mudou (resposta do TI, status novo) */
  'chamado:atualizado': (payload: { chamadoId: string }) => void;
  /** Uma conversa de quem está logado neste PC mudou (mensagem, grupo, leitura) */
  'conversa:atualizada': (payload: { conversaId: string; mensagem: AvisoDeMensagem | null }) => void;
  /** O DP pediu para lembrar quem ainda não leu um comunicado */
  'comunicado:lembrete': (payload: { messageId: string }) => void;
}

// O cliente não envia eventos por enquanto; tudo que ele faz passa pela API REST.
export type ClientToServerEvents = Record<string, never>;

export interface SocketData {
  computer: ComputerInfo;
}

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const Rooms = {
  all: 'all',
  computer: (computerId: string) => `computer:${computerId}`,
  employee: (employeeId: string) => `employee:${employeeId}`,
  sector: (sector: string) => `sector:${sector}`,
  shift: (shift: string) => `shift:${shift}`,
} as const;

/** Salas que dependem do funcionário logado no computador */
const EMPLOYEE_ROOM_PREFIXES = ['employee:', 'sector:', 'shift:'];

function employeeRooms(employee: EmployeeProfile): string[] {
  const rooms = [Rooms.employee(employee.id)];
  if (employee.sector) rooms.push(Rooms.sector(employee.sector));
  if (employee.shift) rooms.push(Rooms.shift(employee.shift));
  return rooms;
}

/** Sala do Socket.IO que recebe a mensagem. Novos destinos entram aqui. */
function roomFor(message: Message): string | null {
  if (message.target === 'ALL') return Rooms.all;
  if (!message.targetId) return null;
  switch (message.target) {
    case 'COMPUTER':
      return Rooms.computer(message.targetId);
    case 'EMPLOYEE':
      return Rooms.employee(message.targetId);
    case 'SECTOR':
      return Rooms.sector(message.targetId);
    case 'SHIFT':
      return Rooms.shift(message.targetId);
    default:
      return null;
  }
}

/**
 * IP de onde o aparelho se conectou. Atrás de um proxy confiável (TRUST_PROXY)
 * vale o primeiro endereço do X-Forwarded-For; sem proxy, o da própria conexão.
 */
/**
 * IP do aparelho. Atrás do nginx (acesso pelo domínio), a conexão chega do IP do
 * proxy; o do aparelho vem no X-Forwarded-For / X-Real-IP que o proxy acrescenta.
 *
 * Só olha esses cabeçalhos quando TRUST_PROXY manda: "true" confia em qualquer
 * origem; uma lista ("192.168.20.10") só quando a conexão veio de um desses IPs.
 * Com lista, vale o último endereço da cadeia que não é proxy: o aparelho não
 * consegue se passar por outro escrevendo um X-Forwarded-For falso.
 */
export function ipDoAparelho(
  handshake: { address: string; headers: Record<string, string | string[] | undefined> },
  confiar: boolean | string = env.trustProxy,
): string | null {
  const direto = limparIp(handshake.address);
  if (!confiar) return direto;
  const proxies =
    typeof confiar === 'string' ? confiar.split(',').map((ip) => limparIp(ip)).filter((ip): ip is string => ip !== null) : [];
  if (typeof confiar === 'string' && (!direto || !proxies.includes(direto))) return direto;

  const cabecalho = (nome: string) => {
    const valor = handshake.headers[nome];
    return (Array.isArray(valor) ? valor.join(',') : valor) ?? '';
  };
  const cadeia = cabecalho('x-forwarded-for')
    .split(',')
    .map((ip) => limparIp(ip))
    .filter((ip): ip is string => ip !== null);
  if (cadeia.length > 0) {
    if (confiar === true) return cadeia[0];
    for (let i = cadeia.length - 1; i >= 0; i -= 1) if (!proxies.includes(cadeia[i])) return cadeia[i];
  }
  return limparIp(cabecalho('x-real-ip')) ?? direto;
}

export interface RealtimeGateway
  extends MessageNotifier,
    LimpezaNotifier,
    MuralNotifier,
    AtualizacaoNotifier,
    LembreteNotifier,
    ChamadoNotifier,
    ConversaNotifier {
  /** Derruba as conexões de um PC (ex.: credencial liberada pelo DP) */
  disconnectComputer(computerId: string): void;
}

/** Avisa os PCs conectados de que o mural mudou. */
export interface MuralNotifier {
  muralAtualizado(): void;
}

/** Lembra quem ainda não leu um comunicado (o alerta volta à tela). */
export interface LembreteNotifier {
  lembrarComunicado(employeeIds: string[], messageId: string): number;
}

/** Avisa os PCs conectados de que saiu uma versão nova. */
export interface AtualizacaoNotifier {
  atualizacaoPublicada(app: string, versao: string): void;
}

/** Avisa todos os aparelhos de que o TI apagou dados (a tela não pode continuar mostrando). */
export interface LimpezaNotifier {
  dadosLimpos(o: 'comunicados' | 'conversas'): void;
}

/** Avisa quem abriu o chamado de que houve resposta ou mudança de status. */
export interface ChamadoNotifier {
  chamadoAtualizado(solicitanteId: string, chamadoId: string): void;
}

/**
 * Resumo da mensagem nova, mandado junto com o aviso para o aplicativo poder
 * mostrar o alerta na tela sem precisar consultar a conversa.
 */
export interface AvisoDeMensagem {
  mensagemId: number;
  autorId: string;
  autorNome: string;
  /** Texto curto: o conteúdo, ou a descrição do arquivo enviado */
  resumo: string;
  createdAt: string;
  /** Nome do grupo, ou null em conversa direta */
  grupo: string | null;
}

/** Avisa os participantes de uma conversa de que ela mudou. */
export interface ConversaNotifier {
  conversaAtualizada(userIds: string[], conversaId: string, mensagem?: AvisoDeMensagem): void;
}

export function createSocketServer(
  app: FastifyInstance,
  deps: { computers: ComputerService; auth: AuthService; employees: EmployeeService },
): RealtimeGateway {
  const io: RealtimeServer = new Server(app.server, {
    transports: ['websocket'], // sem long-polling
    serveClient: false,
    pingInterval: 15_000,
    pingTimeout: 10_000,
    maxHttpBufferSize: 16 * 1024,
  });

  // Valida o handshake antes de aceitar a conexão: dados do PC + token do próprio PC
  io.use(async (socket, next) => {
    const handshake = socket.handshake.auth as Record<string, unknown> | undefined;
    const info = parseComputerInfo(handshake);
    if (!info) {
      app.log.warn(`Conexão WebSocket recusada: handshake inválido (${socket.handshake.address})`);
      next(new Error('INVALID_HANDSHAKE'));
      return;
    }

    const token = typeof handshake?.token === 'string' && handshake.token.length <= 200 ? handshake.token : null;
    const principal = token ? await deps.auth.authenticate(token).catch(() => null) : null;
    if (principal?.type !== 'COMPUTER' || principal.computerId !== info.computerId) {
      app.log.warn(`Conexão WebSocket recusada: token inválido para ${info.computerId} (${socket.handshake.address})`);
      next(new Error('UNAUTHORIZED'));
      return;
    }

    socket.data.computer = info;
    next();
  });

  // PCs que já conectaram desde que o backend subiu (para diferenciar conexão de reconexão no log)
  const seenComputers = new Set<string>();

  io.on('connection', async (socket) => {
    const { computer } = socket.data;
    const room = Rooms.computer(computer.computerId);

    try {
      await socket.join([Rooms.all, room]);
      await deps.computers.markOnline(computer, ipDoAparelho(socket.handshake));
      const employee = await deps.employees.getSessionEmployee(computer.computerId);
      if (employee) await socket.join(employeeRooms(employee));

      const reconnected = seenComputers.has(computer.computerId);
      seenComputers.add(computer.computerId);
      app.log.info(
        `PC ${reconnected ? 'reconectado' : 'conectado'}: ${computer.computerId} (${computer.hostname}, v${computer.appVersion})` +
          (employee ? ` — funcionário ${employee.name}` : ''),
      );
      socket.emit('session:ready', { computerId: computer.computerId, serverTime: new Date().toISOString() });
    } catch (err) {
      app.log.error({ err }, `Falha ao registrar conexão do PC ${computer.computerId}`);
      socket.disconnect(true);
      return;
    }

    socket.on('disconnect', async (reason) => {
      try {
        const remaining = await io.in(room).fetchSockets();
        if (remaining.length === 0) await deps.computers.markOffline(computer.computerId);
        app.log.info(`PC desconectado: ${computer.computerId} (${reason})`);
      } catch (err) {
        app.log.error({ err }, `Falha ao registrar desconexão do PC ${computer.computerId}`);
      }
    });
  });

  // Funcionário entrou/saiu (ou mudou de setor/turno): troca as salas dos sockets daquele PC e avisa o app
  deps.employees.on('sessionChanged', (computerId, employee) => {
    io.to(Rooms.computer(computerId)).emit('session:changed', { employee });
    void (async () => {
      const sockets = await io.in(Rooms.computer(computerId)).fetchSockets();
      for (const socket of sockets) {
        for (const joined of socket.rooms) {
          if (EMPLOYEE_ROOM_PREFIXES.some((prefix) => joined.startsWith(prefix))) socket.leave(joined);
        }
        if (employee) socket.join(employeeRooms(employee));
      }
    })().catch((err) => app.log.error({ err }, `Falha ao atualizar salas do PC ${computerId}`));
  });

  // Derruba os sockets antes do Fastify fechar o servidor HTTP
  app.addHook('preClose', async () => {
    io.disconnectSockets(true);
  });

  /** Quantos sockets estão na sala (sem montar a lista de sockets, que pesa com centenas de PCs) */
  const roomSize = (room: string): number => io.of('/').adapter.rooms.get(room)?.size ?? 0;

  return {
    disconnectComputer(computerId: string): void {
      io.in(Rooms.computer(computerId)).disconnectSockets(true);
    },
    /**
     * Mural trocado pelo DP: todos os PCs conectados buscam o novo recado.
     * Vai só o aviso, sem o conteúdo: assim o app usa a mesma rota de sempre
     * e não existe uma segunda versão do recado circulando.
     */
    lembrarComunicado(employeeIds: string[], messageId: string): number {
      for (const employeeId of employeeIds) {
        io.to(Rooms.employee(employeeId)).emit('comunicado:lembrete', { messageId });
      }
      return employeeIds.length;
    },

    atualizacaoPublicada(aplicativo: string, versao: string): void {
      io.to(Rooms.all).emit('atualizacao:publicada', { app: aplicativo, versao });
    },

    dadosLimpos(o: 'comunicados' | 'conversas'): void {
      io.to(Rooms.all).emit('dados:limpos', { o });
    },

    muralAtualizado(): void {
      io.to(Rooms.all).emit('mural:atualizado');
    },
    /**
     * Chamado mexido pelo TI: vai para a sala de quem abriu, onde quer que ele
     * esteja logado. Quem está na Central não usa socket; lá a tela recarrega.
     */
    chamadoAtualizado(solicitanteId: string, chamadoId: string): void {
      io.to(Rooms.employee(solicitanteId)).emit('chamado:atualizado', { chamadoId });
    },
    /**
     * Conversa mexida: vai para a sala de cada participante, onde quer que ele
     * esteja logado. Só o aviso; o conteúdo o aplicativo busca pela API.
     */
    conversaAtualizada(userIds: string[], conversaId: string, mensagem?: AvisoDeMensagem): void {
      for (const userId of userIds) {
        io.to(Rooms.employee(userId)).emit('conversa:atualizada', { conversaId, mensagem: mensagem ?? null });
      }
    },
    /** Envia a mensagem aos PCs destinatários conectados. Retorna quantos sockets receberam. */
    async publish(message: Message): Promise<number> {
      const room = roomFor(message);
      if (!room) return 0;
      io.to(room).emit('message:new', { ...message, read: false, readAt: null, cienteEm: null });
      return roomSize(room);
    },
  };
}
