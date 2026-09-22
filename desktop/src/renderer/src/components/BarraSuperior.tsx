import { useEffect, useRef, useState } from 'react';
import { aplicarTema, temaGuardado, type Tema } from '../lib/tema';
import type { AdminUser, ConnectionState, EmployeeProfile, MidiaPublica } from '../../../shared/types';
import { ConnectionBadge } from './ConnectionBadge';
import { Icone } from '../lib/icones';
import { ControlesJanela } from './ControlesJanela';

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
  /** X da barra: abre a caixa que pede a senha para encerrar */
  onFecharSistema(): void;
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
  onFecharSistema,
}: BarraSuperiorProps) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [tema, setTema] = useState<Tema>(temaGuardado);
  const caixa = useRef<HTMLDivElement>(null);

  // O tema escolhido vale desde a abertura da janela
  useEffect(() => {
    aplicarTema(tema);
  }, [tema]);

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
        <span className="barra-superior__sistema">Comunica Trinys</span>
      </div>

      <div className="barra-superior__direita">
        <button
          className="barra-superior__tema"
          onClick={() => setTema(tema === 'claro' ? 'escuro' : 'claro')}
          title={tema === 'claro' ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'}
          aria-label={tema === 'claro' ? 'Mudar para o tema escuro' : 'Mudar para o tema claro'}
        >
          {tema === 'claro' ? <Icone nome="escuro" /> : <Icone nome="claro" />}
        </button>
        <ConnectionBadge connection={connection} />

        <div className="menu-usuario" ref={caixa}>
          <button
            className="menu-usuario__gatilho"
            onClick={() => setMenuAberto((aberto) => !aberto)}
            aria-expanded={menuAberto}
            aria-haspopup="menu"
          >
            <span className="menu-usuario__avatar" aria-hidden>
              {admin ? (
                iniciais(admin.name)
              ) : foto ? (
                <img src={`dpmidia://m/${foto.id}`} alt="" />
              ) : employee ? (
                iniciais(employee.name)
              ) : (
                <Icone nome="perfil" />
              )}
            </span>
            <span className="menu-usuario__nome">
              {admin ? admin.name : (employee?.name ?? 'Entrar')}
              {admin && <span className="menu-usuario__papel">{admin.superAdmin ? 'TI' : 'DP'}</span>}
            </span>
            <span className="menu-usuario__seta">
              <Icone nome="seta" tamanho={14} />
            </span>
          </button>

          {menuAberto && admin && (
            <div className="menu-usuario__lista" role="menu">
              <button role="menuitem" onClick={() => escolher(onAbrirConfiguracoes)}>
                Configurações
              </button>
              <button role="menuitem" className="menu-usuario__sair" onClick={() => escolher(onSairDoDp)}>
                Sair da conta {admin.superAdmin ? 'do TI' : 'do DP'}
              </button>
            </div>
          )}

          {menuAberto && !admin && !employee && (
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

          {menuAberto && !admin && employee && (
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

        <ControlesJanela onFechar={onFecharSistema} />
      </div>
    </header>
  );
}
