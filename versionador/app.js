// Tela do versionador: entra com a conta do TI, publica versões, acompanha
// quem já atualizou e coloca na última quem ficou atrás.
const api = window.versionador;

const el = (id) => document.getElementById(id);
const telaLogin = el('tela-login');
const telaPrincipal = el('tela-principal');

/**
 * Os quatro aplicativos que recebem versão.
 *
 * `prefixo` é como o aparelho se identifica no servidor (PC- para computador,
 * CEL- para celular); o servidor não roda em aparelho nenhum, então fica null.
 */
const APLICATIVOS = {
  desktop: {
    arquivo: 'Instalador do Windows (.exe), de desktop/dist-nova — sai do npm run dist:win.',
    prefixo: 'PC-',
    aparelho: 'computador',
    aparelhos: 'computadores',
  },
  mobile: {
    arquivo: 'APK do Android, de mobile/dist — sai do gerar-apk.cmd. Só quando mudou algo nativo.',
    prefixo: 'CEL-',
    aparelho: 'celular',
    aparelhos: 'celulares',
    // O celular informa a versão em uso, que é a da atualização rápida quando
    // existe uma. Então aqui a comparação é com o JavaScript, não com o APK.
    ressalva: 'O número do celular é o da versão em uso; com atualização rápida instalada ele passa da versão do APK.',
  },
  'mobile-ota': {
    arquivo: 'Atualização rápida (.zip), de mobile/dist — sai do gerar-atualizacao-rapida.cmd. Só o JavaScript.',
    prefixo: 'CEL-',
    aparelho: 'celular',
    aparelhos: 'celulares',
  },
  backend: {
    arquivo: 'Pacote do servidor (.tar.gz), de backend/publicar — sai do npm run empacotar.',
    prefixo: null,
    titulo: 'O servidor',
  },
};

const NOMES = Object.keys(APLICATIVOS);

let alvo = 'desktop';
let arquivo = null;
/** Por aplicativo: { ok, releases, erro } — enche a coluna da esquerda e a lista */
let porApp = {};
/** Todos os aparelhos do servidor; cada aba olha só os que são dela */
let todosAparelhos = [];
let erroAparelhos = null;
/** '' = segue o Windows; 'claro' ou 'escuro' = escolha de quem usa */
let tema = '';

function servidor() {
  return el('servidor').value.trim().replace(/\/+$/, '');
}

/** Versões do aplicativo aberto, da mais nova para a mais antiga. */
function releases() {
  return porApp[alvo]?.releases ?? [];
}

/** Os aparelhos que rodam o aplicativo aberto (PC- para computador, CEL- para celular). */
function aparelhosDoAlvo() {
  const prefixo = APLICATIVOS[alvo].prefixo;
  return prefixo ? todosAparelhos.filter((a) => String(a.computerId).startsWith(prefixo)) : [];
}

function ligado(aparelho) {
  return aparelho.status === 'ONLINE';
}

function ultimaVersao() {
  return releases()[0]?.versao ?? null;
}

