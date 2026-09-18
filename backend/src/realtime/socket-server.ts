import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { AuthService } from '../modules/auth/auth.service';
import type { ChatNotifier } from '../modules/chat/chat.service';
import type { ChatMessage } from '../modules/chat/chat.types';
import type { ComputerService } from '../modules/computers/computer.service';
import { parseComputerInfo, type ComputerInfo } from '../modules/computers/computer.types';
import type { EmployeeService } from '../modules/employees/employee.service';
import type { MessageNotifier } from '../modules/messages/message.service';
import type { Message, RecipientMessage } from '../modules/messages/message.types';
import type { EmployeeProfile } from '../modules/users/user.types';

export interface ServerToClientEvents {
  'session:ready': (payload: { computerId: string; serverTime: string }) => void;
  'message:new': (message: RecipientMessage) => void;
  /** A sessão do funcionário neste PC mudou por ação do servidor (expirou, desativado, senha redefinida...) */
  'session:changed': (payload: { employee: EmployeeProfile | null }) => void;
  /** Mensagem do chat (do DP ou do próprio funcionário, enviada de outro PC) */
  'chat:message': (message: ChatMessage) => void;
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

export interface RealtimeGateway extends MessageNotifier, ChatNotifier {
  /** Derruba as conexões de um PC (ex.: credencial liberada pelo DP) */
  disconnectComputer(computerId: string): void;
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
      await deps.computers.markOnline(computer);
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
    /** Chat: entrega na sala do funcionário (onde ele estiver logado). Retorna quantos PCs receberam. */
    async chatMessage(message: ChatMessage): Promise<number> {
      const room = Rooms.employee(message.employeeId);
      io.to(room).emit('chat:message', message);
      return roomSize(room);
    },
    /** Envia a mensagem aos PCs destinatários conectados. Retorna quantos sockets receberam. */
    async publish(message: Message): Promise<number> {
      const room = roomFor(message);
      if (!room) return 0;
      io.to(room).emit('message:new', { ...message, read: false, readAt: null });
      return roomSize(room);
    },
  };
}
