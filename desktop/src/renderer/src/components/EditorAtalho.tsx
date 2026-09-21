import { useState } from 'react';
import type { Atalho, DadosAtalho, DestinoAtalho } from '../../../shared/types';

const ICONES = ['◈', '✉', '☺', '★', '✚', '◷', '▤', '♥', '⚑', '✎', '⧗', '☀'];
const CORES = ['#17b3a3', '#3f8fd0', '#6c63c7', '#2ea36f', '#d98324', '#c0554d', '#e0a92b', '#d15c8a'];

const DESTINOS: { valor: DestinoAtalho; label: string }[] = [
  { valor: 'COMUNICADOS', label: 'Comunicados' },
  { valor: 'CHAT', label: 'Conversar com o DP' },
  { valor: 'MURAL', label: 'Mural' },
  { valor: 'PERFIL', label: 'Meu perfil' },
  { valor: 'CONFIGURACOES', label: 'Configurações' },
];

interface EditorAtalhoProps {
  /** Atalho existente (edição) ou null (criação) */
  atalho: Atalho | null;
  onSalvar(dados: DadosAtalho): Promise<void>;
  onRemover?(): Promise<void>;
  onFechar(): void;
}

export function EditorAtalho({ atalho, onSalvar, onRemover, onFechar }: EditorAtalhoProps) {
  const [rotulo, setRotulo] = useState(atalho?.rotulo ?? '');
  const [icone, setIcone] = useState(atalho?.icone ?? ICONES[0]);
  const [cor, setCor] = useState(atalho?.cor ?? CORES[0]);
  const [destino, setDestino] = useState<DestinoAtalho>(atalho?.destino ?? 'COMUNICADOS');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!rotulo.trim()) return;
    setSalvando(true);
    try {
      await onSalvar({ rotulo: rotulo.trim(), icone, cor, destino });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onFechar}>
      <div className="modal__caixa" onClick={(evento) => evento.stopPropagation()}>
        <h2 className="modal__titulo">{atalho ? 'Editar atalho' : 'Novo atalho'}</h2>

        <div className="editor-atalho">
          <div className="editor-atalho__previa" style={{ backgroundColor: cor }}>
            <span className="azulejo__icone" aria-hidden>
              {icone}
            </span>
            <span className="azulejo__label">{rotulo.trim() || 'Nome do atalho'}</span>
          </div>

          <div className="editor-atalho__campos">
            <label htmlFor="atalho-rotulo">Nome</label>
            <input
              id="atalho-rotulo"
              value={rotulo}
              maxLength={24}
              autoFocus
              onChange={(evento) => setRotulo(evento.target.value)}
              placeholder="Ex.: Meus comunicados"
            />

            <label htmlFor="atalho-destino">Abre</label>
            <select id="atalho-destino" value={destino} onChange={(evento) => setDestino(evento.target.value as DestinoAtalho)}>
              {DESTINOS.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>
                  {opcao.label}
                </option>
              ))}
            </select>

            <span className="editor-atalho__rotulo-grupo">Ícone</span>
            <div className="editor-atalho__opcoes">
              {ICONES.map((opcao) => (
                <button
                  key={opcao}
                  className={`opcao-icone ${icone === opcao ? 'opcao-icone--ativa' : ''}`}
                  onClick={() => setIcone(opcao)}
                  aria-label={`Ícone ${opcao}`}
                >
                  {opcao}
                </button>
              ))}
            </div>

            <span className="editor-atalho__rotulo-grupo">Cor</span>
            <div className="editor-atalho__opcoes">
              {CORES.map((opcao) => (
                <button
                  key={opcao}
                  className={`opcao-cor ${cor === opcao ? 'opcao-cor--ativa' : ''}`}
                  style={{ backgroundColor: opcao }}
                  onClick={() => setCor(opcao)}
                  aria-label={`Cor ${opcao}`}
                />
              ))}
            </div>
          </div>
        </div>

        <footer className="modal__rodape">
          {atalho && onRemover && (
            <button className="botao botao--perigo" onClick={() => void onRemover()}>
              Remover
            </button>
          )}
          <span className="modal__espaco" />
          <button className="botao" onClick={onFechar}>
            Cancelar
          </button>
          <button className="botao botao--primario" onClick={() => void salvar()} disabled={!rotulo.trim() || salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
