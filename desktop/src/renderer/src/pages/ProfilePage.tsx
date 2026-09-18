import { useState, type FormEvent } from 'react';
import type { AppState, OperationResult } from '../../../shared/types';

interface ProfilePageProps {
  state: AppState;
  onRequestLogin(): void;
}

function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<OperationResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setResult({ ok: false, message: 'A nova senha precisa ter pelo menos 8 caracteres.' });
    if (next !== confirm) return setResult({ ok: false, message: 'A confirmação não confere com a nova senha.' });
    setBusy(true);
    setResult(null);
    try {
      const saved = await window.dp.changePassword(current, next);
      setResult(saved);
      if (saved.ok) {
        setCurrent('');
        setNext('');
        setConfirm('');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form" onSubmit={handleSubmit}>
      <h2>Alterar senha</h2>
      <div className="form-grid">
        <label className="field">
          <span>Senha atual</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" maxLength={128} />
        </label>
        <label className="field">
          <span>Nova senha</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" maxLength={128} />
          <small>Mínimo de 8 caracteres.</small>
        </label>
        <label className="field">
          <span>Confirmar nova senha</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={128} />
        </label>
      </div>
      {result && <p className={`feedback ${result.ok ? 'feedback--ok' : 'feedback--error'}`}>{result.message}</p>}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !current || !next || !confirm}>
          Alterar senha
        </button>
      </div>
    </form>
  );
}

export function ProfilePage({ state, onRequestLogin }: ProfilePageProps) {
  const { computer, employee } = state;
  const [logoutResult, setLogoutResult] = useState<OperationResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      const result = await window.dp.employeeLogout();
      if (!result.ok) setLogoutResult(result);
    } finally {
      setBusy(false);
    }
  }

  const computerRows: [string, string][] = [
    ['Identificador do computador', computer.computerId],
    ['Nome do computador', computer.hostname],
    ['Sistema operacional', computer.platform === 'win32' ? 'Windows' : computer.platform],
    ['Versão do aplicativo', computer.appVersion],
    ['Servidor', state.connection.serverUrl ?? 'Não configurado'],
  ];

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Meu perfil</h1>
          <p className="page__subtitle">Sua identificação e os dados desta instalação do Comunicação DP.</p>
        </div>
      </header>

      {employee ? (
        <>
          <section className="panel">
            <div className="panel__header">
              <h2>Funcionário</h2>
              <button className="btn btn--ghost" onClick={() => void handleLogout()} disabled={busy}>
                Sair (trocar de funcionário)
              </button>
            </div>
            <dl className="info-list">
              {(
                [
                  ['Nome', employee.name],
                  ['Matrícula', employee.registration],
                  ['Setor', employee.sector ?? '—'],
                  ['Turno', employee.shift ?? '—'],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="info-list__row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {logoutResult && <p className="feedback feedback--error">{logoutResult.message}</p>}
          </section>
          <ChangePasswordForm />
        </>
      ) : (
        <section className="panel panel--muted">
          <h2>Funcionário</h2>
          <p>
            Você está usando o aplicativo sem identificação: este computador recebe os comunicados gerais. Entre com sua
            matrícula para receber também as mensagens enviadas para você, seu setor ou seu turno.
          </p>
          <div className="form__actions form__actions--start">
            <button className="btn btn--primary" onClick={onRequestLogin}>
              Entrar com minha matrícula
            </button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Este computador</h2>
        <dl className="info-list">
          {computerRows.map(([label, value]) => (
            <div key={label} className="info-list__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
