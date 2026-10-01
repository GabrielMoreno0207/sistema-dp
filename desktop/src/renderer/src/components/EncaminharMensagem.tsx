import { useMemo, useState } from 'react';
import type { ConversaResumo, MensagemConversa, Participante } from '../../../shared/types';
import { Avatar, outraPessoa, tamanhoLegivel } from './conversa-comuns';

interface EncaminharProps {
  mensagem: MensagemConversa;
  /** Conversas e grupos que já existem */
  conversas: ConversaResumo[];
  /** Todo mundo com quem dá para falar (para quem ainda não tem conversa) */
  contatos: Participante[];
  meuId: string;
  onFechar(): void;
  /** Quantos destinos receberam (a tela avisa e recarrega a lista) */
  onEncaminhada(quantos: number): void;
}

type Destino = { chave: string; nome: string; detalhe: string; conversaId?: string; pessoaId?: string; grupo: boolean };

/**
 * Repassa uma mensagem (texto ou arquivo) para outras conversas.
 *
 * O arquivo não é copiado: a mensagem nova aponta para a mesma mídia, e chega
 * com a etiqueta "encaminhada" para quem recebe saber que veio de outro lugar.
 */
export function EncaminharMensagem({
  mensagem,
  conversas,
  contatos,
  meuId,
  onFechar,
  onEncaminhada,
}: EncaminharProps) {
  const [busca, setBusca] = useState('');
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const destinos = useMemo<Destino[]>(() => {
    const comConversa = new Set<string>();
    const lista: Destino[] = [];

    for (const conversa of conversas) {
      const outro = outraPessoa(conversa, meuId);
      if (outro) comConversa.add(outro.id);
      lista.push({
        chave: `conversa:${conversa.id}`,
        nome: conversa.titulo,
        detalhe: conversa.tipo === 'GRUPO' ? `${conversa.participantes.length} participantes` : 'Conversa',
        conversaId: conversa.id,
        grupo: conversa.tipo === 'GRUPO',
      });
    }

    for (const pessoa of contatos) {
      if (comConversa.has(pessoa.id)) continue;
      lista.push({
        chave: `pessoa:${pessoa.id}`,
        nome: pessoa.nome,
        detalhe: pessoa.ehDp ? 'RH' : (pessoa.setor ?? 'Sem setor'),
        pessoaId: pessoa.id,
        grupo: false,
      });
    }
    return lista;
  }, [conversas, contatos, meuId]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return destinos;
    return destinos.filter((d) => d.nome.toLowerCase().includes(termo) || d.detalhe.toLowerCase().includes(termo));
  }, [busca, destinos]);

  function alternar(chave: string) {
    setEscolhidos((atual) => (atual.includes(chave) ? atual.filter((x) => x !== chave) : [...atual, chave]));
  }

  async function encaminhar() {
    if (escolhidos.length === 0 || enviando) return;
    setEnviando(true);
    setErro('');

    let enviadas = 0;
    for (const chave of escolhidos) {
      const destino = destinos.find((d) => d.chave === chave);
      if (!destino) continue;

      let conversaId = destino.conversaId;
      if (!conversaId && destino.pessoaId) {
        // Ainda não havia conversa com essa pessoa: abre uma
        const aberta = await window.dp.conversasApi<ConversaResumo>('POST', '/api/conversas/direta', {
          comUsuarioId: destino.pessoaId,
        });
        if (!aberta.ok || !aberta.dados) {
          setErro(aberta.message || `Não consegui abrir a conversa com ${destino.nome}.`);
          continue;
        }
        conversaId = aberta.dados.id;
      }
      if (!conversaId) continue;

      const resposta = await window.dp.conversasApi('POST', `/api/conversas/${conversaId}/mensagens`, {
        conteudo: mensagem.conteudo,
        midiaId: mensagem.midiaId,
        encaminhada: true,
      });
      if (resposta.ok) enviadas += 1;
      else setErro(resposta.message);
    }

    setEnviando(false);
    if (enviadas > 0) onEncaminhada(enviadas);
  }

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__caixa">
        <h2 className="modal__titulo">Encaminhar</h2>

        <div className="encaminhar__previa">
          {mensagem.midia && (
            <span className="encaminhar__arquivo">
              {mensagem.midia.nome} · {tamanhoLegivel(mensagem.midia.tamanho)}
            </span>
          )}
          {mensagem.conteudo && <p>{mensagem.conteudo}</p>}
          <small>De {mensagem.autorNome}</small>
        </div>

        <label className="field">
          <span>Para quem</span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar pessoa ou grupo"
            autoFocus
          />
        </label>

        {erro && <p className="feedback feedback--error">{erro}</p>}

        <ul className="escolha-pessoas">
          {filtrados.length === 0 && <li className="escolha-pessoas__vazio">Ninguém encontrado com esse termo.</li>}
          {filtrados.map((destino) => (
            <li key={destino.chave}>
              <button
                className={`escolha-pessoa ${escolhidos.includes(destino.chave) ? 'escolha-pessoa--marcada' : ''}`}
                onClick={() => alternar(destino.chave)}
                disabled={enviando}
              >
                <Avatar nome={destino.nome} grupo={destino.grupo} classe="escolha-pessoa__avatar" />
                <span className="escolha-pessoa__texto">
                  <strong>{destino.nome}</strong>
                  <small>{destino.detalhe}</small>
                </span>
                {escolhidos.includes(destino.chave) && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>

        <div className="modal__rodape">
          <span className="escolha-pessoas__contagem">
            {escolhidos.length} {escolhidos.length === 1 ? 'destino' : 'destinos'}
          </span>
          <span className="modal__espaco" />
          <button className="btn" onClick={onFechar} disabled={enviando}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            onClick={() => void encaminhar()}
            disabled={escolhidos.length === 0 || enviando}
          >
            {enviando ? 'Encaminhando...' : 'Encaminhar'}
          </button>
        </div>
      </div>
    </div>
  );
}
