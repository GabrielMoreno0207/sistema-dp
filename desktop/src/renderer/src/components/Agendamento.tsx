/**
 * Agendar comunicado ou recado do mural: o campo de data e hora do formulário e
 * a lista do que está esperando (com cancelar). Quem envia na hora certa é o
 * servidor, mesmo com este computador desligado.
 */
import { useCallback, useEffect, useState } from 'react';

type Status = 'PENDENTE' | 'ENVIANDO' | 'ENVIADO' | 'FALHOU' | 'CANCELADO';

interface Agendado {
  id: string;
  tipo: 'COMUNICADO' | 'MURAL';
  dados: { title?: string; titulo?: string; target?: string; targetId?: string; type?: string };
  executarEm: string;
  status: Status;
  criadoPorNome: string;
  erro: string | null;
  enviadoEm: string | null;
}

const SITUACAO: Record<Status, string> = {
  PENDENTE: 'Aguardando',
  ENVIANDO: 'Enviando',
  ENVIADO: 'Enviado',
  FALHOU: 'Falhou',
  CANCELADO: 'Cancelado',
};

const DESTINO: Record<string, string> = {
  ALL: 'Todos',
  SECTOR: 'Setor',
  SHIFT: 'Turno',
  EMPLOYEE: 'Funcionário',
  COMPUTER: 'Computador',
};

/** "2026-10-20T08:00" (campo datetime-local, hora deste PC) -> ISO com fuso */
export function paraIso(local: string): string | null {
  const data = new Date(local);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/** Formato do campo datetime-local para uma data (hora local) */
function paraCampo(data: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}T${p(data.getHours())}:${p(data.getMinutes())}`;
}

/** "20/10/2026 às 08:00" */
export function dataPorExtenso(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  const dia = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dia} às ${hora}`;
}

/** Caixa "Agendar" + campo de data e hora (vazio = envia na hora) */
export function CampoAgendar(props: { ativo: boolean; onAtivo(v: boolean): void; quando: string; onQuando(v: string): void }) {
  const { ativo, onAtivo, quando, onQuando } = props;
  const minimo = paraCampo(new Date(Date.now() + 2 * 60_000));

  function ligar(v: boolean) {
    onAtivo(v);
    // Sugestão: amanhã às 8h
    if (v && !quando) {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      amanha.setHours(8, 0, 0, 0);
      onQuando(paraCampo(amanha));
    }
  }

  return (
    <div className="agendar">
      <label className="caixa-marcar">
        <input type="checkbox" checked={ativo} onChange={(e) => ligar(e.target.checked)} />
        <span>
          Agendar para uma data e hora
          <small className="page__subtitle">O servidor envia sozinho na hora marcada, mesmo com este computador desligado.</small>
        </span>
      </label>
      {ativo && (
        <input
          type="datetime-local"
          className="agendar__campo"
          value={quando}
          min={minimo}
          onChange={(e) => onQuando(e.target.value)}
          aria-label="Data e hora do envio"
        />
      )}
    </div>
  );
}

/** Agendados (esperando primeiro) e os últimos já resolvidos. versao: sobe para recarregar */
export function ListaAgendados(props: { tipo: 'COMUNICADO' | 'MURAL'; versao: number; onAviso(msg: string): void }) {
  const { tipo, versao, onAviso } = props;
  const [lista, setLista] = useState<Agendado[]>([]);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await window.dp.adminApi<{ agendamentos: Agendado[] }>('GET', `/api/agendamentos?tipo=${tipo}`);
    setCarregado(true);
    if (r.ok) setLista(r.dados?.agendamentos ?? []);
    else onAviso(r.message);
  }, [tipo, onAviso]);

  useEffect(() => {
    void carregar();
    // Confere de tempos em tempos: o que estava aguardando passa a "Enviado"
    const timer = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(timer);
  }, [carregar, versao]);

  async function cancelar(item: Agendado) {
    const r = await window.dp.adminApi('DELETE', `/api/agendamentos/${item.id}`);
    onAviso(r.ok ? 'Agendamento cancelado: não será enviado.' : r.message);
    await carregar();
  }

  if (!carregado) return null;
  const pendentes = lista.filter((a) => a.status === 'PENDENTE' || a.status === 'ENVIANDO').length;

  return (
    <div className="tabela-caixa">
      <table className="tabela">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Título</th>
            {tipo === 'COMUNICADO' && <th>Destino</th>}
            <th>Agendado por</th>
            <th>Situação</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 ? (
            <tr>
              <td colSpan={tipo === 'COMUNICADO' ? 6 : 5} className="tabela__vazia">
                Nada agendado. Marque "Agendar para uma data e hora" no formulário.
              </td>
            </tr>
          ) : (
            lista.map((item) => (
              <tr key={item.id} className={item.status === 'PENDENTE' ? '' : 'agendado--resolvido'}>
                <td className="agendado__quando">{dataPorExtenso(item.executarEm)}</td>
                <td>{item.dados.title ?? item.dados.titulo}</td>
                {tipo === 'COMUNICADO' && (
                  <td>
                    {DESTINO[item.dados.target ?? 'ALL'] ?? item.dados.target}
                    {item.dados.targetId && item.dados.target !== 'EMPLOYEE' && item.dados.target !== 'COMPUTER' ? `: ${item.dados.targetId}` : ''}
                  </td>
                )}
                <td>{item.criadoPorNome}</td>
                <td>
                  <span className={`situacao situacao--${item.status.toLowerCase()}`} title={item.erro ?? undefined}>
                    {SITUACAO[item.status]}
                  </span>
                  {item.status === 'FALHOU' && item.erro && <small className="agendado__erro">{item.erro}</small>}
                </td>
                {/* Célula vazia sem a classe de ações (ela vira flex e quebra a linha da tabela) */}
                {item.status === 'PENDENTE' ? (
                  <td className="tabela__acoes">
                    <button className="link-btn link-btn--perigo" onClick={() => void cancelar(item)}>
                      cancelar
                    </button>
                  </td>
                ) : (
                  <td />
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {pendentes > 0 && (
        <p className="page__subtitle agendados__rodape">
          {pendentes} {pendentes === 1 ? 'agendamento aguardando' : 'agendamentos aguardando'} a hora de sair.
        </p>
      )}
    </div>
  );
}
