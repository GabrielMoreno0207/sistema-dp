import { useState, type FormEvent } from 'react';
import type { ConnectionState } from '../../../shared/types';

type Modo = 'FUNCIONARIO' | 'DP';

interface LoginScreenProps {
  connection: ConnectionState;
  onSkip(): void;
  /** Conta do DP/TI entrou: o aplicativo segue sem funcionário identificado */
  onAdminEntrou(): void;
  /** Entra sem identificação e abre a tela Configurações (servidor/chave) */
  onOpenSettings(): void;
}

/** Motivo real de não dar para entrar agora, conforme o status da conexão */
function connectionNotice(connection: ConnectionState): { text: string; showSettings: boolean } | null {
  switch (connection.status) {
    case 'connected':
      return null;
    case 'connecting':
    case 'reconnecting':
      return { text: 'Conectando ao servidor...', showSettings: false };
    case 'not-configured':
      return { text: 'O endereço do servidor não está configurado neste computador.', showSettings: true };
    case 'unauthorized':
      return {
        text: `Este computador não foi autorizado pelo servidor${connection.lastError ? ` (${connection.lastError})` : ''}. Confira o endereço do servidor em Configurações.`,
        showSettings: true,
      };
    default:
      return {
        text: 'Servidor indisponível no momento. Você pode continuar sem identificação e entrar depois em "Meu perfil".',
        showSettings: true,
      };
  }
}

/**
 * Entrada no aplicativo, nos dois tipos de conta:
 * - funcionário, com a matrícula e a senha cadastradas pelo DP (opcional: sem
 *   login o computador continua recebendo os comunicados gerais);
 * - Departamento Pessoal e TI, com o mesmo usuário e senha da Central, que
 *   liberam as seções administrativas.
 */
export function LoginScreen({ connection, onSkip, onAdminEntrou, onOpenSettings }: LoginScreenProps) {
  const [modo, setModo] = useState<Modo>('FUNCIONARIO');
  const [registration, setRegistration] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = connection.status === 'connected';
  const notice = connectionNotice(connection);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        modo === 'FUNCIONARIO'
          ? await window.dp.employeeLogin(registration.trim(), password)
          : await window.dp.adminLogin(registration.trim(), password);
      if (!result.ok) {
        setError(result.message);
        setPassword('');
        return;
      }
      // A conta do DP não é um funcionário do PC: o aplicativo entra sem
      // identificação de funcionário, já com as seções administrativas.
      if (modo === 'DP') onAdminEntrou();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-card__brand">
          <span className="sidebar__logo">DP</span>
          <div>
            <h1>Entrar no Comunicação DP</h1>
            <p>
              {modo === 'FUNCIONARIO'
                ? 'Use a matrícula e a senha fornecidas pelo Departamento Pessoal.'
                : 'Use o mesmo usuário e senha da Central do DP.'}
            </p>
          </div>
        </div>

        <div className="login-card__abas" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'FUNCIONARIO'}
            className={`login-aba ${modo === 'FUNCIONARIO' ? 'login-aba--ativa' : ''}`}
            onClick={() => {
              setModo('FUNCIONARIO');
              setError(null);
            }}
          >
            Sou funcionário
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modo === 'DP'}
            className={`login-aba ${modo === 'DP' ? 'login-aba--ativa' : ''}`}
            onClick={() => {
              setModo('DP');
              setError(null);
            }}
          >
            Sou do DP / TI
          </button>
        </div>

        {notice && (
          <div className="feedback feedback--warning login-card__notice">
            <span>{notice.text}</span>
            {notice.showSettings && (
              <button type="button" className="link-btn" onClick={onOpenSettings}>
                Abrir Configurações
              </button>
            )}
          </div>
        )}

        <label className="field">
          <span>{modo === 'FUNCIONARIO' ? 'Matrícula' : 'Usuário'}</span>
          <input
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
            maxLength={64}
            autoFocus
            autoComplete="username"
            inputMode={modo === 'FUNCIONARIO' ? 'numeric' : 'text'}
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={128}
            autoComplete="current-password"
          />
        </label>

        {error && <p className="feedback feedback--error">{error}</p>}

        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || !online || !registration.trim() || !password}
        >
          {busy ? 'Entrando...' : 'Entrar'}
        </button>

        <div className="login-card__skip">
          <button type="button" className="link-btn" onClick={onSkip}>
            Continuar sem identificação
          </button>
          <small>Você continua recebendo os comunicados gerais enviados a todos os computadores.</small>
        </div>
      </form>
    </div>
  );
}
