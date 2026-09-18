import { useEffect, useState, type FormEvent } from 'react';
import type { OperationResult, SettingsView } from '../../../shared/types';
import { playAlertSound } from '../lib/sound';

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [result, setResult] = useState<OperationResult | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    void window.dp.getSettings().then((loaded) => {
      setSettings(loaded);
      setServerUrl(loaded.serverUrl ?? '');
      setAutoStart(loaded.autoStart);
    });
  }

  useEffect(load, []);

  async function run(action: () => Promise<OperationResult>) {
    setBusy(true);
    setResult(null);
    try {
      setResult(await action());
    } finally {
      setBusy(false);
    }
  }

  function handleSave(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const saved = await window.dp.saveSettings({
        serverUrl: serverUrl.trim() || null,
        autoStart,
      });
      if (saved.ok) load();
      return saved;
    });
  }

  if (!settings) return null;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Configurações</h1>
          <p className="page__subtitle">Conexão com o servidor e comportamento do aplicativo.</p>
        </div>
      </header>

      <form className="panel form" onSubmit={handleSave}>
        <h2>Servidor</h2>
        <label className="field">
          <span>Endereço do servidor</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://192.168.1.50:3000"
            spellCheck={false}
          />
          <small>Informado pela TI. Exemplo: http://192.168.1.50:3000</small>
        </label>

        <h2>Inicialização</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={autoStart}
            disabled={!settings.autoStartAvailable}
            onChange={(e) => setAutoStart(e.target.checked)}
          />
          <span>
            Iniciar automaticamente com o Windows (em segundo plano)
            {!settings.autoStartAvailable && <small> — disponível apenas no aplicativo instalado</small>}
          </span>
        </label>

        {result && <p className={`feedback ${result.ok ? 'feedback--ok' : 'feedback--error'}`}>{result.message}</p>}

        <div className="form__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !serverUrl.trim()}
            onClick={() => void run(() => window.dp.testServer(serverUrl.trim()))}
          >
            Testar conexão
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Salvar
          </button>
        </div>
      </form>

      <section className="panel">
        <h2>Som do alerta</h2>
        <p className="page__subtitle">Confira se o som das novas mensagens está audível neste computador.</p>
        <div className="form__actions form__actions--start">
          <button className="btn btn--ghost" onClick={() => playAlertSound(false)}>
            🔔 Testar som normal
          </button>
          <button className="btn btn--ghost" onClick={() => playAlertSound(true)}>
            🚨 Testar som urgente
          </button>
        </div>
      </section>
    </div>
  );
}
