import { useState, type FormEvent } from 'react';
import type { ConnectionState } from '../../../shared/types';
import { ControlesJanela } from './ControlesJanela';
import fotoDaEntrada from '../imagens/entrada.jpg';
import icone from '../imagens/icone.png';

interface LoginScreenProps {
  connection: ConnectionState;
  onSkip(): void;
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
 * Entrada no aplicativo: usuário e senha cadastrados pelo DP. O login é
 * opcional — sem ele o computador continua recebendo os comunicados gerais.
 *
 * Quem é do Departamento Pessoal ou do TI entra por aqui também: o acesso às
 * telas de administração vem do setor da pessoa. A conta da Central ainda pode
 * ser aberta depois, pelo botão do canto superior direito.
 */
export function LoginScreen({ connection, onSkip, onOpenSettings }: LoginScreenProps) {
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
      const result = await window.dp.employeeLogin(registration.trim(), password);
      if (!result.ok) {
        setError(result.message);
        setPassword('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-screen__foto">
        <img src={fotoDaEntrada} alt="" />
        <div className="login-screen__marca-foto">
          <span className="sidebar__logo">
            <img src={icone} alt="" />
          </span>
          <strong>Comunica Trinys</strong>
        </div>
      </div>

      <div className="login-screen__lado">
        <div className="login-screen__barra">
          <ControlesJanela onFechar={() => window.dp.janelaEsconder()} />
        </div>

        <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-card__brand">
          <div>
            <h1>Entrar no Comunica Trinys</h1>
            <p>Use o usuário e a senha fornecidos pelo RH.</p>
          </div>
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
          <span>Usuário</span>
          <input
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
            maxLength={64}
            autoFocus
            autoComplete="username"
            inputMode="numeric"
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
    </div>
  );
}
