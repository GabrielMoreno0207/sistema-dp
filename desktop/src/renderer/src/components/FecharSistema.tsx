import { useState, type FormEvent } from 'react';
import { Icone } from '../lib/icones';

/**
 * Caixa que aparece ao tentar fechar o sistema.
 *
 * O aplicativo precisa ficar aberto para receber os comunicados, então quem só
 * quer tirá-lo da frente usa "Minimizar"; encerrar de vez pede a senha do TI.
 */
export function FecharSistema({ onCancelar }: { onCancelar(): void }) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [conferindo, setConferindo] = useState(false);

  async function fechar(evento: FormEvent) {
    evento.preventDefault();
    if (!senha || conferindo) return;
    setConferindo(true);
    setErro('');
    const resultado = await window.dp.janelaFechar(senha);
    setConferindo(false);
    if (!resultado.ok) {
      setErro(resultado.message);
      setSenha('');
      return;
    }
    // Deu certo: o processo principal encerra o aplicativo em seguida
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <form className="modal__caixa modal__caixa--estreita" onSubmit={(e) => void fechar(e)}>
        <h2 className="modal__titulo">Fechar o sistema</h2>

        <p className="fechar-sistema__texto">
          O Comunica Trinys precisa ficar aberto para receber os comunicados do RH. Para tirá-lo da
          frente, use <strong>Minimizar</strong> — ele continua na bandeja, ao lado do relógio.
        </p>
        <p className="fechar-sistema__texto">Encerrar de vez só com a senha do TI.</p>

        <label className="field field--spaced">
          <span>Senha do TI</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha para encerrar"
            autoFocus
          />
        </label>

        {erro && <p className="feedback feedback--error">{erro}</p>}

        <div className="modal__rodape">
          <button type="button" className="btn" onClick={onCancelar}>
            Cancelar
          </button>
          <span className="modal__espaco" />
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              window.dp.janelaEsconder();
              onCancelar();
            }}
          >
            <Icone nome="minimizar" /> Minimizar
          </button>
          <button type="submit" className="btn btn--perigo" disabled={!senha || conferindo}>
            {conferindo ? 'Conferindo...' : 'Encerrar'}
          </button>
        </div>
      </form>
    </div>
  );
}
