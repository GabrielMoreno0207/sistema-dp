import { useEffect, useState } from 'react';
import type { ChatState, DpMessage, EmployeeProfile, MessagesState } from '../../../shared/types';
import { CartaoDestaque } from '../components/CartaoDestaque';
import { GradeModulos } from '../components/GradeModulos';
import type { Page } from '../components/MenuLateral';

interface InicioPageProps {
  employee: EmployeeProfile | null;
  messages: MessagesState;
  chat: ChatState;
  onAbrirMensagem(message: DpMessage): void;
  onNavegar(page: Page): void;
}

function saudacao(): string {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function InicioPage({ employee, messages, chat, onAbrirMensagem, onNavegar }: InicioPageProps) {
  const [emBreve, setEmBreve] = useState<string | null>(null);

  // O aviso de "em breve" some sozinho
  useEffect(() => {
    if (!emBreve) return;
    const timer = setTimeout(() => setEmBreve(null), 4000);
    return () => clearTimeout(timer);
  }, [emBreve]);

  // O destaque é o comunicado urgente não lido mais recente; sem urgente, o mais recente
  const destaque =
    messages.messages.find((m) => m.type === 'URGENTE' && !m.read) ?? messages.messages[0] ?? null;

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
          {chat.unreadCount > 0 && ` · ${chat.unreadCount} do chat com o DP`}
        </p>
      </header>

      <GradeModulos
        badges={{ comunicados: messages.unreadCount, chamados: chat.unreadCount }}
        onAbrir={onNavegar}
        onIndisponivel={setEmBreve}
      />

      {emBreve && (
        <p className="aviso-em-breve" role="status">
          <strong>{emBreve}</strong> ainda não está disponível neste aplicativo.
        </p>
      )}

      <CartaoDestaque message={destaque} onAbrir={onAbrirMensagem} />
    </div>
  );
}
