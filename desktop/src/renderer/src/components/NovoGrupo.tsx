import { useMemo, useState } from 'react';
import type { ConversaResumo, Participante } from '../../../shared/types';
import { Avatar } from './conversa-comuns';
import { Icone } from '../lib/icones';

interface NovoGrupoProps {
  contatos: Participante[];
  onFechar(): void;
  onCriado(conversa: ConversaResumo): void;
}

/**
 * Janela de "+ Grupo": nome e quantas pessoas quiser. Quem cria vira
 * administrador do grupo e já entra nele.
 *
 * Conversa direta não passa por aqui: todo mundo que tem conta já aparece na
 * lista da esquerda, e basta clicar na pessoa.
 */
export function NovoGrupo({ contatos, onFechar, onCriado }: NovoGrupoProps) {
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

  async function criar() {
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
    onCriado(resposta.dados);
  }

  function alternar(id: string) {
    setEscolhidos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__caixa">
        <h2 className="modal__titulo">Novo grupo</h2>

        <label className="field">
          <span>Nome do grupo</span>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Equipe da expedição"
            maxLength={60}
          />
        </label>

        <label className="field">
          <span>Quem participa</span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar por nome, setor ou usuário"
          />
        </label>

        {erro && <p className="feedback feedback--error">{erro}</p>}

        <ul className="escolha-pessoas">
          {filtrados.length === 0 && <li className="escolha-pessoas__vazio">Ninguém encontrado com esse termo.</li>}
          {filtrados.map((pessoa) => (
            <li key={pessoa.id}>
              <button
                className={`escolha-pessoa ${escolhidos.includes(pessoa.id) ? 'escolha-pessoa--marcada' : ''}`}
                onClick={() => alternar(pessoa.id)}
                disabled={salvando}
              >
                <Avatar nome={pessoa.nome} fotoMidiaId={pessoa.fotoMidiaId} classe="escolha-pessoa__avatar" />
                <span className="escolha-pessoa__texto">
                  <strong>{pessoa.nome}</strong>
                  <small>{pessoa.ehDp ? 'Departamento Pessoal' : (pessoa.setor ?? 'Sem setor')}</small>
                </span>
                {escolhidos.includes(pessoa.id) && <Icone nome="certo" />}
              </button>
            </li>
          ))}
        </ul>

        <div className="modal__rodape">
          <span className="escolha-pessoas__contagem">
            {escolhidos.length} {escolhidos.length === 1 ? 'pessoa escolhida' : 'pessoas escolhidas'}
          </span>
          <span className="modal__espaco" />
          <button className="btn" onClick={onFechar} disabled={salvando}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={() => void criar()} disabled={salvando}>
            {salvando ? 'Criando...' : 'Criar grupo'}
          </button>
        </div>
      </div>
    </div>
  );
}
