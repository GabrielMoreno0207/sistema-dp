import { useMemo, useState } from 'react';
import type { ConversaResumo, Participante } from '../../../shared/types';
import { iniciais } from './conversa-comuns';

interface NovaConversaProps {
  tipo: 'direta' | 'grupo';
  contatos: Participante[];
  onFechar(): void;
  onCriada(conversa: ConversaResumo): void;
}

/**
 * Janela de "+ Conversa" e "+ Grupo". Na conversa direta escolhe-se uma
 * pessoa; no grupo, o nome e quantas pessoas quiser (quem cria vira admin do
 * grupo e entra automaticamente).
 */
export function NovaConversa({ tipo, contatos, onFechar, onCriada }: NovaConversaProps) {
  const [busca, setBusca] = useState('');
  const [nome, setNome] = useState('');
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return contatos;
    return contatos.filter(
      (c) =>
        c.nome.toLowerCase().includes(termo) ||
        (c.setor ?? '').toLowerCase().includes(termo) ||
        (c.matricula ?? '').toLowerCase().includes(termo),
    );
  }, [busca, contatos]);

  async function criarDireta(pessoaId: string) {
    setSalvando(true);
    setErro(null);
    const resposta = await window.dp.conversasApi<ConversaResumo>('POST', '/api/conversas/direta', {
      comUsuarioId: pessoaId,
    });
    setSalvando(false);
    if (!resposta.ok || !resposta.dados) {
      setErro(resposta.message || 'Não foi possível abrir a conversa.');
      return;
    }
    onCriada(resposta.dados);
  }

  async function criarGrupo() {
    const titulo = nome.trim();
    if (!titulo || escolhidos.length === 0) {
      setErro('Dê um nome ao grupo e escolha pelo menos uma pessoa.');
      return;
    }
    setSalvando(true);
    setErro(null);
    const resposta = await window.dp.conversasApi<ConversaResumo>('POST', '/api/conversas/grupo', {
      nome: titulo,
      membros: escolhidos,
    });
    setSalvando(false);
    if (!resposta.ok || !resposta.dados) {
      setErro(resposta.message || 'Não foi possível criar o grupo.');
      return;
    }
    onCriada(resposta.dados);
  }

  function alternar(id: string) {
    setEscolhidos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__caixa">
        <h2 className="modal__titulo">{tipo === 'direta' ? 'Nova conversa' : 'Novo grupo'}</h2>

        {tipo === 'grupo' && (
          <label className="field">
            <span>Nome do grupo</span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Equipe da expedição"
              maxLength={60}
            />
          </label>
        )}

        <label className="field">
          <span>Procurar pessoa</span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, setor ou matrícula"
          />
        </label>

        {erro && <p className="feedback feedback--error">{erro}</p>}

        <ul className="escolha-pessoas">
          {filtrados.length === 0 && <li className="escolha-pessoas__vazio">Ninguém encontrado com esse termo.</li>}
          {filtrados.map((pessoa) => (
            <li key={pessoa.id}>
              <button
                className={`escolha-pessoa ${escolhidos.includes(pessoa.id) ? 'escolha-pessoa--marcada' : ''}`}
                onClick={() => (tipo === 'direta' ? void criarDireta(pessoa.id) : alternar(pessoa.id))}
                disabled={salvando}
              >
                <span className="escolha-pessoa__avatar" aria-hidden>
                  {iniciais(pessoa.nome)}
                </span>
                <span className="escolha-pessoa__texto">
                  <strong>{pessoa.nome}</strong>
                  <small>{pessoa.ehDp ? 'Departamento Pessoal' : (pessoa.setor ?? 'Sem setor')}</small>
                </span>
                {tipo === 'grupo' && escolhidos.includes(pessoa.id) && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="modal__rodape">
          {tipo === 'grupo' && (
            <span className="escolha-pessoas__contagem">
              {escolhidos.length} {escolhidos.length === 1 ? 'pessoa escolhida' : 'pessoas escolhidas'}
            </span>
          )}
          <span className="modal__espaco" />
          <button className="btn" onClick={onFechar} disabled={salvando}>
            Cancelar
          </button>
          {tipo === 'grupo' && (
            <button className="btn btn--primary" onClick={() => void criarGrupo()} disabled={salvando}>
              {salvando ? 'Criando...' : 'Criar grupo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
