import { useMemo, useState } from 'react';
import type { ConversaResumo, Participante } from '../../../shared/types';
import { Avatar } from './conversa-comuns';

interface PainelGrupoProps {
  conversa: ConversaResumo;
  /** Todo mundo com quem dá para conversar (para adicionar ao grupo) */
  contatos: Participante[];
  euId: string;
  onMudou(): Promise<void> | void;
  onSaiu(): Promise<void> | void;
  onErro(mensagem: string): void;
  onAviso(mensagem: string): void;
}

/**
 * Participantes do grupo: quem criou (e quem virou admin) pode renomear,
 * adicionar e remover; qualquer um pode sair.
 */
export function PainelGrupo({ conversa, contatos, euId, onMudou, onSaiu, onErro, onAviso }: PainelGrupoProps) {
  const [renomeando, setRenomeando] = useState(false);
  const [nome, setNome] = useState(conversa.nome ?? '');
  const [adicionando, setAdicionando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const souAdmin = conversa.meuPapel === 'ADMIN';
  const deFora = useMemo(() => {
    const dentro = new Set(conversa.participantes.map((p) => p.id));
    return contatos.filter((c) => !dentro.has(c.id));
  }, [conversa.participantes, contatos]);

  async function chamar(metodo: 'POST' | 'PUT' | 'DELETE', caminho: string, corpo?: unknown): Promise<boolean> {
    setOcupado(true);
    try {
      const resposta = await window.dp.conversasApi(metodo, caminho, corpo);
      if (!resposta.ok) {
        onErro(resposta.message);
        return false;
      }
      return true;
    } finally {
      setOcupado(false);
    }
  }

  async function renomear() {
    const novo = nome.trim();
    if (!novo) return;
    if (await chamar('PUT', `/api/conversas/${conversa.id}/nome`, { nome: novo })) {
      setRenomeando(false);
      onAviso('Nome do grupo alterado.');
      await onMudou();
    }
  }

  async function adicionar(pessoaId: string) {
    if (await chamar('POST', `/api/conversas/${conversa.id}/membros`, { usuarioId: pessoaId })) {
      setAdicionando(false);
      await onMudou();
    }
  }

  async function remover(pessoaId: string) {
    if (await chamar('DELETE', `/api/conversas/${conversa.id}/membros/${pessoaId}`)) await onMudou();
  }

  async function sair() {
    if (await chamar('POST', `/api/conversas/${conversa.id}/sair`)) await onSaiu();
  }

  return (
    <section className="grupo">
      <header className="grupo__topo">
        {renomeando ? (
          <div className="grupo__renomear">
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
            <button className="btn btn--primary btn--sm" onClick={() => void renomear()} disabled={ocupado}>
              Salvar
            </button>
            <button className="btn btn--sm" onClick={() => setRenomeando(false)} disabled={ocupado}>
              Cancelar
            </button>
          </div>
        ) : (
          <>
            <strong>Participantes ({conversa.participantes.length})</strong>
            <span className="modal__espaco" />
            {souAdmin && (
              <button className="btn btn--sm" onClick={() => setRenomeando(true)}>
                Renomear
              </button>
            )}
            {souAdmin && (
              <button className="btn btn--sm" onClick={() => setAdicionando((v) => !v)}>
                {adicionando ? 'Fechar' : 'Adicionar'}
              </button>
            )}
            <button className="btn btn--sm btn--perigo" onClick={() => void sair()} disabled={ocupado}>
              Sair do grupo
            </button>
          </>
        )}
      </header>

      <ul className="grupo__lista">
        {conversa.participantes.map((pessoa) => (
          <li key={pessoa.id} className="grupo__pessoa">
            <Avatar nome={pessoa.nome} fotoMidiaId={pessoa.fotoMidiaId} classe="escolha-pessoa__avatar" />
            <span className="escolha-pessoa__texto">
              <strong>
                {pessoa.nome}
                {pessoa.id === euId && ' (você)'}
              </strong>
              <small>{pessoa.ehDp ? 'Departamento Pessoal' : (pessoa.setor ?? 'Sem setor')}</small>
            </span>
            {souAdmin && pessoa.id !== euId && (
              <button className="btn btn--sm" onClick={() => void remover(pessoa.id)} disabled={ocupado}>
                Remover
              </button>
            )}
          </li>
        ))}
      </ul>

      {adicionando && (
        <ul className="grupo__lista grupo__lista--adicionar">
          {deFora.length === 0 && <li className="escolha-pessoas__vazio">Todo mundo já está no grupo.</li>}
          {deFora.map((pessoa) => (
            <li key={pessoa.id} className="grupo__pessoa">
              <Avatar nome={pessoa.nome} fotoMidiaId={pessoa.fotoMidiaId} classe="escolha-pessoa__avatar" />
              <span className="escolha-pessoa__texto">
                <strong>{pessoa.nome}</strong>
                <small>{pessoa.ehDp ? 'Departamento Pessoal' : (pessoa.setor ?? 'Sem setor')}</small>
              </span>
              <button
                className="btn btn--primary btn--sm"
                onClick={() => void adicionar(pessoa.id)}
                disabled={ocupado}
              >
                Adicionar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
