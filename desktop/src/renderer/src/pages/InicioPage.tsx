import { useEffect, useState } from 'react';
import type { Atalho, ConversaResumo, EmployeeProfile, MessagesState, MuralPost } from '../../../shared/types';
import { GradeAtalhos } from '../components/GradeAtalhos';
import { HistoricoConversas } from '../components/HistoricoConversas';
import type { Page } from '../components/MenuLateral';
import { Mural } from '../components/Mural';

interface InicioPageProps {
  employee: EmployeeProfile | null;
  messages: MessagesState;
  /** Conversas do chat (as mais recentes aparecem abaixo do mural) */
  conversas: ConversaResumo[];
  /** Mensagens não lidas somando todas as conversas */
  naoLidasChat: number;
  mural: MuralPost | null;
  atalhos: Atalho[];
  onNavegar(page: Page): void;
  onAbrirConversa(): void;
  onEntrar(): void;
}

function saudacao(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function InicioPage({
  employee,
  messages,
  conversas,
  naoLidasChat,
  mural,
  atalhos,
  onNavegar,
  onAbrirConversa,
  onEntrar,
}: InicioPageProps) {
  const [aviso, setAviso] = useState<string | null>(null);

  // O aviso some sozinho
  useEffect(() => {
    if (!aviso) return;
    const timer = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(timer);
  }, [aviso]);

  const primeiroNome = employee?.name.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="inicio">
      <header className="inicio__cabecalho">
        <h1>
          {saudacao()}
          {primeiroNome ? `, ${primeiroNome}` : ''}
        </h1>
        <p>
          {messages.unreadCount > 0
            ? `${messages.unreadCount} ${messages.unreadCount === 1 ? 'comunicado não lido' : 'comunicados não lidos'}`
            : 'Nenhum comunicado pendente de leitura'}
          {naoLidasChat > 0 && ` · ${naoLidasChat} ${naoLidasChat === 1 ? 'mensagem nova' : 'mensagens novas'}`}
        </p>
      </header>

      <GradeAtalhos
        atalhos={atalhos}
        podeEditar={Boolean(employee)}
        badges={{ COMUNICADOS: messages.unreadCount, CHAT: naoLidasChat }}
        onAbrir={onNavegar}
        onAviso={setAviso}
      />

      {aviso && (
        <p className="aviso-em-breve" role="status">
          {aviso}
        </p>
      )}

      <Mural post={mural} />

      <HistoricoConversas
        conversas={conversas}
        meuId={employee?.id ?? null}
        disponivel={Boolean(employee)}
        onAbrir={onAbrirConversa}
        onEntrar={onEntrar}
      />
    </div>
  );
}
