import type { CategoriaChamado, ChamadoMensagem, PrioridadeChamado, StatusChamado } from '../../../shared/types';
import { Icone, type NomeIcone } from '../lib/icones';

/**
 * As ocasiões de chamado, cada uma com o seu ícone e um exemplo.
 *
 * Quem abre o chamado quase nunca sabe nomear o problema ("é sistema ou é
 * rede?"). O ícone e o exemplo resolvem isso sem obrigar ninguém a ler uma
 * lista suspensa: a pessoa reconhece a figura do que está na frente dela.
 */
export const CATEGORIAS: { valor: CategoriaChamado; label: string; icone: NomeIcone; exemplo: string }[] = [
  { valor: 'COMPUTADOR', label: 'Computador', icone: 'computador', exemplo: 'Não liga, travando, lento' },
  { valor: 'IMPRESSORA', label: 'Impressora', icone: 'impressora', exemplo: 'Não imprime, sem papel, atolou' },
  { valor: 'SISTEMA', label: 'Sistema', icone: 'programa', exemplo: 'Programa com erro ou fechando' },
  { valor: 'REDE', label: 'Rede', icone: 'rede', exemplo: 'Sem internet, rede caindo' },
  { valor: 'ACESSO', label: 'Acesso e senha', icone: 'chave', exemplo: 'Esqueci a senha, sem permissão' },
  { valor: 'OUTRO', label: 'Outro', icone: 'duvida', exemplo: 'Não sei em qual encaixa' },
];

export const ICONE_CATEGORIA: Record<CategoriaChamado, NomeIcone> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.valor, c.icone]),
) as Record<CategoriaChamado, NomeIcone>;

export const PRIORIDADES: { valor: PrioridadeChamado; label: string }[] = [
  { valor: 'BAIXA', label: 'Baixa' },
  { valor: 'NORMAL', label: 'Normal' },
  { valor: 'ALTA', label: 'Alta' },
];

/**
 * A urgência dita em palavras do dia a dia.
 *
 * "Prioridade alta" é quem abre o chamado que decide, e todo mundo acha que o
 * seu caso é alta. Perguntando pelo impacto ("consigo trabalhar?") a resposta
 * fica honesta e a fila do TI faz sentido.
 */
export const ROTULO_URGENCIA: Record<PrioridadeChamado, string> = {
  BAIXA: 'Não, consigo trabalhar',
  NORMAL: 'Atrapalha um pouco',
  ALTA: 'Sim, estou parado',
};

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

/**
 * Escolha da ocasião por ícone, no lugar da lista suspensa.
 *
 * É o primeiro passo de quem abre um chamado, então aparece grande e clicável:
 * seis cartões, um clique, sem abrir menu nenhum.
 */
export function SeletorCategoria({
  valor,
  onEscolher,
}: {
  valor: CategoriaChamado;
  onEscolher(categoria: CategoriaChamado): void;
}) {
  return (
    <div className="ocasioes" role="radiogroup" aria-label="O que está acontecendo?">
      {CATEGORIAS.map((categoria) => {
        const escolhida = categoria.valor === valor;
        return (
          <button
            key={categoria.valor}
            type="button"
            role="radio"
            aria-checked={escolhida}
            className={`ocasiao ${escolhida ? 'ocasiao--escolhida' : ''}`}
            onClick={() => onEscolher(categoria.valor)}
          >
            <Icone nome={categoria.icone} tamanho={26} />
            <strong className="ocasiao__nome">{categoria.label}</strong>
            <small className="ocasiao__exemplo">{categoria.exemplo}</small>
          </button>
        );
      })}
    </div>
  );
}

/** As quatro etapas, na ordem em que o chamado caminha. */
const ETAPAS: { status: StatusChamado; icone: NomeIcone; descricao: string }[] = [
  { status: 'ABERTO', icone: 'ponto', descricao: 'Na fila do TI' },
  { status: 'EM_ANDAMENTO', icone: 'ampulheta', descricao: 'Alguém está cuidando' },
  { status: 'RESOLVIDO', icone: 'certo', descricao: 'TI concluiu' },
  { status: 'FECHADO', icone: 'certoDuplo', descricao: 'Encerrado' },
];

/**
 * Onde o chamado está, em quatro etapas.
 *
 * Uma etiqueta só diz o estado atual; quem abriu quer saber se já saiu do
 * lugar e o que falta. A linha mostra o caminho inteiro, com o que já passou
 * marcado e o responsável assim que alguém aceita.
 */
export function LinhaDoTempo({ status, responsavelNome }: { status: StatusChamado; responsavelNome?: string | null }) {
  const atual = ETAPAS.findIndex((etapa) => etapa.status === status);
  return (
    <ol className="andamento" aria-label={`Situação do chamado: ${ROTULO_STATUS[status]}`}>
      {ETAPAS.map((etapa, posicao) => {
        const passou = posicao < atual;
        const agora = posicao === atual;
        return (
          <li
            key={etapa.status}
            className={`andamento__etapa ${passou ? 'andamento__etapa--passou' : ''} ${agora ? 'andamento__etapa--agora' : ''}`}
            aria-current={agora ? 'step' : undefined}
          >
            <span className="andamento__marca" aria-hidden>
              <Icone nome={passou ? 'certo' : etapa.icone} tamanho={15} />
            </span>
            <span className="andamento__texto">
              <strong>{ROTULO_STATUS[etapa.status]}</strong>
              <small>
                {agora && etapa.status === 'EM_ANDAMENTO' && responsavelNome ? `Com ${responsavelNome}` : etapa.descricao}
              </small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Quem pegou o chamado, ou o aviso de que ele ainda está livre na fila. */
export function Responsavel({ nome }: { nome: string | null }) {
  if (!nome) {
    return (
      <span className="responsavel responsavel--livre">
        <Icone nome="aceitar" tamanho={15} /> Sem responsável
      </span>
    );
  }
  return (
    <span className="responsavel">
      <Icone nome="perfil" tamanho={15} /> {nome}
    </span>
  );
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
