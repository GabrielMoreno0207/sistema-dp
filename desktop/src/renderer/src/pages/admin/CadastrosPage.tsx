import { useCallback, useEffect, useState } from 'react';
import { quando } from '../../components/chamados-comuns';

interface Funcionario {
  id: string;
  name: string;
  registration: string;
  sector: string | null;
  shift: string | null;
  /** Acesso que o setor dá: quem é do DP ou do TI usa as telas de administração */
  acessoAdmin?: 'NENHUM' | 'DP' | 'TI';
  status: 'ACTIVE' | 'INACTIVE';
}

interface Setor {
  id: string;
  name: string;
  employeeCount: number;
}

interface Computador {
  computerId: string;
  hostname: string;
  status: 'ONLINE' | 'OFFLINE';
  lastSeenAt: string;
  appVersion: string;
  currentUserId: string | null;
  /** Último IP de onde o aparelho se conectou (servidor 1.9.0+) */
  ip?: string | null;
}

type Aba = 'funcionarios' | 'setores' | 'dispositivos';

/** Funcionários, setores e computadores, as três listas de cadastro da Central. */
export function CadastrosPage() {
  const [aba, setAba] = useState<Aba>('funcionarios');
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [computadores, setComputadores] = useState<Computador[]>([]);
  const [aviso, setAviso] = useState('');

  // formulário de funcionário
  const [nome, setNome] = useState('');
  const [matricula, setMatricula] = useState('');
  const [setor, setSetor] = useState('');
  const [turno, setTurno] = useState('');
  const [senha, setSenha] = useState('');
  const [novoSetor, setNovoSetor] = useState('');

  const carregar = useCallback(async () => {
    const [f, s, c] = await Promise.all([
      window.dp.adminApi<{ employees: Funcionario[] }>('GET', '/api/employees'),
      window.dp.adminApi<{ sectors: Setor[] }>('GET', '/api/sectors'),
      window.dp.adminApi<{ computers: Computador[] }>('GET', '/api/computers'),
    ]);
    setFuncionarios(f.dados?.employees ?? []);
    setSetores(s.dados?.sectors ?? []);
    setComputadores(c.dados?.computers ?? []);
    const erro = [f, s, c].find((r) => !r.ok);
    setAviso(erro ? erro.message : '');
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criarFuncionario() {
    const resultado = await window.dp.adminApi('POST', '/api/employees', {
      name: nome,
      registration: matricula,
      sector: setor || null,
      shift: turno || null,
      password: senha,
    });
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setNome('');
    setMatricula('');
    setSenha('');
    setAviso(`${nome} cadastrado.`);
    await carregar();
  }

  async function alternarStatus(funcionario: Funcionario) {
    const resultado = await window.dp.adminApi('PATCH', `/api/employees/${encodeURIComponent(funcionario.id)}`, {
      status: funcionario.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    });
    if (!resultado.ok) setAviso(resultado.message);
    await carregar();
  }

  async function redefinirSenha(funcionario: Funcionario) {
    const nova = `Dp-${Math.random().toString(36).slice(2, 8)}-${new Date().getFullYear()}`;
    const resultado = await window.dp.adminApi('POST', `/api/employees/${encodeURIComponent(funcionario.id)}/password`, {
      password: nova,
    });
    setAviso(
      resultado.ok
        ? `Senha de ${funcionario.name} redefinida para: ${nova} (ele troca no próximo acesso)`
        : resultado.message,
    );
  }

  async function excluirFuncionario(funcionario: Funcionario) {
    const resultado = await window.dp.adminApi('DELETE', `/api/employees/${encodeURIComponent(funcionario.id)}`);
    if (!resultado.ok) setAviso(resultado.message);
    await carregar();
  }

  async function criarSetor() {
    const resultado = await window.dp.adminApi('POST', '/api/sectors', { name: novoSetor });
    if (!resultado.ok) {
      setAviso(resultado.message);
      return;
    }
    setNovoSetor('');
    await carregar();
  }

  async function excluirSetor(alvo: Setor) {
    const resultado = await window.dp.adminApi('DELETE', `/api/sectors/${encodeURIComponent(alvo.id)}`);
    if (!resultado.ok) setAviso(resultado.message);
    await carregar();
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Cadastros</h1>
          <p className="page__subtitle">Funcionários, setores e aparelhos (computadores e celulares) registrados.</p>
        </div>
        <div className="login-card__abas abas--linha">
          <button className={`login-aba ${aba === 'funcionarios' ? 'login-aba--ativa' : ''}`} onClick={() => setAba('funcionarios')}>
            Funcionários ({funcionarios.length})
          </button>
          <button className={`login-aba ${aba === 'setores' ? 'login-aba--ativa' : ''}`} onClick={() => setAba('setores')}>
            Setores ({setores.length})
          </button>
          <button className={`login-aba ${aba === 'dispositivos' ? 'login-aba--ativa' : ''}`} onClick={() => setAba('dispositivos')}>
            Aparelhos ({computadores.length})
          </button>
        </div>
      </header>

      {aviso && <p className="aviso-em-breve">{aviso}</p>}

      {aba === 'funcionarios' && (
        <>
          <div className="cartao formulario">
            <h2 className="formulario__titulo">Cadastrar funcionário</h2>
            <div className="formulario__linha">
              <div>
                <label htmlFor="func-nome">Nome</label>
                <input id="func-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div>
                <label htmlFor="func-matricula">Usuário</label>
                <input id="func-matricula" value={matricula} onChange={(e) => setMatricula(e.target.value)} />
              </div>
            </div>
            <div className="formulario__linha">
              <div>
                <label htmlFor="func-setor">Setor</label>
                <select id="func-setor" value={setor} onChange={(e) => setSetor(e.target.value)}>
                  <option value="">Sem setor</option>
                  {setores.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="func-turno">Turno</label>
                <input id="func-turno" value={turno} placeholder="Ex.: Manhã" onChange={(e) => setTurno(e.target.value)} />
              </div>
              <div>
                <label htmlFor="func-senha">Senha inicial</label>
                <input id="func-senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
              </div>
            </div>
            <div className="formulario__acoes">
              <button
                className="botao botao--primario"
                onClick={() => void criarFuncionario()}
                disabled={!nome.trim() || !matricula.trim() || senha.length < 8}
              >
                Cadastrar
              </button>
            </div>
          </div>

          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Usuário</th>
                  <th>Setor</th>
                  <th>Turno</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {funcionarios.map((funcionario) => (
                  <tr key={funcionario.id}>
                    <td>{funcionario.name}</td>
                    <td>{funcionario.registration}</td>
                    <td>
                      {funcionario.sector ?? '—'}
                      {funcionario.acessoAdmin && funcionario.acessoAdmin !== 'NENHUM' && (
                        <span
                          className="etiqueta etiqueta--solta"
                          title={
                            funcionario.acessoAdmin === 'TI'
                              ? 'Este setor dá acesso às telas do DP e do TI'
                              : 'Este setor dá acesso às telas do Departamento Pessoal'
                          }
                        >
                          acesso {funcionario.acessoAdmin}
                        </span>
                      )}
                    </td>
                    <td>{funcionario.shift ?? '—'}</td>
                    <td>{funcionario.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</td>
                    <td className="tabela__acoes">
                      <button className="link-btn" onClick={() => void alternarStatus(funcionario)}>
                        {funcionario.status === 'ACTIVE' ? 'desativar' : 'ativar'}
                      </button>
                      <button className="link-btn" onClick={() => void redefinirSenha(funcionario)}>
                        nova senha
                      </button>
                      <button className="link-btn link-btn--perigo" onClick={() => void excluirFuncionario(funcionario)}>
                        excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === 'setores' && (
        <>
          <p className="page__subtitle aviso-setores">
            Quem estiver nos setores <strong>Departamento Pessoal</strong> (ou "DP") e <strong>TI</strong> usa as telas
            de administração com o próprio login do aplicativo — o do DP abre Comunicados, Mural, Cadastros e Ajustes;
            o do TI abre também a Fila e as Conversas. Qualquer outro nome de setor não dá acesso nenhum.
          </p>

          <div className="cartao formulario">
            <label htmlFor="setor-novo">Novo setor</label>
            <div className="formulario__linha">
              <input id="setor-novo" value={novoSetor} onChange={(e) => setNovoSetor(e.target.value)} />
              <button className="botao botao--primario" onClick={() => void criarSetor()} disabled={!novoSetor.trim()}>
                Cadastrar
              </button>
            </div>
          </div>

          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Setor</th>
                  <th>Funcionários</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {setores.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.employeeCount}</td>
                    <td className="tabela__acoes">
                      <button className="link-btn link-btn--perigo" onClick={() => void excluirSetor(s)}>
                        excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {aba === 'dispositivos' && (
        <>
          <TabelaAparelhos
            titulo="Computadores"
            aparelhos={computadores.filter((c) => !c.computerId.startsWith('CEL-'))}
            onCopiado={setAviso}
          />
          <TabelaAparelhos
            titulo="Celulares"
            aparelhos={computadores.filter((c) => c.computerId.startsWith('CEL-'))}
            onCopiado={setAviso}
          />
        </>
      )}
    </div>
  );
}

/** Uma lista de aparelhos (computadores ou celulares), com o IP e o botão de copiar. */
function TabelaAparelhos({
  titulo,
  aparelhos,
  onCopiado,
}: {
  titulo: string;
  aparelhos: Computador[];
  onCopiado(aviso: string): void;
}) {
  async function copiar(ip: string) {
    const resultado = await window.dp.copiarTexto(ip);
    onCopiado(resultado.ok ? `IP ${ip} copiado.` : resultado.message);
  }

  const online = aparelhos.filter((a) => a.status === 'ONLINE').length;
  return (
    <section className="aparelhos">
      <h2 className="aparelhos__titulo">
        {titulo} <span className="aparelhos__contagem">{aparelhos.length} · {online} online</span>
      </h2>
      <div className="tabela-caixa">
        <table className="tabela">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Identificador</th>
              <th>IP</th>
              <th>Situação</th>
              <th>Versão</th>
              <th>Visto por último</th>
            </tr>
          </thead>
          <tbody>
            {aparelhos.length === 0 ? (
              <tr>
                <td colSpan={6} className="tabela__vazia">
                  Nenhum {titulo === 'Celulares' ? 'celular' : 'computador'} registrado.
                </td>
              </tr>
            ) : (
              aparelhos.map((aparelho) => (
                <tr key={aparelho.computerId}>
                  <td>{aparelho.hostname}</td>
                  <td>{aparelho.computerId}</td>
                  <td>
                    {aparelho.ip ? (
                      <span className="aparelhos__ip">
                        <code>{aparelho.ip}</code>
                        <button className="link-btn" onClick={() => void copiar(aparelho.ip!)} title="Copiar o IP">
                          copiar
                        </button>
                      </span>
                    ) : (
                      <span className="aparelhos__sem-ip">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`ponto ${aparelho.status === 'ONLINE' ? 'ponto--online' : ''}`} aria-hidden />
                    {aparelho.status === 'ONLINE' ? 'Online' : 'Offline'}
                  </td>
                  <td>{aparelho.appVersion}</td>
                  <td>{quando(aparelho.lastSeenAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