function mostrarAviso(texto, tom = '') {
  const aviso = el('aviso');
  aviso.textContent = texto;
  aviso.className = `recado${tom ? ` recado--${tom}` : ''}`;
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

/** "há 4 minutos", "há 2 dias" — para o aparelho que está desligado. */
function quandoLegivel(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  const minutos = Math.round((Date.now() - data.getTime()) / 60000);
  if (minutos < 2) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
}

/** O tema que está valendo agora, resolvendo o "segue o Windows". */
function temaEmUso() {
  if (tema === 'claro' || tema === 'escuro') return tema;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

function aplicarTema() {
  const atual = temaEmUso();
  document.documentElement.dataset.tema = atual;
  // O botão diz para onde vai, não onde está
  el('btn-tema').textContent = atual === 'escuro' ? 'modo claro' : 'modo escuro';
}

async function alternarTema() {
  tema = temaEmUso() === 'escuro' ? 'claro' : 'escuro';
  aplicarTema();
  await api.definirTema(tema);
}

/** Tira a versão do nome do arquivo (ComunicacaoDP-Setup-1.5.0.exe -> 1.5.0). */
function versaoDoNome(nome) {
  const achado = nome.match(/(\d{1,4}\.\d{1,4}\.\d{1,4})/);
  return achado ? achado[1] : '';
}

/** 1.57.0 -> 1.58.0. É o passo que o projeto usa entre uma publicação e outra. */
function proximaVersao(versao) {
  const [maior, menor] = String(versao).split('.').map(Number);
  return `${maior || 1}.${(menor || 0) + 1}.0`;
}

/** > 0 se a primeira for maior. Mesma conta do servidor. */
function compararVersoes(a, b) {
  const partesA = String(a).split('.').map(Number);
  const partesB = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diferenca = (partesA[i] || 0) - (partesB[i] || 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

/** "1 computador" / "3 computadores" — sem o "(s)" no meio da frase. */
function plural(quantos, singular, varios) {
  return quantos === 1 ? singular : varios;
}

function criar(tag, classe, texto) {
  const node = document.createElement(tag);
  if (classe) node.className = classe;
  if (texto !== undefined) node.textContent = texto;
  return node;
}

// ---------------------------------------------------------------- entrada

async function iniciar() {
  const config = await api.lerConfig();
  el('servidor').value = config.servidor;
  el('usuario').value = config.usuario;
  tema = config.tema ?? '';
  aplicarTema();
  (config.usuario ? el('senha') : el('usuario')).focus();
}

async function entrar() {
  const erro = el('erro-login');
  erro.textContent = '';
  const usuario = el('usuario').value.trim();
  // Apara igual ao usuário: a senha vem colada da nota e o espaço que vem
  // junto fazia o servidor responder "Usuário ou senha inválidos" (ele apara
  // o usuário, não a senha).
  const senha = el('senha').value.trim();
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
    el('onde').textContent = servidor().replace(/^https?:\/\//, '');
    el('senha').value = '';
    telaLogin.hidden = true;
    telaPrincipal.hidden = false;
    aplicarAlvo();
    await carregarTudo();
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

// ---------------------------------------------------------------- carregar

/**
 * Lê as versões dos quatro aplicativos de uma vez: é o que enche a coluna da
 * esquerda, onde se vê o que está no ar em cada frente sem trocar de aba.
 */
async function carregarTudo() {
  const [resultados, aparelhosDoServidor] = await Promise.all([
    Promise.all(NOMES.map((nome) => api.listar({ servidor: servidor(), alvo: nome }))),
    api.listarAparelhos({ servidor: servidor() }),
  ]);

  porApp = {};
  NOMES.forEach((nome, indice) => {
    const r = resultados[indice];
    porApp[nome] = { ok: r.ok, releases: r.ok ? r.releases : [], erro: r.erro };
    const marca = document.querySelector(`[data-versao="${nome}"]`);
    const ultima = r.ok ? r.releases[0] : null;
    if (!marca) return;
    marca.textContent = !r.ok
      ? 'sem resposta'
      : ultima
        ? `${ultima.versao} · ${quandoLegivel(ultima.publicadoEm)}`
        : 'nada publicado';
  });

  todosAparelhos = aparelhosDoServidor.ok ? aparelhosDoServidor.aparelhos : [];
  erroAparelhos = aparelhosDoServidor.ok ? null : aparelhosDoServidor.erro;

  desenharLista();
  desenharParque();
  conferir();
  await atualizarStatus();
}

/**
 * A faixa de cima: o servidor está de pé, em que versão, há quanto tempo, e
 * quantos aparelhos estão ligados agora.
 */
async function atualizarStatus() {
  const saude = await api.saude({ servidor: servidor() });
  const campo = el('status-servidor');
  campo.textContent = saude.ok ? `respondendo · ${saude.ms} ms` : (saude.erro ?? 'sem resposta');
  campo.className = `status__valor ${saude.ok ? 'status__valor--ok' : 'status__valor--ruim'}`;

  // Servidor antigo não informa a versão: aí vale a última publicada
  el('status-versao').textContent = saude.versao ?? porApp.backend?.releases[0]?.versao ?? '—';
  el('status-desde').textContent = saude.desde ? quandoLegivel(saude.desde).replace(/^há /, '') : '—';

  const conta = (prefixo) => {
    const lista = todosAparelhos.filter((a) => String(a.computerId).startsWith(prefixo));
    return lista.length === 0 ? 'nenhum' : `${lista.filter(ligado).length} de ${lista.length} ligados`;
  };
  el('status-pcs').textContent = erroAparelhos ? '—' : conta('PC-');
  el('status-celulares').textContent = erroAparelhos ? '—' : conta('CEL-');
}

function desenharParque() {
  const info = APLICATIVOS[alvo];
  const painel = el('parque');
  const aparelhos = aparelhosDoAlvo();
  painel.replaceChildren();

  if (!info.prefixo) {
    painel.append(
      criar(
        'p',
        'parque__legenda',
        'O servidor não é instalado em aparelho nenhum: publicar o pacote já aplica a versão nele e reinicia.',
      ),
    );
    return;
  }
  if (erroAparelhos) {
    painel.append(criar('p', 'parque__legenda', erroAparelhos));
    return;
  }

  const ultima = ultimaVersao();
  if (!ultima) {
    painel.append(criar('p', 'parque__legenda', 'Nenhuma versão publicada ainda; nada para comparar.'));
    return;
  }
  if (aparelhos.length === 0) {
    painel.append(criar('p', 'parque__legenda', `Nenhum ${info.aparelho} registrado no servidor.`));
    return;
  }

  const emDia = aparelhos.filter((a) => compararVersoes(a.appVersion, ultima) >= 0);
  const atrasados = aparelhos.filter((a) => compararVersoes(a.appVersion, ultima) < 0);
  const atrasadosLigados = atrasados.filter((a) => a.status === 'ONLINE');

  const resumo = criar('div', 'parque__resumo');
  resumo.append(
    criar('span', 'parque__numero', `${emDia.length}/${aparelhos.length}`),
    criar(
      'p',
      'parque__legenda',
      `${plural(aparelhos.length, info.aparelho, info.aparelhos)} na versão ${ultima}`,
    ),
  );
  painel.append(resumo);

  const trilha = criar('div', 'progresso__trilha');
  const barra = criar('span', 'progresso__barra');
  barra.style.width = `${Math.round((emDia.length / aparelhos.length) * 100)}%`;
  trilha.append(barra);
  painel.append(trilha);

  if (atrasados.length === 0) {
    painel.append(criar('p', 'parque__nota', `Todos os ${info.aparelhos} já estão na última versão.`));
  } else {
    const desligados = atrasados.length - atrasadosLigados.length;
    const botao = criar(
      'button',
      'botao botao--empurrar',
      plural(
        atrasados.length,
        `Instalar a ${ultima} no que falta`,
        `Instalar a ${ultima} nos ${atrasados.length} que faltam`,
      ),
    );
    botao.addEventListener('click', () => instalarEmTodos(ultima, atrasados.length, atrasadosLigados.length));
    painel.append(botao);

    const partes = [];
    if (atrasadosLigados.length > 0) {
      partes.push(
        plural(
          atrasadosLigados.length,
          '1 está ligado agora e atualiza em seguida',
          `${atrasadosLigados.length} estão ligados agora e atualizam em seguida`,
        ),
      );
    }
    if (desligados > 0) {
      partes.push(
        plural(
          desligados,
          '1 está desligado e atualiza ao abrir o aplicativo',
          `${desligados} estão desligados e atualizam ao abrir o aplicativo`,
        ),
      );
    }
    painel.append(criar('p', 'parque__nota', `${partes.join('; ')}.`));
  }

  // Atrasados primeiro, e entre eles os ligados: é neles que se mexe
  const ordem = [
    ...atrasadosLigados,
    ...atrasados.filter((a) => a.status !== 'ONLINE'),
    ...emDia,
  ];
  if (info.ressalva) painel.append(criar('p', 'parque__nota', info.ressalva));

  const lista = criar('ul', 'parque__lista');
  for (const aparelho of ordem) {
    const atrasado = compararVersoes(aparelho.appVersion, ultima) < 0;
    const linha = criar('li', 'aparelho');

    const ponto = criar('span', `ponto${aparelho.status === 'ONLINE' ? ' ponto--ligado' : ''}`);
    ponto.title = aparelho.status === 'ONLINE' ? 'ligado agora' : `visto ${quandoLegivel(aparelho.lastSeenAt)}`;

    const texto = criar('div', 'aparelho__texto');
    texto.append(
      criar('span', 'aparelho__nome', aparelho.hostname || aparelho.computerId),
      criar(
        'span',
        'aparelho__quem',
        aparelho.currentUserName
          ? `${aparelho.currentUserName}${aparelho.status === 'ONLINE' ? '' : ` · visto ${quandoLegivel(aparelho.lastSeenAt)}`}`
          : aparelho.status === 'ONLINE'
            ? 'ninguém logado'
            : `desligado · visto ${quandoLegivel(aparelho.lastSeenAt)}`,
      ),
    );

    const versao = criar(
      'span',
      `aparelho__versao ${atrasado ? 'aparelho__versao--atrasada' : 'aparelho__versao--em-dia'}`,
      aparelho.appVersion,
    );

    linha.append(ponto, texto, versao);
    lista.append(linha);
  }
  painel.append(lista);

  desenharEspalhamento(painel, aparelhos, ultima);
}

/**
 * Quantos aparelhos em cada versão. Com um parque espalhado por cinco versões,
 * o "3/11" não conta onde o resto empacou — esta parte conta.
 */
function desenharEspalhamento(painel, aparelhos, ultima) {
  const porVersao = new Map();
  for (const aparelho of aparelhos) {
    porVersao.set(aparelho.appVersion, (porVersao.get(aparelho.appVersion) ?? 0) + 1);
  }
  // Uma versão só: a barra lá de cima já disse tudo
  if (porVersao.size < 2) return;

  painel.append(criar('p', 'parque__rotulo', 'Em que versão cada um está'));
  const grade = criar('div', 'espalhamento');
  const ordenado = [...porVersao.entries()].sort((a, b) => compararVersoes(b[0], a[0]));
  for (const [versao, quantos] of ordenado) {
    const trilha = criar('div', 'espalhamento__trilha');
    const barra = criar('span', `espalhamento__barra${versao === ultima ? ' espalhamento__barra--atual' : ''}`);
    barra.style.width = `${Math.round((quantos / aparelhos.length) * 100)}%`;
    trilha.append(barra);
    grade.append(criar('span', 'espalhamento__versao', versao), trilha, criar('span', 'espalhamento__quantos', String(quantos)));
  }
  painel.append(grade);
}

function desenharLista() {
  const lista = el('lista');
  const aparelhos = aparelhosDoAlvo();
  lista.replaceChildren();
  const dados = porApp[alvo] ?? { ok: false, releases: [], erro: 'nada carregado' };

  if (!dados.ok) {
    lista.append(criar('p', 'vazio', dados.erro ?? 'não consegui listar as versões'));
    el('contagem-versoes').textContent = '';
    return;
  }
  if (dados.releases.length === 0) {
    lista.append(criar('p', 'vazio', 'nenhuma versão publicada para este aplicativo'));
    el('contagem-versoes').textContent = '';
    return;
  }

  // Espaço ocupado: oito instaladores de 107 MB são quase um giga parado lá
  const ocupado = dados.releases.reduce((soma, r) => soma + (r.tamanho ?? 0), 0);
  el('contagem-versoes').textContent =
    `${plural(dados.releases.length, '1 versão', `${dados.releases.length} versões`)} · ` +
    `${tamanhoLegivel(ocupado)} no servidor`;

  dados.releases.forEach((release, indice) => {
    const atual = indice === 0;
    const item = criar('div', `item${atual ? ' item--atual' : ''}`);
    item.append(criar('span', 'versao', release.versao));

    const detalhe = criar('div', 'detalhe');
    const linha = criar('div', 'detalhe__linha');
    if (atual) linha.append(criar('span', 'etiqueta etiqueta--atual', 'em distribuição'));
    if (release.obrigatoria) linha.append(criar('span', 'etiqueta etiqueta--obrigatoria', 'obrigatória'));
    linha.append(
      criar(
        'span',
        null,
        `${dataLegivel(release.publicadoEm)} (${quandoLegivel(release.publicadoEm)}) · ` +
          `${tamanhoLegivel(release.tamanho)} · ${release.publicadoPor}`,
      ),
    );
    detalhe.append(linha);

    // Quantos aparelhos estão nesta versão: mostra onde o parque ficou parado
    const nesta = aparelhos.filter((a) => a.appVersion === release.versao).length;
    if (nesta > 0) {
      const info = APLICATIVOS[alvo];
      linha.append(criar('span', 'contagem', `${nesta} ${nesta === 1 ? info.aparelho : info.aparelhos}`));
    }

    if (release.notas) detalhe.append(criar('div', 'notas', release.notas));
    // O mesmo número que o aplicativo confere depois de baixar, antes de instalar
    if (release.sha256) detalhe.append(criar('div', 'impressao', `sha256 ${release.sha256.slice(0, 24)}…`));
    item.append(detalhe);

    const acoes = criar('div', 'item__acoes');
    const obrigar = criar(
      'button',
      'botao botao--secundario botao--pequeno',
      release.obrigatoria ? 'deixar opcional' : 'tornar obrigatória',
    );
    obrigar.title = release.obrigatoria
      ? 'O aplicativo volta a esperar o computador ficar livre para instalar'
      : 'O aplicativo instala mesmo com alguém usando o computador';
    obrigar.addEventListener('click', () => alternarObrigatoria(release));

    const remover = criar('button', 'botao botao--secundario botao--pequeno botao--perigo', 'tirar do ar');
    remover.addEventListener('click', () => removerVersao(release));

    acoes.append(obrigar, remover);
    item.append(acoes);
    lista.append(item);
  });
}

// ---------------------------------------------------------------- ações na lista

async function alternarObrigatoria(release) {
  const resultado = await api.marcarObrigatoria({
    servidor: servidor(),
    alvo,
    versao: release.versao,
    obrigatoria: !release.obrigatoria,
  });
  if (!resultado.ok) {
    mostrarAviso(resultado.erro, 'erro');
    return;
  }
  mostrarAviso(
    release.obrigatoria
      ? `A versão ${release.versao} voltou a ser opcional.`
      : `A versão ${release.versao} agora é obrigatória: instala mesmo com alguém usando o computador.`,
    'ok',
  );
  await carregarTudo();
}

async function removerVersao(release) {
  const saida = await api.remover({ servidor: servidor(), alvo, versao: release.versao });
  if (saida.cancelado) return;
  if (!saida.ok) {
    mostrarAviso(saida.erro, 'erro');
    return;
  }
  mostrarAviso(`Versão ${release.versao} retirada do ar.`, 'ok');
  await carregarTudo();
}

/**
 * Coloca na última versão quem ficou atrás. O servidor sempre entrega a mais
 * nova, então quem está várias versões atrás pula direto para ela.
 */
async function instalarEmTodos(versao, atrasados, conectados) {
  mostrarAviso('');
  const resultado = await api.instalarEmTodos({ servidor: servidor(), alvo, versao, atrasados, conectados });
  if (resultado.cancelado) return;
  if (!resultado.ok) {
    mostrarAviso(resultado.erro, 'erro');
    return;
  }
  mostrarAviso(
    `Aviso enviado para ${plural(resultado.avisados, '1 aparelho ligado', `${resultado.avisados} aparelhos ligados`)}. ` +
      `A versão ${resultado.versao} virou obrigatória: quem está desligado atualiza ao abrir o aplicativo.`,
    'ok',
  );
  await carregarTudo();
  // A instalação leva alguns segundos; uma segunda olhada mostra o resultado
  const quando = alvo;
  setTimeout(() => {
    if (alvo === quando && !telaPrincipal.hidden) void carregarTudo();
  }, 30_000);
}

// ---------------------------------------------------------------- publicação

function definirArquivo(escolhido) {
  arquivo = escolhido;
  el('arquivo-escolhido').textContent = escolhido
    ? `${escolhido.nome} (${tamanhoLegivel(escolhido.tamanho)})`
    : 'nenhum arquivo escolhido';
  el('solta').classList.toggle('solta--cheia', Boolean(escolhido));
  if (escolhido && !el('versao').value) el('versao').value = versaoDoNome(escolhido.nome);
  conferir();
}

/** Endereço que fala direto com o servidor, sem o proxy (e sem o teto de 100 MiB). */
function enderecoDireto() {
  return /^https?:\/\/(\d{1,3}(\.\d{1,3}){3}|localhost)(:\d+)?$/.test(servidor());
}

/**
 * Diz de antemão o que vai dar errado na publicação, em vez de deixar o
 * servidor recusar depois de subir 107 MB.
 */
function conferir() {
  const versao = el('versao').value.trim();
  const ultima = ultimaVersao();
  const sugerida = ultima ? proximaVersao(ultima) : '';

  const sugestao = el('btn-sugerir');
  sugestao.hidden = !sugerida || versao === sugerida;
  if (sugerida) sugestao.textContent = `usar ${sugerida}`;

  const recados = [];
  if (/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(versao) && ultima) {
    if (releases().some((r) => r.versao === versao)) {
      recados.push(`A versão ${versao} já está publicada: o servidor recusa. Suba o número ou tire a atual do ar.`);
    } else if (compararVersoes(versao, ultima) <= 0) {
      recados.push(`A ${versao} não é maior que a ${ultima}, que está no ar: ninguém baixaria.`);
    }
  }
  if (arquivo && versao && !arquivo.nome.includes(versao)) {
    recados.push(`O nome do arquivo não traz "${versao}" — confira se é o pacote certo.`);
  }
  if (arquivo && arquivo.tamanho > 100 * 1024 * 1024 && !enderecoDireto()) {
    recados.push('Mais de 100 MiB por um endereço que passa pelo proxy: o envio volta com HTTP 413.');
  }
  el('conferencia').textContent = recados.join(' ');
}

async function escolherArquivo() {
  const escolhido = await api.escolherArquivo(alvo);
  if (escolhido) definirArquivo(escolhido);
}

function mostrarProgresso(porcentagem, texto) {
  el('progresso').hidden = false;
  el('progresso-barra').style.width = `${porcentagem}%`;
  el('progresso-texto').textContent = texto ?? `${porcentagem}%`;
}

function esconderProgresso() {
  el('progresso').hidden = true;
  el('progresso-barra').style.width = '0%';
  el('progresso-texto').textContent = '';
}

async function publicar() {
  if (!arquivo) {
    mostrarAviso('Escolha antes o arquivo da nova versão.', 'erro');
    return;
  }
  const versao = el('versao').value.trim();
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(versao)) {
    mostrarAviso('A versão precisa estar no formato 1.2.3.', 'erro');
    return;
  }

  el('btn-publicar').disabled = true;
  mostrarProgresso(0);
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
      mostrarAviso(resultado.erro, 'erro');
      esconderProgresso();
      return;
    }
    if (alvo === 'backend') {
      // O servidor aplica o pacote e reinicia: aqui esperamos ele voltar
      mostrarAviso(`Versão ${versao} enviada. O servidor está aplicando e reiniciando…`);
      const voltou = await api.esperarServidor({ servidor: servidor() });
      if (!voltou.ok) {
        mostrarAviso(voltou.erro, 'erro');
        return;
      }
      const tentativas = plural(voltou.tentativas, '1 tentativa', `${voltou.tentativas} tentativas`);
      // O servidor diz qual versão subiu: é assim que se sabe se a troca pegou
      // mesmo ou se o entrypoint devolveu a anterior por a nova não ter subido.
      if (voltou.versao && voltou.versao !== versao) {
        mostrarAviso(
          `O servidor voltou em ${tentativas}, mas na versão ${voltou.versao}, não na ${versao}: ` +
            'a troca não pegou e ele devolveu a anterior. Veja os logs do container.',
          'erro',
        );
      } else {
        mostrarAviso(`Servidor respondendo na versão ${voltou.versao ?? versao}, em ${tentativas}.`, 'ok');
      }
    } else {
      mostrarAviso(
        `Versão ${versao} publicada. Quem está ligado recebe em segundos; para colocar o resto nela agora, ` +
          'use "Instalar nos que faltam" ao lado.',
        'ok',
      );
    }
    definirArquivo(null);
    el('versao').value = '';
    el('notas').value = '';
    el('obrigatoria').checked = false;
    esconderProgresso();
    await carregarTudo();
  } finally {
    el('btn-publicar').disabled = false;
  }
}

// ---------------------------------------------------------------- troca de aplicativo

function aplicarAlvo() {
  document.querySelectorAll('.alvo').forEach((botao) => {
    const ativo = botao.dataset.alvo === alvo;
    botao.classList.toggle('ativo', ativo);
    botao.setAttribute('aria-selected', ativo ? 'true' : 'false');
  });
  el('legenda-alvo').textContent = APLICATIVOS[alvo].arquivo;
  el('titulo-parque').textContent = APLICATIVOS[alvo].titulo ?? 'Quem já atualizou';
  el('btn-recarregar').hidden = !APLICATIVOS[alvo].prefixo;
}

// ---------------------------------------------------------------- ligações da tela

el('btn-entrar').addEventListener('click', entrar);
el('senha').addEventListener('keydown', (evento) => evento.key === 'Enter' && entrar());
el('btn-sair').addEventListener('click', sair);
el('btn-arquivo').addEventListener('click', escolherArquivo);
el('btn-publicar').addEventListener('click', publicar);
el('btn-recarregar').addEventListener('click', () => void carregarTudo());
el('btn-tema').addEventListener('click', () => void alternarTema());
el('versao').addEventListener('input', conferir);
el('btn-sugerir').addEventListener('click', () => {
  el('versao').value = el('btn-sugerir').textContent.replace('usar ', '');
  conferir();
});

document.querySelectorAll('.alvo').forEach((botao) => {
  botao.addEventListener('click', () => {
    if (botao.dataset.alvo === alvo) return;
    alvo = botao.dataset.alvo;
    definirArquivo(null);
    el('versao').value = '';
    mostrarAviso('');
    esconderProgresso();
    // Tudo já veio do servidor na carga: trocar de aba só redesenha
    aplicarAlvo();
    desenharLista();
    desenharParque();
    conferir();
  });
});

// Arrastar o arquivo para dentro da janela. Sem o preventDefault no documento o
// Electron abre o arquivo solto em qualquer lugar, trocando a tela do app.
const solta = el('solta');
for (const evento of ['dragenter', 'dragover']) {
  document.addEventListener(evento, (e) => e.preventDefault());
  solta.addEventListener(evento, (e) => {
    e.preventDefault();
    solta.classList.add('solta--sobre');
  });
}
for (const evento of ['dragleave', 'dragend']) {
  solta.addEventListener(evento, () => solta.classList.remove('solta--sobre'));
}
document.addEventListener('drop', (e) => e.preventDefault());
solta.addEventListener('drop', (e) => {
  e.preventDefault();
  solta.classList.remove('solta--sobre');
  const soltado = e.dataTransfer?.files?.[0];
  if (!soltado) return;
  // Do Electron 32 em diante o caminho não vem mais no File: quem sabe é o preload
  definirArquivo({ caminho: api.caminhoDoArquivo(soltado), nome: soltado.name, tamanho: soltado.size });
});

api.aoProgredir((porcentagem) => {
  mostrarProgresso(porcentagem, porcentagem >= 100 ? 'processando no servidor…' : `${porcentagem}%`);
});

aplicarTema();
aplicarAlvo();
iniciar();
