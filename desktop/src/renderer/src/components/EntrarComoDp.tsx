import { useState } from 'react';

interface EntrarComoDpProps {
  onFechar(): void;
}

/**
 * Entrada da conta do DP/TI dentro do aplicativo. É uma credencial diferente da
 * do funcionário: o funcionário entra com matrícula, o DP com usuário e senha
 * da Central.
 */
export function EntrarComoDp({ onFechar }: EntrarComoDpProps) {
  const [username, setUsername] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function entrar() {
    if (!username.trim() || !senha) return;
    setEntrando(true);
    setErro('');
    const resultado = await window.dp.adminLogin(username.trim(), senha);
    setEntrando(false);
    if (!resultado.ok) {
      setErro(resultado.message);
      return;
    }
    setSenha('');
    onFechar();
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onFechar}>
      <div className="modal__caixa modal__caixa--estreita" onClick={(evento) => evento.stopPropagation()}>
        <h2 className="modal__titulo">Entrar como Departamento Pessoal</h2>
        <p className="page__subtitle">
          Use o mesmo usuário e senha da Central. As funções administrativas ficam disponíveis enquanto você estiver
          conectado neste computador.
        </p>

        <label htmlFor="dp-usuario">Usuário</label>
        <input
          id="dp-usuario"
          value={username}
          autoFocus
          autoComplete="off"
          onChange={(evento) => setUsername(evento.target.value)}
          onKeyDown={(evento) => evento.key === 'Enter' && void entrar()}
        />

        <label htmlFor="dp-senha">Senha</label>
        <input
          id="dp-senha"
          type="password"
          value={senha}
          autoComplete="off"
          onChange={(evento) => setSenha(evento.target.value)}
          onKeyDown={(evento) => evento.key === 'Enter' && void entrar()}
        />

        {erro && <p className="erro-login">{erro}</p>}

        <footer className="modal__rodape">
          <span className="modal__espaco" />
          <button className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button
            className="botao botao--primario"
            onClick={() => void entrar()}
            disabled={entrando || !username.trim() || !senha}
          >
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
