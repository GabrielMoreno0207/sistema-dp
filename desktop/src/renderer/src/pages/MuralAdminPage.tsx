import { useCallback, useEffect, useState } from 'react';
import type { MidiaPublica, MuralPost } from '../../../shared/types';
import { quando } from '../components/chamados-comuns';

/** Publicação do mural pela conta do DP, dentro do próprio aplicativo. */
export function MuralAdminPage() {
  const [posts, setPosts] = useState<MuralPost[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [midia, setMidia] = useState<MidiaPublica | null>(null);
  const [ativo, setAtivo] = useState(true);
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const resultado = await window.dp.adminListarMural();
    setPosts(resultado.posts);
    if (!resultado.ok) setAviso(resultado.message);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function limpar() {
    setEditando(null);
    setTitulo('');
    setTexto('');
    setMidia(null);
    setAtivo(true);
    setAviso('');
  }

  async function escolherMidia() {
    const resultado = await window.dp.adminEnviarMidia();
    if (!resultado.ok) {
      if (resultado.message) setAviso(resultado.message);
      return;
    }
    setMidia(resultado.midia);
  }

  async function salvar() {
    setSalvando(true);
    const resultado = await window.dp.adminSalvarMural({
      id: editando,
      titulo,
      texto,
      midiaId: midia?.id ?? null,
      ativo,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    limpar();
    setAviso(resultado.message);
    await carregar();
  }

  function editar(post: MuralPost) {
    setEditando(post.id);
    setTitulo(post.titulo);
    setTexto(post.texto);
    setMidia(post.midia);
    setAtivo(post.ativo);
  }

  async function remover(post: MuralPost) {
    const resultado = await window.dp.adminRemoverMural(post.id);
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    if (editando === post.id) limpar();
    await carregar();
  }

  const emExibicao = posts.find((post) => post.ativo);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Mural</h1>
          <p className="page__subtitle">O recado fica fixado na tela inicial de todos os aplicativos.</p>
        </div>
      </header>

      <div className="cartao formulario">
        <label htmlFor="mural-titulo">Título</label>
        <input
          id="mural-titulo"
          value={titulo}
          maxLength={120}
          placeholder="Ex.: Campanha de vacinação"
          onChange={(evento) => setTitulo(evento.target.value)}
        />

        <label htmlFor="mural-texto">Texto</label>
        <textarea
          id="mural-texto"
          rows={5}
          value={texto}
          maxLength={4000}
          onChange={(evento) => setTexto(evento.target.value)}
        />

        <div className="mural-admin__midia">
          <div className="mural-admin__previa">
            {!midia ? (
              <span className="mural-admin__vazia">sem imagem ou vídeo</span>
            ) : midia.tipo === 'VIDEO' ? (
              <video src={`dpmidia://m/${midia.id}`} controls preload="metadata" />
            ) : (
              <img src={`dpmidia://m/${midia.id}`} alt={midia.nome} />
            )}
          </div>
          <div>
            <button className="botao" onClick={() => void escolherMidia()}>
              {midia ? 'Trocar arquivo' : 'Escolher imagem ou vídeo'}
            </button>
            {midia && (
              <button className="botao" onClick={() => setMidia(null)}>
                Tirar
              </button>
            )}
            <p className="page__subtitle">Imagem até 10 MB, vídeo até 200 MB.</p>
          </div>
        </div>

        <label className="caixa">
          <input type="checkbox" checked={ativo} onChange={(evento) => setAtivo(evento.target.checked)} />
          em exibição no aplicativo
        </label>

        {aviso && <p className="aviso-em-breve">{aviso}</p>}

        <div className="formulario__acoes">
          {editando && (
            <button className="botao" onClick={limpar}>
              Cancelar edição
            </button>
          )}
          <button
            className="botao botao--primario"
            onClick={() => void salvar()}
            disabled={salvando || !titulo.trim() || !texto.trim()}
          >
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Publicar no mural'}
          </button>
        </div>
      </div>

      <h2 className="mural-admin__titulo">Recados anteriores</h2>
      <div className="mural-admin__lista">
        {posts.length === 0 ? (
          <p className="page__subtitle">Nenhum recado publicado ainda.</p>
        ) : (
          posts.map((post) => (
            <div key={post.id} className={`cartao mural-admin__item ${post.ativo ? '' : 'mural-admin__item--inativo'}`}>
              <div className="mural-admin__item-texto">
                <strong>
                  {post.titulo}
                  {post === emExibicao && ' · em exibição'}
                </strong>
                <p>{post.texto}</p>
                <span className="page__subtitle">
                  {quando(post.createdAt)} · {post.criadoPor}
                  {post.midia && ` · ${post.midia.tipo === 'VIDEO' ? 'vídeo' : 'imagem'}`}
                </span>
              </div>
              <div className="mural-admin__item-acoes">
                <button className="botao" onClick={() => editar(post)}>
                  Editar
                </button>
                <button className="botao botao--perigo" onClick={() => void remover(post)}>
                  Apagar
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
