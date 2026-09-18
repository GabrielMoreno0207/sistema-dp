import { useEffect, useState } from 'react';
import type { AppState } from '../../../shared/types';

/** Estado do aplicativo vindo do processo main, atualizado em tempo real. */
export function useDesktopState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);

  useEffect(() => {
    let active = true;
    void window.dp.getState().then((initial) => {
      if (active) setState(initial);
    });
    const offConnection = window.dp.onConnectionChange((connection) =>
      setState((current) => (current ? { ...current, connection } : current)),
    );
    const offMessages = window.dp.onMessagesChange((messages) =>
      setState((current) => (current ? { ...current, messages } : current)),
    );
    const offEmployee = window.dp.onEmployeeChange(({ employee, checked }) =>
      setState((current) => (current ? { ...current, employee, employeeChecked: checked } : current)),
    );
    const offChat = window.dp.onChatChange((chat) => setState((current) => (current ? { ...current, chat } : current)));
    return () => {
      active = false;
      offConnection();
      offMessages();
      offEmployee();
      offChat();
    };
  }, []);

  return state;
}
