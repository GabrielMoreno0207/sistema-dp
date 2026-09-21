import { useEffect, useRef, useState } from 'react';
import type { AdminUser, ConnectionState, EmployeeProfile, MidiaPublica } from '../../../shared/types';
import { ConnectionBadge } from './ConnectionBadge';

interface BarraSuperiorProps {
  employee: EmployeeProfile | null;
  /** Foto de perfil, quando a pessoa enviou uma */
  foto: MidiaPublica | null;
  /** Conta do DP/TI logada neste aplicativo */
  admin: AdminUser | null;
  connection: ConnectionState;
  onAbrirPerfil(): void;
  onAbrirConfiguracoes(): void;
  onEntrar(): void;
  onEntrarComoDp(): void;
  onSairDoDp(): void;
}

/** Iniciais do nome para o avatar (Maria Souza -> MS) */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

export function BarraSuperior({
  employee,
  foto,
  admin,
  connection,
  onAbrirPerfil,
  onAbrirConfiguracoes,
  onEntrar,
  onEntrarComoDp,
  onSairDoDp,
}: BarraSuperiorProps) {
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
        {admin && (
          <span className="barra-superior__admin" title={`Conectado como ${admin.name}`}>
            {admin.superAdmin ? 'TI' : 'DP'}: {admin.name}
          </span>
        )}
        <ConnectionBadge connection={connection} />

        <div className="menu-usuario" ref={caixa}>
          <button
            className="menu-usuario__gatilho"
            onClick={() => setMenuAberto((aberto) => !aberto)}
            aria-expanded={menuAberto}
            aria-haspopup="menu"
          >
            <span className="menu-usuario__avatar" aria-hidden>
              {foto ? <img src={`dpmidia://m/${foto.id}`} alt="" /> : employee ? iniciais(employee.name) : '👤'}
            </span>
            <span className="menu-usuario__nome">{employee?.name ?? 'Entrar'}</span>
            <span className="menu-usuario__seta" aria-hidden>
              ▾
            </span>
          </button>

          {menuAberto && !employee && (
            <div className="menu-usuario__lista" role="menu">
              <button role="menuitem" onClick={() => escolher(onEntrar)}>
                Entrar com a matrícula
              </button>
              {admin ? (
                <button role="menuitem" onClick={() => escolher(onSairDoDp)}>
                  Sair da conta do DP
                </button>
              ) : (
                <button role="menuitem" onClick={() => escolher(onEntrarComoDp)}>
                  Entrar como DP/TI
                </button>
              )}
            </div>
          )}

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
              {admin ? (
                <button role="menuitem" onClick={() => escolher(onSairDoDp)}>
                  Sair da conta do DP
                </button>
              ) : (
                <button role="menuitem" onClick={() => escolher(onEntrarComoDp)}>
                  Entrar como DP/TI
                </button>
              )}
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
