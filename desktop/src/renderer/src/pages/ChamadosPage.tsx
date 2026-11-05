import { useCallback, useEffect, useState } from 'react';
import type { CategoriaChamado, ChamadoCompleto, ChamadoResumo } from '../../../shared/types';
import {
  BarraAndamento,
  CATEGORIAS,
  ConversaChamado,
  EtiquetaPrioridade,
  EtiquetaStatus,
  ICONE_CATEGORIA,
  LinhaDoTempo,
  Responsavel,
  ROTULO_CATEGORIA,
  quando,
} from '../components/chamados-comuns';
import { Icone } from '../lib/icones';

/**
 * Chamados para o TI, na visão de quem abre.
 *
 * A tela já começa na grade de ícones: pedir chamado é um clique na figura do
 * que está com problema, e não um formulário. Quem quiser contar mais escreve
 * uma linha na tela seguinte; quem não quiser só aperta Enviar.
 */
export function ChamadosPage() {
  const [chamados, setChamados] = useState<ChamadoResumo[]>([]);
  const [aberto, setAberto] = useState<ChamadoCompleto | null>(null);
  const [categoriaNova, setCategoriaNova] = useState<CategoriaChamado | null>(null);
  const [aviso, setAviso] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const resultado = await window.dp.listarChamados();
    setChamados(resultado.chamados);
    if (!resultado.ok) setAviso(resultado.message);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
    return window.dp.onChamadosChange(() => void carregar());
  }, [carregar]);

  async function abrirDetalhe(id: string) {
    const resultado = await window.dp.detalheChamado(id);
    if (!resultado.ok || !resultado.chamado) {
      setAviso(resultado.message);
      return;
    }
    setAberto(resultado.chamado);
    if (resultado.chamado.naoLidas > 0) {
      await window.dp.marcarChamadoLido(id);
      await carregar();
    }
  }

  if (categoriaNova) {
    return (
      <NovoChamado
        categoria={categoriaNova}
        onVoltar={() => setCategoriaNova(null)}
        onCriado={async () => {
          setCategoriaNova(null);
          await carregar();
        }}
      />
    );
  }

  if (aberto) {
    return (
      <DetalheChamado
        chamado={aberto}
        onVoltar={() => setAberto(null)}
        onMudou={async () => {
          await abrirDetalhe(aberto.id);
          await carregar();
        }}
      />
    );
  }

  const emAberto = chamados.filter((chamado) => chamado.status !== 'FECHADO');
  const encerrados = chamados.filter((chamado) => chamado.status === 'FECHADO');

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Chamados para o TI</h1>
          <p className="page__subtitle">Clique no que está com problema. O TI recebe na hora.</p>
        </div>
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      <div className="ocasioes ocasioes--abertura" role="group" aria-label="Com o que é o problema?">
        {CATEGORIAS.map((categoria) => (
          <button
            key={categoria.valor}
            type="button"
            className="ocasiao"
            onClick={() => setCategoriaNova(categoria.valor)}
          >
            <Icone nome={categoria.icone} tamanho={34} />
            <strong className="ocasiao__nome">{categoria.label}</strong>
            <small className="ocasiao__exemplo">{categoria.exemplo}</small>
          </button>
        ))}
      </div>

      {carregando ? null : chamados.length === 0 ? (
        <p className="page__subtitle">Você ainda não abriu nenhum chamado.</p>
      ) : (
        <>
          <h2 className="chamados__secao">Meus chamados</h2>
          <div className="chamados__lista">
            {[...emAberto, ...encerrados].map((chamado) => (
              <button key={chamado.id} className="chamado-item" onClick={() => void abrirDetalhe(chamado.id)}>
                {/* Mesmo desenho da fila do TI: coluna fixa com o ícone e o número,
                    para o título de todos os chamados começar no mesmo lugar */}
                <span className="chamado-item__coluna">
                  <span className="chamado-item__icone" aria-hidden>
                    <Icone nome={ICONE_CATEGORIA[chamado.categoria]} tamanho={20} />
                  </span>
                  <span className="chamado-item__numero">#{chamado.numero}</span>
                </span>
                <span className="chamado-item__texto">
                  <strong className="chamado-item__titulo">{chamado.titulo}</strong>
                  {/* A barra responde "e o meu chamado?" sem precisar abrir */}
                  <BarraAndamento status={chamado.status} />
                </span>
                <span className="chamado-item__lado">
                  <EtiquetaStatus status={chamado.status} />
                  {chamado.mensagensNaoLidas > 0 && (
                    <span className="chamado-item__badge">{chamado.mensagensNaoLidas}</span>
                  )}
                </span>
                <span className="chamado-item__rodape">
                  {chamado.responsavelNome ? (
                    <Responsavel nome={chamado.responsavelNome} />
                  ) : (
                    <span className="chamado-item__detalhe">Esperando o TI aceitar</span>
                  )}
                  <span className="chamado-item__pegar">Aberto em {quando(chamado.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Primeira linha do que a pessoa escreveu, para virar o título da lista. */
function tituloDoTexto(texto: string, categoria: CategoriaChamado): string {
  const primeira = texto.split('\n')[0]?.trim() ?? '';
  if (!primeira) return ROTULO_CATEGORIA[categoria];
  return primeira.length > 80 ? `${primeira.slice(0, 79)}…` : primeira;
}

/**
 * Confirmação do chamado: a categoria já veio do ícone, então só falta enviar.
 *
 * O texto é opcional de propósito. Na fábrica, obrigar a escrever é o que faz
 * a pessoa desistir e ligar para o TI — e o TI pergunta o que faltar dentro do
 * próprio chamado.
 */
function NovoChamado({
  categoria,
  onVoltar,
  onCriado,
}: {
  categoria: CategoriaChamado;
  onVoltar(): void;
  onCriado(): Promise<void>;
}) {
  const [texto, setTexto] = useState('');
  const [imagens, setImagens] = useState<{ id: string; nome: string }[]>([]);
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const escolhida = CATEGORIAS.find((item) => item.valor === categoria);
  // Relatório é pedido de trabalho novo: sem dizer como ele precisa ser,
  // o TI não tem o que desenvolver — então aqui o texto não é opcional.
  const obrigatorio = escolhida?.descricaoObrigatoria === true;
  const faltaTexto = obrigatorio && texto.trim().length < 15;

  async function anexar() {
    const resultado = await window.dp.enviarImagemChamado();
    if (!resultado.ok) {
      if (resultado.message) setAviso(resultado.message);
      return;
    }
    if (resultado.midiaId) setImagens((atuais) => [...atuais, { id: resultado.midiaId as string, nome: resultado.nome }]);
  }

  async function enviar() {
    setEnviando(true);
    setAviso('');
    const limpo = texto.trim();
    const resultado = await window.dp.abrirChamado({
      titulo: obrigatorio ? `Relatório: ${tituloDoTexto(limpo, categoria)}` : tituloDoTexto(limpo, categoria),
      // O servidor exige descrição; sem texto, o próprio ícone é o recado
      descricao: limpo || `Aberto pelo ícone "${ROTULO_CATEGORIA[categoria]}", sem detalhes.`,
      categoria,
      prioridade: 'NORMAL',
      midiaIds: imagens.map((imagem) => imagem.id),
    });
    setEnviando(false);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    await onCriado();
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Abrir chamado</h1>
          <p className="page__subtitle">Confira e envie. O TI responde por aqui mesmo.</p>
        </div>
        <button className="botao" onClick={onVoltar}>
          Voltar
        </button>
      </header>

      <div className="cartao formulario novo-chamado">
        <div className="novo-chamado__escolha">
          <span className="novo-chamado__icone" aria-hidden>
            <Icone nome={ICONE_CATEGORIA[categoria]} tamanho={30} />
          </span>
          <span>
            <strong>{ROTULO_CATEGORIA[categoria]}</strong>
            {escolhida && <small>{escolhida.exemplo}</small>}
          </span>
          <button className="botao botao--pequeno" onClick={onVoltar}>
            Trocar
          </button>
        </div>

        <label htmlFor="chamado-texto">
          {obrigatorio ? escolhida?.pergunta : 'Quer contar mais? (opcional)'}
        </label>
        {obrigatorio && escolhida?.dica && <p className="novo-chamado__dica">{escolhida.dica}</p>}
        <textarea
          id="chamado-texto"
          rows={obrigatorio ? 6 : 4}
          value={texto}
          maxLength={2000}
          autoFocus
          placeholder={obrigatorio ? 'Descreva o relatório que você precisa…' : 'Ex.: a impressora do setor não puxa o papel'}
          onChange={(evento) => setTexto(evento.target.value)}
        />

        <div className="formulario__anexos">
          <button className="botao" onClick={() => void anexar()} disabled={imagens.length >= 3}>
            <Icone nome="anexo" tamanho={15} /> Anexar print ({imagens.length}/3)
          </button>
          {imagens.map((imagem) => (
            <span key={imagem.id} className="anexo-chip">
              {imagem.nome}
              <button
                onClick={() => setImagens((atuais) => atuais.filter((i) => i.id !== imagem.id))}
                aria-label="Remover"
              >
                <Icone nome="fechar" tamanho={13} />
              </button>
            </span>
          ))}
        </div>

        {aviso && <p className="aviso-em-breve">{aviso}</p>}

        {/* Só o botão que interessa: voltar já está no cabeçalho e em "Trocar" */}
        <div className="formulario__acoes">
          <button
            className="botao botao--primario botao--enviar"
            onClick={() => void enviar()}
            disabled={enviando || faltaTexto}
            title={faltaTexto ? 'Conte como o relatório precisa ser para poder enviar' : undefined}
          >
            {enviando ? 'Enviando…' : 'Enviar chamado'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Chamado aberto: andamento, descrição, prints, conversa e resposta. */
function DetalheChamado({
  chamado,
  onVoltar,
  onMudou,
}: {
  chamado: ChamadoCompleto;
  onVoltar(): void;
  onMudou(): Promise<void>;
}) {
  const [resposta, setResposta] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fechado = chamado.status === 'FECHADO';

  async function responder() {
    setEnviando(true);
    const resultado = await window.dp.responderChamado(chamado.id, resposta);
    setEnviando(false);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setResposta('');
    await onMudou();
  }

  async function fechar() {
    const resultado = await window.dp.fecharChamado(chamado.id);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    await onMudou();
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>
            <Icone nome={ICONE_CATEGORIA[chamado.categoria]} tamanho={20} /> #{chamado.numero} · {chamado.titulo}
          </h1>
          <p className="page__subtitle">
            {ROTULO_CATEGORIA[chamado.categoria]} · aberto em {quando(chamado.createdAt)}
          </p>
        </div>
        <button className="botao" onClick={onVoltar}>
          Voltar
        </button>
      </header>

      {/* Onde o chamado está: é a primeira coisa que quem abriu quer saber */}
      <div className="cartao chamado__andamento">
        <LinhaDoTempo status={chamado.status} responsavelNome={chamado.responsavelNome} />
        <div className="chamado__cabecalho">
          <Responsavel nome={chamado.responsavelNome} />
          <EtiquetaPrioridade prioridade={chamado.prioridade} />
          {chamado.status === 'RESOLVIDO' && (
            <button className="botao botao--primario" onClick={() => void fechar()}>
              Está resolvido, pode fechar
            </button>
          )}
        </div>
      </div>

      <div className="cartao chamado__descricao">
        <p>{chamado.descricao}</p>
        {chamado.midias.length > 0 && (
          <div className="chamado__prints">
            {chamado.midias.map((midia) => (
              <img key={midia.id} src={`dpmidia://m/${midia.id}`} alt={midia.nome} />
            ))}
          </div>
        )}
      </div>

      <ConversaChamado mensagens={chamado.mensagens} souTi={false} />

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      {fechado ? (
        <p className="page__subtitle">Este chamado está fechado. Se o problema voltar, abra um novo.</p>
      ) : (
        <div className="chamado__responder">
          <textarea
            rows={3}
            value={resposta}
            maxLength={2000}
            placeholder="Escreva para o TI…"
            onChange={(evento) => setResposta(evento.target.value)}
          />
          <button className="botao botao--primario" onClick={() => void responder()} disabled={enviando || !resposta.trim()}>
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
