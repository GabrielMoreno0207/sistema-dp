import type { CategoriaChamado, ChamadoMensagem, PrioridadeChamado, StatusChamado } from '../../../shared/types';

export const CATEGORIAS: { valor: CategoriaChamado; label: string }[] = [
  { valor: 'COMPUTADOR', label: 'Computador' },
  { valor: 'IMPRESSORA', label: 'Impressora' },
  { valor: 'SISTEMA', label: 'Sistema / programa' },
  { valor: 'REDE', label: 'Rede / internet' },
  { valor: 'ACESSO', label: 'Acesso e senha' },
  { valor: 'OUTRO', label: 'Outro' },
];

export const PRIORIDADES: { valor: PrioridadeChamado; label: string }[] = [
  { valor: 'BAIXA', label: 'Baixa' },
  { valor: 'NORMAL', label: 'Normal' },
  { valor: 'ALTA', label: 'Alta' },
];

export const ROTULO_CATEGORIA: Record<CategoriaChamado, string> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.valor, c.label]),
) as Record<CategoriaChamado, string>;

export const ROTULO_STATUS: Record<StatusChamado, string> = {
  ABERTO: 'Aberto',
  EM_ANDAMENTO: 'Em andamento',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
};

export function quando(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  return mesmoDia
    ? `Hoje, ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function EtiquetaStatus({ status }: { status: StatusChamado }) {
  return <span className={`etiqueta-status etiqueta-status--${status.toLowerCase()}`}>{ROTULO_STATUS[status]}</span>;
}

export function EtiquetaPrioridade({ prioridade }: { prioridade: PrioridadeChamado }) {
  if (prioridade === 'NORMAL') return null;
  return (
    <span className={`etiqueta-prioridade etiqueta-prioridade--${prioridade.toLowerCase()}`}>
      {prioridade === 'ALTA' ? 'Prioridade alta' : 'Prioridade baixa'}
    </span>
  );
}

/** Conversa do chamado, usada pela tela do funcionário e pela fila do TI. */
export function ConversaChamado({ mensagens, souTi }: { mensagens: ChamadoMensagem[]; souTi: boolean }) {
  if (mensagens.length === 0) {
    return <p className="chamado__sem-mensagens">Nenhuma mensagem ainda.</p>;
  }
  return (
    <div className="chamado__conversa">
      {mensagens.map((mensagem) => {
        const minha = souTi ? mensagem.autorTipo === 'TI' : mensagem.autorTipo === 'SOLICITANTE';
        return (
          <div key={mensagem.id} className={`balao ${minha ? 'balao--meu' : ''}`}>
            <span className="balao__autor">
              {mensagem.autorNome}
              {mensagem.autorTipo === 'TI' && ' · TI'}
            </span>
            <p className="balao__texto">{mensagem.conteudo}</p>
            <span className="balao__hora">{quando(mensagem.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
