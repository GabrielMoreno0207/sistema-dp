import { useCallback, useEffect, useRef, useState } from 'react';

interface Regra {
  id: string;
  sector: string | null;
  content: string;
  active: boolean;
}

/** Campos que o servidor troca no texto da resposta automática (ver renderAutoReply no backend) */
const CAMPOS_RESPOSTA = [
  { campo: '{primeiro_nome}', descricao: 'Primeiro nome do funcionário' },
  { campo: '{funcionario}', descricao: 'Nome completo do funcionário' },
  { campo: '{setor}', descricao: 'Setor do funcionário' },
  { campo: '{nome_dp}', descricao: 'Seu nome, sem o (RH)' },
];

interface PreferenciasConversa {
  podeRestringir: boolean;
  mensagensSoDpTi: boolean;
}

interface UsuarioDp {
  id: string;
  username: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  superAdmin: boolean;
  chatContact: boolean;
}

interface ResumoChat {
  dpUserId: string;
  name: string;
  conversations: number;
  messages: number;
  lastAt: string | null;
}

/**
 * Resposta automática (todo o DP) e, para a conta do TI, os logins do DP com o
 * resumo de conversas de cada um.
 */
export function AjustesDpPage({ ehTi }: { ehTi: boolean }) {
  const [aba, setAba] = useState<'respostas' | 'ti'>('respostas');
  const [regras, setRegras] = useState<Regra[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioDp[]>([]);
  const [resumo, setResumo] = useState<ResumoChat[]>([]);
  const [setores, setSetores] = useState<{ id: string; name: string }[]>([]);
  const [aviso, setAviso] = useState('');
  const [preferencias, setPreferencias] = useState<PreferenciasConversa | null>(null);

  const [setorRegra, setSetorRegra] = useState('');
  const [textoRegra, setTextoRegra] = useState('');
  const textoRegraRef = useRef<HTMLTextAreaElement>(null);
  const [novoUsuario, setNovoUsuario] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  // limpeza: quantos dias manter (vazio = apagar tudo)
  // Vazio = apaga tudo (antes vinha 90 e, num sistema novo, a limpeza não achava nada)
  const [diasComunicados, setDiasComunicados] = useState('');
  const [diasConversas, setDiasConversas] = useState('');
  const [confirmando, setConfirmando] = useState<{ texto: string; acao: () => Promise<void> } | null>(null);

  const carregar = useCallback(async () => {
    const [r, s] = await Promise.all([
      window.dp.adminApi<{ rules: Regra[] }>('GET', '/api/auto-replies'),
      window.dp.adminApi<{ sectors: { id: string; name: string }[] }>('GET', '/api/sectors'),
    ]);
    setRegras(r.dados?.rules ?? []);
    setSetores(s.dados?.sectors ?? []);
    if (!r.ok) setAviso(r.message);

    // Vale para quem está usando o app agora (funcionário do DP/TI ou a conta do DP/TI)
    const p = await window.dp.conversasApi<PreferenciasConversa>('GET', '/api/conversas/preferencias');
    setPreferencias(p.ok ? p.dados : null);

    if (ehTi) {
      const [u, c] = await Promise.all([
        window.dp.adminApi<{ users: UsuarioDp[] }>('GET', '/api/admin/users'),
        window.dp.adminApi<{ summary: ResumoChat[] }>('GET', '/api/admin/chats'),
      ]);
      setUsuarios(u.dados?.users ?? []);
      setResumo(c.dados?.summary ?? []);
    }
  }, [ehTi]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarRegra() {
    const resultado = await window.dp.adminApi('POST', '/api/auto-replies', {
      sector: setorRegra || null,
      content: textoRegra,
      active: true,
    });
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setTextoRegra('');
    await carregar();
  }

  /** Coloca o campo onde está o cursor (ou no fim) e devolve o foco ao texto. */
  function inserirCampo(campo: string) {
    const caixa = textoRegraRef.current;
    const inicio = caixa?.selectionStart ?? textoRegra.length;
    const fim = caixa?.selectionEnd ?? textoRegra.length;
    setTextoRegra(textoRegra.slice(0, inicio) + campo + textoRegra.slice(fim));
    requestAnimationFrame(() => {
      caixa?.focus();
      caixa?.setSelectionRange(inicio + campo.length, inicio + campo.length);
    });
  }

  async function alternarSoDpTi(ativo: boolean) {
    const resultado = await window.dp.conversasApi<PreferenciasConversa>('PUT', '/api/conversas/preferencias', {
      mensagensSoDpTi: ativo,
    });
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setPreferencias(resultado.dados);
    setAviso(ativo ? 'Pronto: só o RH e o TI conseguem mandar mensagem para você.' : 'Pronto: todos voltam a conseguir mandar mensagem para você.');
  }

  async function alternarRegra(regra: Regra) {
    const resultado = await window.dp.adminApi('PUT', `/api/auto-replies/${encodeURIComponent(regra.id)}`, {
      sector: regra.sector,
      content: regra.content,
      active: !regra.active,
    });
    if (!resultado.ok) setAviso(resultado.message);
    await carregar();
  }

  async function apagarRegra(regra: Regra) {
    const resultado = await window.dp.adminApi('DELETE', `/api/auto-replies/${encodeURIComponent(regra.id)}`);
    if (!resultado.ok) setAviso(resultado.message);
    await carregar();
  }

  async function criarUsuario() {
    const resultado = await window.dp.adminApi('POST', '/api/admin/users', {
      username: novoUsuario,
      name: novoNome,
      password: novaSenha,
    });
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setNovoUsuario('');
    setNovoNome('');
    setNovaSenha('');
    setAviso('Login criado. A pessoa troca a senha no primeiro acesso.');
    await carregar();
  }

  /** Apaga comunicados antigos (ou todos, com o campo vazio). */
  async function limparComunicados() {
    const dias = diasComunicados.trim() === '' ? null : Number(diasComunicados);
    const resultado = await window.dp.adminApi<{ removed: number }>('POST', '/api/admin/messages/purge', {
      olderThanDays: dias,
    });
    const removidos = resultado.dados?.removed ?? 0;
    setAviso(
      !resultado.ok
        ? resultado.message
        : removidos === 0 && dias
          ? `Nenhum comunicado com mais de ${dias} dias. Para apagar todos, deixe o campo vazio.`
          : `${removidos} comunicado(s) apagado(s).`,
    );
    await carregar();
  }

  /** Apaga conversas antigas do chat com o DP (o conteúdo nunca aparece aqui). */
  async function limparConversas() {
    const dias = diasConversas.trim() === '' ? null : Number(diasConversas);
    const resultado = await window.dp.adminApi<{ removed: number }>('POST', '/api/admin/chats/purge', {
      dpUserId: null,
      olderThanDays: dias,
    });
    const removidas = resultado.dados?.removed ?? 0;
    setAviso(
      !resultado.ok
        ? resultado.message
        : removidas === 0 && dias
          ? `Nenhuma mensagem com mais de ${dias} dias. Para apagar todas as conversas, deixe o campo vazio.`
          : dias
            ? `${removidas} mensagem(ns) de conversa apagada(s).`
            : `Todas as conversas foram apagadas (${removidas} mensagens).`,
    );
    await carregar();
  }

  async function limparConversasDe(usuarioId: string, nome: string) {
    const resultado = await window.dp.adminApi<{ removed: number }>('POST', '/api/admin/chats/purge', {
      dpUserId: usuarioId,
      olderThanDays: null,
    });
    setAviso(resultado.ok ? `Conversas de ${nome} apagadas (${resultado.dados?.removed ?? 0} mensagens).` : resultado.message);
    await carregar();
  }

  async function alternarUsuario(usuario: UsuarioDp) {
    const resultado = await window.dp.adminApi('PATCH', `/api/admin/users/${usuario.id}`, {
      status: usuario.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    });
    if (!resultado.ok) setAviso(resultado.message);
    await carregar();
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Ajustes</h1>
          <p className="page__subtitle">Resposta automática do chat{ehTi ? ' e administração do TI.' : '.'}</p>
        </div>
        {ehTi && (
          <div className="login-card__abas abas--linha">
            <button className={`login-aba ${aba === 'respostas' ? 'login-aba--ativa' : ''}`} onClick={() => setAba('respostas')}>
              Resposta automática
            </button>
            <button className={`login-aba ${aba === 'ti' ? 'login-aba--ativa' : ''}`} onClick={() => setAba('ti')}>
              Logins do DP
            </button>
          </div>
        )}
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      {preferencias?.podeRestringir && (
        <div className="cartao formulario">
          <h2 className="formulario__titulo">Minhas mensagens</h2>
          <label className="caixa-marcar">
            <input
              type="checkbox"
              checked={preferencias.mensagensSoDpTi}
              onChange={(e) => void alternarSoDpTi(e.target.checked)}
            />
            <span>
              Receber mensagens só do DP e do TI
              <small className="page__subtitle">
                Os demais funcionários deixam de ver você na lista de contatos, não conseguem escrever para você nem
                colocar você em grupos. Conversas antigas continuam no histórico.
              </small>
            </span>
          </label>
        </div>
      )}

      {(aba === 'respostas' || !ehTi) && (
        <>
          <div className="cartao formulario">
            <h2 className="formulario__titulo">Nova resposta automática</h2>
            <p className="page__subtitle">Enviada quando o funcionário escreve para você e ainda não houve resposta.</p>
            <label htmlFor="regra-setor">Setor</label>
            <select id="regra-setor" value={setorRegra} onChange={(e) => setSetorRegra(e.target.value)}>
              <option value="">Todos os setores</option>
              {setores.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
            <label htmlFor="regra-texto">Texto</label>
            <textarea
              id="regra-texto"
              ref={textoRegraRef}
              rows={3}
              maxLength={1000}
              placeholder="Ex.: Olá, {primeiro_nome}! Recebi sua mensagem e respondo assim que possível."
              value={textoRegra}
              onChange={(e) => setTextoRegra(e.target.value)}
            />
            <div className="campos-texto">
              <span className="campos-texto__rotulo">Inserir no texto:</span>
              {CAMPOS_RESPOSTA.map(({ campo, descricao }) => (
                <button key={campo} type="button" className="campos-texto__campo" title={descricao} onClick={() => inserirCampo(campo)}>
                  {campo}
                </button>
              ))}
            </div>
            <div className="formulario__acoes">
              <button className="botao botao--primario" onClick={() => void salvarRegra()} disabled={!textoRegra.trim()}>
                Salvar
              </button>
            </div>
          </div>

          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Setor</th>
                  <th>Texto</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {regras.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="tabela__vazia">
                      Nenhuma resposta automática cadastrada.
                    </td>
                  </tr>
                ) : (
                  regras.map((regra) => (
                    <tr key={regra.id}>
                      <td>{regra.sector ?? 'Todos os setores'}</td>
                      <td>{regra.content}</td>
                      <td>{regra.active ? 'Ativa' : 'Desligada'}</td>
                      <td className="tabela__acoes">
                        <button className="link-btn" onClick={() => void alternarRegra(regra)}>
                          {regra.active ? 'desligar' : 'ligar'}
                        </button>
                        <button className="link-btn link-btn--perigo" onClick={() => void apagarRegra(regra)}>
                          excluir
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ehTi && aba === 'ti' && (
        <>
          <div className="cartao formulario">
            <h2 className="formulario__titulo">Novo login do RH</h2>
            <div className="formulario__linha">
              <div>
                <label htmlFor="dp-usuario-novo">Usuário</label>
                <input id="dp-usuario-novo" value={novoUsuario} onChange={(e) => setNovoUsuario(e.target.value)} />
              </div>
              <div>
                <label htmlFor="dp-nome-novo">Nome</label>
                <input id="dp-nome-novo" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
              </div>
              <div>
                <label htmlFor="dp-senha-nova">Senha inicial</label>
                <input id="dp-senha-nova" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
              </div>
            </div>
            <div className="formulario__acoes">
              <button
                className="botao botao--primario"
                onClick={() => void criarUsuario()}
                disabled={!novoUsuario.trim() || !novoNome.trim() || novaSenha.length < 8}
              >
                Criar login
              </button>
            </div>
          </div>

          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Nome</th>
                  <th>Tipo</th>
                  <th>Situação</th>
                  <th>Conversas</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((usuario) => {
                  const dados = resumo.find((r) => r.dpUserId === usuario.id);
                  return (
                    <tr key={usuario.id}>
                      <td>{usuario.username}</td>
                      <td>{usuario.name}</td>
                      <td>{usuario.superAdmin ? 'TI' : 'RH'}</td>
                      <td>{usuario.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</td>
                      <td>{dados ? `${dados.conversations} conversas · ${dados.messages} mensagens` : '—'}</td>
                      <td className="tabela__acoes">
                        <button className="link-btn" onClick={() => void alternarUsuario(usuario)}>
                          {usuario.status === 'ACTIVE' ? 'desativar' : 'ativar'}
                        </button>
                        {dados && dados.messages > 0 && (
                          <button
                            className="link-btn link-btn--perigo"
                            onClick={() =>
                              setConfirmando({
                                texto: `Apagar todas as conversas de ${usuario.name}? São ${dados.messages} mensagens, e não dá para desfazer.`,
                                acao: () => limparConversasDe(usuario.id, usuario.name),
                              })
                            }
                          >
                            apagar conversas
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="cartao formulario">
            <h2 className="formulario__titulo">Limpeza de dados</h2>
            <p className="page__subtitle">
              Apaga o que já passou do prazo. Deixe o campo vazio para apagar tudo. Não dá para desfazer.
            </p>

            <div className="formulario__linha">
              <div>
                <label htmlFor="limpeza-comunicados">Apagar comunicados com mais de (dias)</label>
                <input
                  id="limpeza-comunicados"
                  value={diasComunicados}
                  placeholder="vazio = todos"
                  inputMode="numeric"
                  onChange={(e) => setDiasComunicados(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <button
                className="botao botao--perigo"
                onClick={() =>
                  setConfirmando({
                    texto:
                      diasComunicados.trim() === ''
                        ? 'Apagar TODOS os comunicados e as leituras? Não dá para desfazer.'
                        : `Apagar comunicados com mais de ${diasComunicados} dias? Não dá para desfazer.`,
                    acao: limparComunicados,
                  })
                }
              >
                Apagar comunicados
              </button>
            </div>

            <div className="formulario__linha">
              <div>
                <label htmlFor="limpeza-conversas">Apagar conversas com mais de (dias)</label>
                <input
                  id="limpeza-conversas"
                  value={diasConversas}
                  placeholder="vazio = todas"
                  inputMode="numeric"
                  onChange={(e) => setDiasConversas(e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              <button
                className="botao botao--perigo"
                onClick={() =>
                  setConfirmando({
                    texto:
                      diasConversas.trim() === ''
                        ? 'Apagar TODAS as conversas do chat? Não dá para desfazer.'
                        : `Apagar conversas com mais de ${diasConversas} dias? Não dá para desfazer.`,
                    acao: limparConversas,
                  })
                }
              >
                Apagar conversas
              </button>
            </div>
          </div>
        </>
      )}

      {confirmando && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setConfirmando(null)}>
          <div className="modal__caixa modal__caixa--estreita" onClick={(evento) => evento.stopPropagation()}>
            <h2 className="modal__titulo">Confirmar</h2>
            <p>{confirmando.texto}</p>
            <footer className="modal__rodape">
              <span className="modal__espaco" />
              <button className="botao" onClick={() => setConfirmando(null)}>
                Cancelar
              </button>
              <button
                className="botao botao--perigo"
                onClick={async () => {
                  const acao = confirmando.acao;
                  setConfirmando(null);
                  await acao();
                }}
              >
                Apagar
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
