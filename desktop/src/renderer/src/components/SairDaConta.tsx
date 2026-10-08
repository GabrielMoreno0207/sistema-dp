import { useState, type FormEvent } from 'react';

/**
 * Caixa que aparece ao tentar sair da conta.
 *
 * Sair é tratado como fechar o sistema: o computador da fábrica precisa ficar
 * com alguém identificado para receber os comunicados do RH, então deslogar
 * pede a senha do TI — a mesma de encerrar o aplicativo.
 */
export function SairDaConta({ onCancelar }: { onCancelar(): void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [conferindo, setConferindo] = useState(false);

  async function sair(evento: FormEvent) {
    evento.preventDefault();
    if (!senha || conferindo) return;
    setConferindo(true);
    setErro('');
    const resultado = await window.dp.employeeLogout(senha);
    setConferindo(false);
    if (!resultado.ok) {
      setErro(resultado.message);
      setSenha('');
      return;
    }
    // Deu certo: a tela de login volta sozinha quando o estado do funcionário muda
    onCancelar();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <form className="modal__caixa modal__caixa--estreita" onSubmit={(e) => void sair(e)}>
        <h2 className="modal__titulo">Sair da conta</h2>

        <p className="fechar-sistema__texto">
          Este computador precisa ficar com alguém identificado para receber os comunicados do RH.
          Sair da conta só com a senha do TI.
        </p>

        <label className="field field--spaced">
          <span>Senha do TI</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha para sair"
            autoFocus
          />
        </label>

        {erro && <p className="feedback feedback--error">{erro}</p>}

        <div className="modal__rodape">
          <button type="button" className="btn" onClick={onCancelar}>
            Cancelar
          </button>
          <span className="modal__espaco" />
          <button type="submit" className="btn btn--perigo" disabled={!senha || conferindo}>
            {conferindo ? 'Conferindo...' : 'Sair'}
          </button>
        </div>
      </form>
    </div>
  );
}
