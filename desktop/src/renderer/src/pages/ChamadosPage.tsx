import { useCallback, useEffect, useState } from 'react';
import type { CategoriaChamado, ChamadoCompleto, ChamadoResumo, PrioridadeChamado } from '../../../shared/types';
import {
  CATEGORIAS,
  ConversaChamado,
  EtiquetaPrioridade,
  EtiquetaStatus,
  PRIORIDADES,
  ROTULO_CATEGORIA,
  quando,
} from '../components/chamados-comuns';

/** Chamados que a pessoa abriu para o TI. */
export function ChamadosPage() {
  const [chamados, setChamados] = useState<ChamadoResumo[]>([]);
  const [aberto, setAberto] = useState<ChamadoCompleto | null>(null);
  const [criando, setCriando] = useState(false);
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

  if (criando) {
    return (
      <NovoChamado
        onCancelar={() => setCriando(false)}
        onCriado={async () => {
          setCriando(false);
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

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Chamados para o TI</h1>
          <p className="page__subtitle">Problemas com computador, impressora, sistema, rede ou acesso.</p>
        </div>
        <button className="botao botao--primario" onClick={() => setCriando(true)}>
          Abrir chamado
        </button>
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      {carregando ? (
        <p className="page__subtitle">Carregando…</p>
      ) : chamados.length === 0 ? (
        <div className="cartao chamados__vazio">
          <p>Você ainda não abriu nenhum chamado.</p>
          <button className="botao botao--primario" onClick={() => setCriando(true)}>
            Abrir o primeiro
          </button>
        </div>
      ) : (
        <div className="chamados__lista">
          {chamados.map((chamado) => (
            <button key={chamado.id} className="chamado-item" onClick={() => void abrirDetalhe(chamado.id)}>
              <span className="chamado-item__numero">#{chamado.numero}</span>
              <span className="chamado-item__texto">
                <strong>{chamado.titulo}</strong>
                <span className="chamado-item__detalhe">
                  {ROTULO_CATEGORIA[chamado.categoria]} · aberto em {quando(chamado.createdAt)}
                  {chamado.responsavelNome && ` · com ${chamado.responsavelNome}`}
                </span>
              </span>
              <span className="chamado-item__lado">
                <EtiquetaStatus status={chamado.status} />
                {chamado.mensagensNaoLidas > 0 && <span className="chamado-item__badge">{chamado.mensagensNaoLidas}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Formulário de abertura, com print opcional. */
function NovoChamado({ onCancelar, onCriado }: { onCancelar(): void; onCriado(): Promise<void> }) {
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState<CategoriaChamado>('COMPUTADOR');
  const [prioridade, setPrioridade] = useState<PrioridadeChamado>('NORMAL');
  const [imagens, setImagens] = useState<{ id: string; nome: string }[]>([]);
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

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
    const resultado = await window.dp.abrirChamado({
      titulo,
      descricao,
      categoria,
      prioridade,
      midiaIds: imagens.map((i) => i.id),
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
          <p className="page__subtitle">Conte o que está acontecendo. O TI responde por aqui mesmo.</p>
        </div>
        <button className="botao" onClick={onCancelar}>
          Voltar
        </button>
      </header>

      <div className="cartao formulario">
        <label htmlFor="chamado-titulo">O que está acontecendo</label>
        <input
          id="chamado-titulo"
          value={titulo}
          maxLength={120}
          autoFocus
          placeholder="Ex.: A impressora do setor não imprime"
          onChange={(evento) => setTitulo(evento.target.value)}
        />

        <div className="formulario__linha">
          <div>
            <label htmlFor="chamado-categoria">Categoria</label>
            <select
              id="chamado-categoria"
              value={categoria}
              onChange={(evento) => setCategoria(evento.target.value as CategoriaChamado)}
            >
              {CATEGORIAS.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>
                  {opcao.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="chamado-prioridade">Prioridade</label>
            <select
              id="chamado-prioridade"
              value={prioridade}
              onChange={(evento) => setPrioridade(evento.target.value as PrioridadeChamado)}
            >
              {PRIORIDADES.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>
                  {opcao.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label htmlFor="chamado-descricao">Detalhes</label>
        <textarea
          id="chamado-descricao"
          rows={6}
          value={descricao}
          maxLength={4000}
          placeholder="Desde quando acontece, o que aparece na tela, o que você já tentou…"
          onChange={(evento) => setDescricao(evento.target.value)}
        />

        <div className="formulario__anexos">
          <button className="botao" onClick={() => void anexar()} disabled={imagens.length >= 3}>
            Anexar print ({imagens.length}/3)
          </button>
          {imagens.map((imagem) => (
            <span key={imagem.id} className="anexo-chip">
              {imagem.nome}
              <button onClick={() => setImagens((atuais) => atuais.filter((i) => i.id !== imagem.id))} aria-label="Remover">
                ×
              </button>
            </span>
          ))}
        </div>

        {aviso && <p className="aviso-em-breve">{aviso}</p>}

        <div className="formulario__acoes">
          <button className="botao" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            className="botao botao--primario"
            onClick={() => void enviar()}
            disabled={enviando || !titulo.trim() || !descricao.trim()}
          >
            {enviando ? 'Enviando…' : 'Abrir chamado'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Chamado aberto: descrição, prints, conversa e resposta. */
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
            #{chamado.numero} · {chamado.titulo}
          </h1>
          <p className="page__subtitle">
            {ROTULO_CATEGORIA[chamado.categoria]} · aberto em {quando(chamado.createdAt)}
            {chamado.responsavelNome && ` · atendido por ${chamado.responsavelNome}`}
          </p>
        </div>
        <button className="botao" onClick={onVoltar}>
          Voltar
        </button>
      </header>

      <div className="chamado__cabecalho">
        <EtiquetaStatus status={chamado.status} />
        <EtiquetaPrioridade prioridade={chamado.prioridade} />
        {chamado.status === 'RESOLVIDO' && (
          <button className="botao" onClick={() => void fechar()}>
            Está resolvido, pode fechar
          </button>
        )}
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
