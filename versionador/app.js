// Tela do versionador: entra com a conta do TI, publica e lista versões.
const api = window.versionador;

const el = (id) => document.getElementById(id);
const telaLogin = el('tela-login');
const telaPrincipal = el('tela-principal');

let alvo = 'desktop';
let arquivo = null;

function servidor() {
  return el('servidor').value.trim().replace(/\/+$/, '');
}

function mostrarAviso(texto, ok = false) {
  const aviso = el('aviso');
  aviso.textContent = texto;
  aviso.classList.toggle('ok', ok);
}

function tamanhoLegivel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function dataLegivel(iso) {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? iso : data.toLocaleString('pt-BR');
}

/** Tira a versão do nome do arquivo (ComunicacaoDP-Setup-1.5.0.exe -> 1.5.0). */
function versaoDoNome(nome) {
  const achado = nome.match(/(\d{1,4}\.\d{1,4}\.\d{1,4})/);
  return achado ? achado[1] : '';
}

// ---------------------------------------------------------------- entrada

async function iniciar() {
  const config = await api.lerConfig();
  el('servidor').value = config.servidor;
  el('usuario').value = config.usuario;
  (config.usuario ? el('senha') : el('usuario')).focus();
}

async function entrar() {
  const erro = el('erro-login');
  erro.textContent = '';
  const usuario = el('usuario').value.trim();
  const senha = el('senha').value;
  if (!servidor() || !usuario || !senha) {
    erro.textContent = 'Preencha servidor, usuário e senha.';
    return;
  }

  el('btn-entrar').disabled = true;
  try {
    const resultado = await api.entrar({ servidor: servidor(), usuario, senha });
    if (!resultado.ok) {
      erro.textContent = resultado.erro;
      return;
    }
    el('quem').textContent = `● ${resultado.nome}`;
    el('onde').textContent = servidor();
    el('senha').value = '';
    telaLogin.hidden = true;
    telaPrincipal.hidden = false;
    await carregarLista();
  } catch (err) {
    erro.textContent = `Não consegui falar com o servidor: ${err.message}`;
  } finally {
    el('btn-entrar').disabled = false;
  }
}

async function sair() {
  await api.sair();
  telaPrincipal.hidden = true;
  telaLogin.hidden = false;
  el('senha').focus();
}

// ---------------------------------------------------------------- lista

async function carregarLista() {
  const lista = el('lista');
  lista.textContent = 'carregando…';
  const resultado = await api.listar({ servidor: servidor(), alvo });

  lista.innerHTML = '';
  if (!resultado.ok) {
    const erro = document.createElement('p');
    erro.className = 'vazio';
    erro.textContent = resultado.erro;
    lista.append(erro);
    return;
  }
  if (resultado.releases.length === 0) {
    const vazio = document.createElement('p');
    vazio.className = 'vazio';
    vazio.textContent = `nenhuma versão publicada para ${alvo}`;
    lista.append(vazio);
    return;
  }

  resultado.releases.forEach((release, indice) => {
    const item = document.createElement('div');
    item.className = 'item';

    const versao = document.createElement('span');
    versao.className = 'versao';
    versao.textContent = release.versao;

    const detalhe = document.createElement('div');
    detalhe.className = 'detalhe';

    const cabecalho = document.createElement('div');
    cabecalho.className = 'apagado';
    cabecalho.textContent =
      `${dataLegivel(release.publicadoEm)} · ${tamanhoLegivel(release.tamanho)} · ${release.publicadoPor}` +
      (indice === 0 ? ' · em distribuição' : '');
    detalhe.append(cabecalho);

    if (release.obrigatoria) {
      const etiqueta = document.createElement('span');
      etiqueta.className = 'etiqueta';
      etiqueta.textContent = 'obrigatória';
      cabecalho.append(' ', etiqueta);
    }
    if (release.notas) {
      const notas = document.createElement('div');
      notas.className = 'notas';
      notas.textContent = release.notas;
      detalhe.append(notas);
    }

    const remover = document.createElement('button');
    remover.className = 'link';
    remover.textContent = 'tirar do ar';
    remover.addEventListener('click', async () => {
      const saida = await api.remover({ servidor: servidor(), alvo, versao: release.versao });
      if (saida.cancelado) return;
      if (!saida.ok) {
        mostrarAviso(saida.erro);
        return;
      }
      mostrarAviso(`Versão ${release.versao} retirada do ar.`, true);
      await carregarLista();
    });

    item.append(versao, detalhe, remover);
    lista.append(item);
  });
}

// ---------------------------------------------------------------- publicação

async function escolherArquivo() {
  const escolhido = await api.escolherArquivo(alvo);
  if (!escolhido) return;
  arquivo = escolhido;
  el('arquivo-escolhido').textContent = `${escolhido.nome} (${tamanhoLegivel(escolhido.tamanho)})`;
  if (!el('versao').value) el('versao').value = versaoDoNome(escolhido.nome);
}

async function publicar() {
  if (!arquivo) {
    mostrarAviso('Escolha antes o arquivo da nova versão.');
    return;
  }
  const versao = el('versao').value.trim();
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(versao)) {
    mostrarAviso('A versão precisa estar no formato 1.2.3.');
    return;
  }

  el('btn-publicar').disabled = true;
  mostrarAviso('enviando…');
  try {
    const resultado = await api.publicar({
      servidor: servidor(),
      alvo,
      caminho: arquivo.caminho,
      versao,
      notas: el('notas').value,
      obrigatoria: el('obrigatoria').checked,
    });
    if (!resultado.ok) {
      mostrarAviso(resultado.erro);
      return;
    }
    mostrarAviso(`Versão ${versao} publicada. Os aplicativos recebem na próxima verificação.`, true);
    arquivo = null;
    el('arquivo-escolhido').textContent = 'nenhum arquivo escolhido';
    el('versao').value = '';
    el('notas').value = '';
    el('obrigatoria').checked = false;
    el('progresso').textContent = '';
    await carregarLista();
  } finally {
    el('btn-publicar').disabled = false;
  }
}

// ---------------------------------------------------------------- ligações da tela

el('btn-entrar').addEventListener('click', entrar);
el('senha').addEventListener('keydown', (evento) => evento.key === 'Enter' && entrar());
el('btn-sair').addEventListener('click', sair);
el('btn-arquivo').addEventListener('click', escolherArquivo);
el('btn-publicar').addEventListener('click', publicar);

document.querySelectorAll('.aba').forEach((aba) => {
  aba.addEventListener('click', async () => {
    document.querySelectorAll('.aba').forEach((outra) => outra.classList.remove('ativa'));
    aba.classList.add('ativa');
    alvo = aba.dataset.alvo;
    arquivo = null;
    el('arquivo-escolhido').textContent = 'nenhum arquivo escolhido';
    mostrarAviso('');
    await carregarLista();
  });
});

api.aoProgredir((porcentagem) => {
  el('progresso').textContent = porcentagem >= 100 ? 'processando no servidor…' : `enviando ${porcentagem}%`;
});

iniciar();
