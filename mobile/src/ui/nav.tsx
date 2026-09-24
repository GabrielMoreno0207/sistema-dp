/**
 * Navegação do app: abas embaixo e telas empilhadas por cima (voltar desempilha).
 * Sem biblioteca: são poucas telas e o botão voltar do Android é tratado no App.
 */
import { createContext, useContext } from 'react';
import type { MensagemConversa, MidiaPublica, MuralPost } from '../core/types';

export type Tab = 'inicio' | 'comunicados' | 'mensagens' | 'mais';

/** Funcionário como a tela de cadastros recebe do servidor */
export interface FuncionarioAdmin {
  id: string;
  name: string;
  registration: string;
  sector: string | null;
  shift: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export type Route =
  // funcionário
  | { name: 'message'; id: string }
  | { name: 'conversa'; conversaId: string }
  | { name: 'novaConversa' }
  | { name: 'novoGrupo' }
  | { name: 'grupo'; conversaId: string }
  | { name: 'encaminhar'; mensagem: MensagemConversa }
  | { name: 'imagem'; midia: Pick<MidiaPublica, 'id' | 'nome' | 'mimeType'> }
  | { name: 'mural' }
  | { name: 'perfil' }
  | { name: 'foto' }
  | { name: 'password' }
  | { name: 'device' }
  | { name: 'server' }
  | { name: 'sobre' }
  // DP e TI
  | { name: 'adminComunicados' }
  | { name: 'adminNovoComunicado' }
  | { name: 'adminLeituras'; id: string; titulo: string }
  | { name: 'adminMural' }
  | { name: 'adminMuralEditar'; post: MuralPost | null }
  | { name: 'adminCadastros' }
  | { name: 'adminFuncionario'; funcionario: FuncionarioAdmin | null }
  | { name: 'adminAjustes' };

export interface Nav {
  push(route: Route): void;
  pop(): void;
  /** Troca a aba e limpa as telas empilhadas (opcionalmente abre uma) */
  goTab(tab: Tab, route?: Route): void;
}

export const NavContext = createContext<Nav>({
  push: () => {},
  pop: () => {},
  goTab: () => {},
});

export function useNav(): Nav {
  return useContext(NavContext);
}
