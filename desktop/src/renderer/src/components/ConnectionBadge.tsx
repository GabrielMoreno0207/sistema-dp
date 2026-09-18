import { useEffect, useState } from 'react';
import type { ConnectionState } from '../../../shared/types';

const LABELS: Record<ConnectionState['status'], string> = {
  connecting: 'Conectando...',
  connected: 'Conectado ao servidor',
  reconnecting: 'Reconectando...',
  disconnected: 'Servidor indisponível',
  'not-configured': 'Servidor não configurado',
  unauthorized: 'Registro não autorizado',
};

function useSecondsUntil(timestamp: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!timestamp) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [timestamp]);
  return timestamp ? Math.max(0, Math.ceil((timestamp - now) / 1000)) : null;
}

export function ConnectionBadge({ connection }: { connection: ConnectionState }) {
  const seconds = useSecondsUntil(connection.status === 'disconnected' ? connection.nextRetryAt : null);

  return (
    <div className={`connection connection--${connection.status}`} title={connection.lastError ?? undefined}>
      <span className="connection__dot" />
      <span className="connection__text">
        {LABELS[connection.status]}
        {connection.status === 'unauthorized' && connection.lastError && <small>{connection.lastError}</small>}
        {seconds !== null && <small>Nova tentativa em {seconds}s</small>}
      </span>
    </div>
  );
}
