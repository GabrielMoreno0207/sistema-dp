import { useCallback, useEffect, useRef, useState } from 'react';
import { quando } from '../../components/chamados-comuns';

interface Conversa {
  employee: { id: string; name: string; registration: string | null; sector: string | null; status: string | null };
  lastMessage: { content: string; senderType: 'DP' | 'EMPLOYEE'; createdAt: string } | null;
  unreadCount: number;
}

interface MensagemChat {
  id: number;
  employeeId: string;
  senderType: 'DP' | 'EMPLOYEE';
  senderName: string;
  content: string;
  createdAt: string;
  automatic: boolean;
}

/** Conversas do DP com os funcionários, como na Central. */
export function ChatDpPage() {
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemChat[]>([]);
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState('');
  const fim = useRef<HTMLDivElement>(null);

  const carregarConversas = useCallback(async () => {
    const resultado = await window.dp.adminApi<{ conversations: Conversa[] }>('GET', '/api/chats');
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setConversas(resultado.dados?.conversations ?? []);
  }, []);

  const abrirConversa = useCallback(async (employeeId: string) => {
    setAberta(employeeId);
    const resultado = await window.dp.adminApi<{ messages: MensagemChat[] }>(
      'GET',
      `/api/chats/${encodeURIComponent(employeeId)}/messages`,
    );
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setMensagens(resultado.dados?.messages ?? []);
    await window.dp.adminApi('POST', `/api/chats/${encodeURIComponent(employeeId)}/read`, {});
  }, []);

  useEffect(() => {
    void carregarConversas();
    // A Central recarregava a cada 10 segundos; aqui é o mesmo caminho
    const timer = setInterval(() => {
      void carregarConversas();
      if (aberta) void abrirConversa(aberta);
    }, 10_000);
    return () => clearInterval(timer);
  }, [carregarConversas, abrirConversa, aberta]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' });
  }, [mensagens]);

  async function enviar() {
    if (!aberta || !texto.trim()) return;
    const resultado = await window.dp.adminApi('POST', `/api/chats/${encodeURIComponent(aberta)}/messages`, {
      content: texto.trim(),
    });
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setTexto('');
    await abrirConversa(aberta);
    await carregarConversas();
  }

  const conversaAtual = conversas.find((c) => c.employee.id === aberta);

  return (
    <div className="page page--fila">
      <header className="page__header">
        <div>
          <h1>Mensagens</h1>
          <p className="page__subtitle">Conversas suas com os funcionários. Cada pessoa do DP vê só as próprias.</p>
        </div>
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      <div className="fila">
        <div className="fila__lista">
          {conversas.length === 0 ? (
            <p className="page__subtitle">Nenhuma conversa ainda.</p>
          ) : (
            conversas.map((conversa) => (
              <button
                key={conversa.employee.id}
                className={`conversa ${aberta === conversa.employee.id ? 'chamado-item--ativo' : ''}`}
                onClick={() => void abrirConversa(conversa.employee.id)}
              >
                <span className="conversa__avatar" aria-hidden>
                  {conversa.employee.name.charAt(0).toUpperCase()}
                </span>
                <span className="conversa__texto">
                  <strong>{conversa.employee.name}</strong>
                  <span className="conversa__previa">
                    {conversa.lastMessage?.senderType === 'DP' && 'você: '}
                    {conversa.lastMessage?.content ?? 'sem mensagens'}
                  </span>
                </span>
                <span className="conversa__lado">
                  <span className="conversa__quando">{conversa.lastMessage ? quando(conversa.lastMessage.createdAt) : ''}</span>
                  {conversa.unreadCount > 0 && <span className="conversa__badge">{conversa.unreadCount}</span>}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="fila__detalhe">
          {!aberta ? (
            <p className="page__subtitle">Escolha uma conversa.</p>
          ) : (
            <>
              <h2>{conversaAtual?.employee.name ?? 'Conversa'}</h2>
              <p className="page__subtitle">
                {conversaAtual?.employee.registration ? `mat. ${conversaAtual.employee.registration}` : ''}
                {conversaAtual?.employee.sector ? ` · ${conversaAtual.employee.sector}` : ''}
              </p>

              <div className="chamado__conversa">
                {mensagens.map((mensagem) => (
                  <div key={mensagem.id} className={`balao ${mensagem.senderType === 'DP' ? 'balao--meu' : ''}`}>
                    <span className="balao__autor">
                      {mensagem.senderName}
                      {mensagem.automatic && ' · automática'}
                    </span>
                    <p className="balao__texto">{mensagem.content}</p>
                    <span className="balao__hora">{quando(mensagem.createdAt)}</span>
                  </div>
                ))}
                <div ref={fim} />
              </div>

              <div className="chamado__responder">
                <textarea
                  rows={3}
                  value={texto}
                  maxLength={2000}
                  placeholder="Escreva para o funcionário…"
                  onChange={(evento) => setTexto(evento.target.value)}
                />
                <button className="botao botao--primario" onClick={() => void enviar()} disabled={!texto.trim()}>
                  Enviar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
