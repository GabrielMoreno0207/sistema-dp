import { useState, type FormEvent } from 'react';
import type { EmployeeProfile } from '../../../shared/types';

/**
 * Troca de senha obrigatória: aparece quando a senha é a inicial ou foi redefinida pelo DP.
 * Só some depois que o servidor confirma a nova senha (o perfil volta com mustChangePassword = false).
 */
export function ForcePasswordScreen({ employee }: { employee: EmployeeProfile }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next.length < 8) return setError('A nova senha precisa ter pelo menos 8 caracteres.');
    if (next !== confirm) return setError('A confirmação não confere com a nova senha.');
    if (next === current) return setError('A nova senha precisa ser diferente da senha atual.');
    setBusy(true);
    try {
      const result = await window.dp.changePassword(current, next);
      if (!result.ok) setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      const result = await window.dp.employeeLogout();
      if (!result.ok) setError(result.message);
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
            <h1>Defina sua nova senha</h1>
            <p>
              Olá, {employee.name}! Por segurança, troque a senha fornecida pelo Departamento Pessoal antes de
              continuar.
            </p>
          </div>
        </div>

        <label className="field">
          <span>Senha atual (a que você recebeu)</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={128} autoFocus autoComplete="current-password" />
        </label>
        <label className="field">
          <span>Nova senha</span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={128} autoComplete="new-password" />
          <small>Mínimo de 8 caracteres.</small>
        </label>
        <label className="field">
          <span>Confirmar nova senha</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} autoComplete="new-password" />
        </label>

        {error && <p className="feedback feedback--error">{error}</p>}

        <button type="submit" className="btn btn--primary btn--block" disabled={busy || !current || !next || !confirm}>
          {busy ? 'Salvando...' : 'Salvar nova senha'}
        </button>

        <div className="login-card__skip">
          <button type="button" className="link-btn" onClick={() => void handleLogout()} disabled={busy}>
            Sair (não sou {employee.name.split(' ')[0]})
          </button>
        </div>
      </form>
    </div>
  );
}
