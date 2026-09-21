import { useEffect, useRef, useState } from 'react';
import type { ConnectionState, EmployeeProfile } from '../../../shared/types';
import { ConnectionBadge } from './ConnectionBadge';

interface BarraSuperiorProps {
  employee: EmployeeProfile | null;
  connection: ConnectionState;
  onAbrirPerfil(): void;
  onAbrirConfiguracoes(): void;
  onEntrar(): void;
}

/** Iniciais do nome para o avatar (Maria Souza -> MS) */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

export function BarraSuperior({ employee, connection, onAbrirPerfil, onAbrirConfiguracoes, onEntrar }: BarraSuperiorProps) {
  const [menuAberto, setMenuAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  // Clicar fora ou apertar Esc fecha o menu
  useEffect(() => {
    if (!menuAberto) return;
    function aoClicar(evento: MouseEvent) {
      if (!caixa.current?.contains(evento.target as Node)) setMenuAberto(false);
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setMenuAberto(false);
    }
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [menuAberto]);

  function escolher(acao: () => void) {
    setMenuAberto(false);
    acao();
  }

  return (
    <header className="barra-superior">
      <div className="barra-superior__marca">
        <span className="barra-superior__logo">DP</span>
        <span className="barra-superior__sistema">Comunicação DP</span>
      </div>

      <div className="barra-superior__direita">
        <ConnectionBadge connection={connection} />

        <div className="menu-usuario" ref={caixa}>
          <button
            className="menu-usuario__gatilho"
            onClick={() => (employee ? setMenuAberto((aberto) => !aberto) : onEntrar())}
            aria-expanded={menuAberto}
            aria-haspopup="menu"
          >
            <span className="menu-usuario__avatar" aria-hidden>
              {employee ? iniciais(employee.name) : '👤'}
            </span>
            <span className="menu-usuario__nome">{employee?.name ?? 'Entrar'}</span>
            <span className="menu-usuario__seta" aria-hidden>
              ▾
            </span>
          </button>

          {menuAberto && employee && (
            <div className="menu-usuario__lista" role="menu">
              <button role="menuitem" onClick={() => escolher(onAbrirPerfil)}>
                Meu perfil
              </button>
              <button role="menuitem" onClick={() => escolher(onAbrirPerfil)}>
                Trocar senha
              </button>
              <button role="menuitem" onClick={() => escolher(onAbrirConfiguracoes)}>
                Configurações
              </button>
              <button role="menuitem" className="menu-usuario__sair" onClick={() => escolher(() => void window.dp.employeeLogout())}>
                Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
