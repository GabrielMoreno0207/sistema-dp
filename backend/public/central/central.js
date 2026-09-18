'use strict';

/*
 * Central do DP — página para o Departamento Pessoal compor e enviar mensagens.
 * Usa somente a API REST do backend (mesma origem). Sem dependências externas.
 */

const TYPE_META = {
  COMUNICADO: { label: 'Comunicado', icon: '📢', tone: 'announcement' },
  AVISO: { label: 'Aviso', icon: '⚠️', tone: 'warning' },
  INFORMATIVO: { label: 'Informativo', icon: 'ℹ️', tone: 'info' },
  URGENTE: { label: 'Urgente', icon: '🚨', tone: 'urgent' },
};

const TOKEN_KEY = 'dp.central.token';
const USER_KEY = 'dp.central.user';
const AUTO_REFRESH_MS = 30_000;

const $ = (selector) => document.querySelector(selector);
const form = $('#compose-form');

const state = {
  token: storageGet(TOKEN_KEY),
  computers: [],
  employees: [],
  sectors: [],
  /** Anexos escolhidos para o comunicado que está sendo escrito */
  attachments: [],
};

/** Os mesmos limites do servidor (attachment.types.ts): avisa antes de subir o arquivo */
const ATTACH = {
  maxFiles: 5,
  maxBytes: 10 * 1024 * 1024,
  totalBytes: 25 * 1024 * 1024,
  extensions: [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.zip',
  ],
};

const TARGET_HINTS = {
  ALL: 'Todos os computadores recebem.',
  EMPLOYEE: 'Chega no computador onde o funcionário estiver logado (ou quando ele entrar).',
  SECTOR: 'Chega para os funcionários ativos do setor que estiverem logados.',
  SHIFT: 'Chega para os funcionários ativos do turno que estiverem logados.',
  COMPUTER: 'Chega só neste computador, com ou sem funcionário logado.',
};

/** Setores ou turnos distintos dos funcionários ativos */
function distinctGroups(field) {
  const values = state.employees.filter((e) => e.status === 'ACTIVE' && e[field]).map((e) => e[field]);
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// ---------------------------------------------------------------- utilidades

function storageGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* sessionStorage indisponível: segue sem persistir */
  }
}

/** Cria elementos sem usar innerHTML (evita injeção de HTML). */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child !== null && child !== undefined) node.append(child);
  }
  return node;
}

function formatDate(iso) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Hoje, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Ontem, ${time}`;
  return `${date.toLocaleDateString('pt-BR')}, ${time}`;
}

class UnauthorizedError extends Error {}

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) throw new UnauthorizedError(data.message || 'Faça login para continuar.');
  if (!response.ok) throw new Error(data.message || `Erro ${response.status}`);
  return data;
}

function showFeedback(target, text, isError) {
  target.textContent = text;
  target.classList.toggle('feedback--error', Boolean(isError));
  target.hidden = false;
}

/** Preferências deste navegador (tema e última seção): ficam salvas mesmo depois de sair */
function localGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage indisponível: segue sem lembrar a preferência */
  }
}

// ---------------------------------------------------------------- tema (claro/escuro)

const THEME_KEY = 'dp.central.theme';

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Aplica o tema e ajusta os botões 🌙/☀️ (o theme.js já aplicou o tema inicial no <head>) */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.textContent = dark ? '☀️' : '🌙';
    button.title = dark ? 'Usar tema claro' : 'Usar tema escuro';
    button.setAttribute('aria-label', button.title);
  }
}

for (const button of document.querySelectorAll('[data-theme-toggle]')) {
  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    localSet(THEME_KEY, next);
    applyTheme(next);
  });
}

// Sem escolha salva, acompanha o tema do Windows quando ele muda
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
  const saved = localGet(THEME_KEY);
  if (saved !== 'light' && saved !== 'dark') applyTheme(event.matches ? 'dark' : 'light');
});

applyTheme(currentTheme());

// ---------------------------------------------------------------- navegação entre seções

const SECTIONS = {
  novo: 'Novo comunicado',
  enviados: 'Enviados',
  mensagens: 'Mensagens',
  auto: 'Resposta automática',
  funcionarios: 'Funcionários',
  setores: 'Setores',
  dispositivos: 'Dispositivos',
  ti: 'TI',
};
const SECTION_KEY = 'dp.central.section';
const DEFAULT_SECTION = 'novo';

/** Mostra só uma seção por vez (#novo, #enviados...) e lembra a última aberta */
function showSection(name) {
  if (name === 'computadores') name = 'dispositivos'; // link antigo, de antes da aba mudar de nome
  let section = Object.hasOwn(SECTIONS, name) ? name : DEFAULT_SECTION;
  // A seção TI é só da conta do TI (o servidor também recusa as ações com 403)
  if (section === 'ti' && !state.superAdmin) section = DEFAULT_SECTION;
  for (const node of document.querySelectorAll('[data-section]')) node.hidden = node.dataset.section !== section;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === section) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#section-title').textContent = SECTIONS[section];
  localSet(SECTION_KEY, section);
  if (location.hash !== `#${section}`) history.replaceState(null, '', `#${section}`);
  // Menu em barra (tela estreita): mantém o item ativo à vista
  document.querySelector(`[data-nav="${section}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));

// ---------------------------------------------------------------- sessão

function renderUserName(name) {
  $('#user-name').textContent = name || '';
  $('#user-avatar').textContent = name ? name.trim().charAt(0).toUpperCase() : '';
}

function setUser(user) {
  const name = user ? user.name : null;
  storageSet(USER_KEY, name);
  renderUserName(name);
  $('#logout').hidden = !state.token;
  $('#my-password').hidden = !state.token;
  // Conta do TI: só ela vê a seção de administração
  state.superAdmin = Boolean(user?.superAdmin);
  $('#nav-ti').hidden = !state.superAdmin;
  if (!state.superAdmin && location.hash === '#ti') showSection(DEFAULT_SECTION);
}

function showLogin(message) {
  state.token = null;
  storageSet(TOKEN_KEY, null);
  setUser(null);
  // Anexos escolhidos são de quem estava logado: não ficam para a próxima pessoa
  state.attachments = [];
  renderAttachments();
  $('#app-view').hidden = true;
  $('#password-view').hidden = true;
  $('#online-summary').hidden = true;
  $('#login-view').hidden = false;
  const error = $('#login-error');
  if (message) showFeedback(error, message, true);
  else error.hidden = true;
  $('#login-form [name="username"]').focus();
}

function showApp() {
  $('#login-view').hidden = true;
  $('#password-view').hidden = true;
  $('#app-view').hidden = false;
  renderUserName(storageGet(USER_KEY));
  $('#logout').hidden = !state.token;
  $('#my-password').hidden = !state.token;
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  // Guarda o formulário antes do await: depois dele, event.currentTarget vira null
  const loginForm = event.currentTarget;
  const form = new FormData(loginForm);
  try {
    const data = await api('POST', '/api/auth/login', {
      username: String(form.get('username') || '').trim(),
      password: String(form.get('password') || ''),
    });
    state.token = data.token;
    storageSet(TOKEN_KEY, data.token);
    setUser(data.user);
    loginForm.reset();
    // Senha inicial (login criado pela TI): troca obrigatória antes de usar a Central
    if (data.user.mustChangePassword) showPasswordView(true);
    else await loadAll();
  } catch (err) {
    showFeedback($('#login-error'), err.message, true);
  }
});

// ---------------------------------------------------------------- minha senha

const ownPasswordForm = $('#own-password-form');

function showPasswordView(forced) {
  $('#login-view').hidden = true;
  $('#app-view').hidden = true;
  $('#password-view').hidden = false;
  $('#own-password-title').textContent = forced ? 'Crie sua senha' : 'Trocar minha senha';
  $('#own-password-subtitle').textContent = forced
    ? 'Por segurança, troque a senha inicial antes de usar a Central.'
    : 'Informe a senha atual e a nova senha.';
  $('#own-password-cancel').hidden = forced;
  $('#own-password-error').hidden = true;
  ownPasswordForm.reset();
  ownPasswordForm.currentPassword.focus();
}

$('#my-password').addEventListener('click', () => showPasswordView(false));

$('#own-password-cancel').addEventListener('click', () => {
  ownPasswordForm.reset();
  $('#password-view').hidden = true;
  $('#app-view').hidden = false;
});

ownPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = $('#own-password-error');
  const currentPassword = ownPasswordForm.currentPassword.value;
  const newPassword = ownPasswordForm.newPassword.value;
  if (newPassword.length < 8) {
    showFeedback(error, 'A nova senha precisa ter pelo menos 8 caracteres.', true);
    return;
  }
  if (newPassword !== ownPasswordForm.confirm.value) {
    showFeedback(error, 'A confirmação não confere com a nova senha.', true);
    return;
  }
  try {
    await api('POST', '/api/auth/password', { currentPassword, newPassword });
    ownPasswordForm.reset();
    await loadAll();
    showFeedback($('#app-feedback'), 'Senha alterada com sucesso.', false);
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(error, err.message, true);
  }
});

/** Ao abrir a página: com sessão salva, confere se ainda precisa trocar a senha inicial */
async function start() {
  if (state.token) {
    try {
      const { user } = await api('GET', '/api/auth/me');
      setUser(user);
      if (user.mustChangePassword) {
        showPasswordView(true);
        return;
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        showLogin('Sessão expirada. Entre novamente.');
        return;
      }
    }
  }
  await loadAll(); // sem sessão, o 401 leva à tela de login
}

$('#logout').addEventListener('click', async () => {
  try {
    await api('POST', '/api/auth/logout');
  } catch {
    /* sessão já inválida: ignora */
  }
  showLogin();
});

// ---------------------------------------------------------------- dados

async function loadAll() {
  try {
    const [computersData, messagesData, employeesData, sectorsData] = await Promise.all([
      api('GET', '/api/computers'),
      api('GET', '/api/messages?limit=100'),
      api('GET', '/api/employees'),
      api('GET', '/api/sectors'),
    ]);
    state.computers = computersData.computers;
    state.employees = employeesData.employees;
    state.sectors = sectorsData.sectors;
    renderComputers();
    renderSectors();
    renderEmployees();
    renderChatNewOptions();
    void loadChats();
    void loadAutoReplies();
    renderTargetOptions();
    renderHistory(messagesData.messages);
    if (state.superAdmin) void loadTi(messagesData.messages.length);
    // Carregou: some o aviso de erro de uma tentativa anterior (se houver)
    const appFeedback = $('#app-feedback');
    if (appFeedback.classList.contains('feedback--error')) appFeedback.hidden = true;
    showApp();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin(state.token ? 'Sessão expirada. Entre novamente.' : null);
    else showFeedback($('#app-feedback'), `Não foi possível carregar os dados: ${err.message}`, true);
  }
}

/** Aparelho com o app: computador (PC-...) ou celular Android (CEL-...) */
/** CEL- = celular com o app Android; PC- = computador com o app Windows */
function deviceKind(c) {
  return c.computerId.startsWith('CEL-') || c.platform === 'android' ? 'CEL' : 'PC';
}

function deviceLabel(c) {
  return `${deviceKind(c) === 'CEL' ? '📱' : '💻'} ${c.hostname}`;
}

/** Aba escolhida na seção Dispositivos: ALL, PC ou CEL */
let deviceFilter = 'ALL';

function renderComputers() {
  const body = $('#computers-body');
  body.replaceChildren();

  const termo = $('#device-search').value.trim().toLocaleLowerCase('pt-BR');
  const todos = [...state.computers].sort((a, b) => a.hostname.localeCompare(b.hostname));

  // Contadores das abas: sempre sobre o total, independentes da busca
  $('#device-count-all').textContent = todos.length;
  $('#device-count-pc').textContent = todos.filter((c) => deviceKind(c) === 'PC').length;
  $('#device-count-cel').textContent = todos.filter((c) => deviceKind(c) === 'CEL').length;

  const computers = todos.filter((c) => {
    if (deviceFilter !== 'ALL' && deviceKind(c) !== deviceFilter) return false;
    if (!termo) return true;
    const employee = state.employees.find((e) => e.id === c.currentUserId);
    const procuravel = `${c.hostname} ${c.computerId} ${employee ? `${employee.name} ${employee.registration}` : ''}`;
    return procuravel.toLocaleLowerCase('pt-BR').includes(termo);
  });

  if (computers.length === 0) {
    const vazio = todos.length === 0
      ? 'Nenhum computador ou celular registrado ainda.'
      : termo
        ? 'Nenhum dispositivo encontrado para essa busca.'
        : deviceFilter === 'CEL'
          ? 'Nenhum celular registrado ainda.'
          : 'Nenhum computador registrado ainda.';
    body.append(el('tr', {}, el('td', { class: 'empty', colspan: '6', text: vazio })));
  }
  for (const c of computers) {
    const online = c.status === 'ONLINE';
    const employee = state.employees.find((e) => e.id === c.currentUserId);
    body.append(
      el(
        'tr',
        {},
        el('td', {}, el('span', { class: `dot ${online ? 'dot--online' : ''}` }), online ? 'Online' : 'Offline'),
        el('td', { text: deviceLabel(c) }),
        el('td', { text: employee ? `${employee.name} (${employee.registration})` : '—' }),
        el('td', { text: c.computerId }),
        el('td', { text: c.appVersion }),
        el('td', { text: formatDate(c.lastSeenAt) }),
      ),
    );
  }

  const online = state.computers.filter((c) => c.status === 'ONLINE').length;
  const summary = $('#online-summary');
  summary.textContent = `🟢 ${online} de ${state.computers.length} dispositivos online`;
  summary.hidden = false;
}

// Abas Todos / Computadores / Celulares
$('#device-filters').addEventListener('click', (event) => {
  const botao = event.target.closest('[data-device-filter]');
  if (!botao) return;
  deviceFilter = botao.dataset.deviceFilter;
  for (const outro of $('#device-filters').querySelectorAll('[data-device-filter]')) {
    outro.classList.toggle('tab--active', outro === botao);
  }
  renderComputers();
});

$('#device-search').addEventListener('input', renderComputers);

/** Opções do destino escolhido (computador, funcionário, setor ou turno) */
function targetChoices(target) {
  switch (target) {
    case 'COMPUTER':
      return [...state.computers]
        .sort((a, b) => a.hostname.localeCompare(b.hostname))
        .map((c) => ({ value: c.computerId, label: `${deviceLabel(c)} — ${c.computerId} (${c.status === 'ONLINE' ? 'online' : 'offline'})` }));
    case 'EMPLOYEE':
      return state.employees
        .filter((e) => e.status === 'ACTIVE')
        .map((e) => ({ value: e.id, label: `${e.name} — matrícula ${e.registration}${e.sector ? ` (${e.sector})` : ''}` }));
    case 'SECTOR':
      return state.sectors.map((s) => ({
        value: s.name,
        label: `${s.name} (${s.employeeCount} funcionário${s.employeeCount === 1 ? '' : 's'})`,
      }));
    case 'SHIFT':
      return distinctGroups('shift').map((s) => ({ value: s, label: s }));
    default:
      return [];
  }
}

const EMPTY_CHOICES = {
  COMPUTER: 'Nenhum computador registrado',
  EMPLOYEE: 'Nenhum funcionário ativo cadastrado',
  SECTOR: 'Nenhum setor cadastrado (crie na seção Setores)',
  SHIFT: 'Nenhum turno cadastrado nos funcionários',
};

function renderTargetOptions() {
  const target = new FormData(form).get('target');
  const select = $('#target-select');
  const previous = select.value;
  select.replaceChildren();
  select.disabled = target === 'ALL';
  $('#target-hint').textContent = TARGET_HINTS[target];
  if (target === 'ALL') return;

  const choices = targetChoices(target);
  if (choices.length === 0) {
    select.append(el('option', { value: '', text: EMPTY_CHOICES[target] }));
    return;
  }
  for (const choice of choices) select.append(el('option', { value: choice.value, text: choice.label }));
  if (choices.some((c) => c.value === previous)) select.value = previous;
}

function targetLabel(message) {
  switch (message.target) {
    case 'ALL':
      return 'Todos';
    case 'COMPUTER': {
      const computer = state.computers.find((c) => c.computerId === message.targetId);
      return computer ? `PC ${computer.hostname}` : message.targetId;
    }
    case 'EMPLOYEE': {
      const employee = state.employees.find((e) => e.id === message.targetId);
      return employee ? employee.name : 'Funcionário';
    }
    case 'SECTOR':
      return `Setor ${message.targetId}`;
    case 'SHIFT':
      return `Turno ${message.targetId}`;
    default:
      return message.targetId || message.target;
  }
}

function readsLabel(message) {
  if (['ALL', 'SECTOR', 'SHIFT'].includes(message.target)) {
    return `${message.readCount} leitura${message.readCount === 1 ? '' : 's'}`;
  }
  return message.readCount > 0 ? 'Lida' : 'Não lida';
}

/** Explicação da contagem (leituras são por pessoa logada ou, sem login, por computador) */
function readsTitle(message) {
  if (message.target === 'ALL') return `Computadores registrados no envio: ${message.recipientCount}. Cada pessoa logada (ou PC sem login) conta uma leitura.`;
  if (message.target === 'SECTOR' || message.target === 'SHIFT') return `Funcionários ativos no grupo hoje: ${message.recipientCount}.`;
  return '';
}

// ---------------------------------------------------------------- quem leu

const readsDialog = $('#reads-dialog');

function readsButton(message) {
  const button = el('button', {
    class: 'reads-link',
    type: 'button',
    text: readsLabel(message),
    title: `${readsTitle(message)} Clique para ver quem leu.`.trim(),
  });
  button.addEventListener('click', () => void openReads(message));
  return button;
}

const READER_TYPES = { EMPLOYEE: 'Funcionário', COMPUTER: 'Computador (sem login)', REMOVED: 'Excluído' };

async function openReads(message) {
  $('#reads-title').textContent = `Leituras de ${message.id}`;
  $('#reads-subtitle').textContent = `"${message.title}" · para ${targetLabel(message)} · ${formatDate(message.createdAt)}`;
  $('#reads-body').replaceChildren(el('tr', {}, el('td', { class: 'empty', colspan: '5', text: 'Carregando...' })));
  $('#reads-pending-section').hidden = true;
  $('#reads-feedback').hidden = true;
  $('#reads-note').textContent = '';
  renderSentAttachments(message);
  if (!readsDialog.open) readsDialog.showModal();

  try {
    const { reads, pending } = await api('GET', `/api/messages/${encodeURIComponent(message.id)}/reads`);

    $('#reads-read-title').textContent = `Leram (${reads.length})`;
    const body = $('#reads-body');
    body.replaceChildren();
    if (reads.length === 0) {
      body.append(el('tr', {}, el('td', { class: 'empty', colspan: '5', text: 'Ninguém leu esta mensagem ainda.' })));
    }
    for (const r of reads) {
      body.append(
        el(
          'tr',
          {},
          el('td', {}, el('strong', { text: r.name }), r.detail ? el('div', { class: 'muted', text: r.detail }) : null),
          el('td', { text: READER_TYPES[r.type] || r.type }),
          el('td', { text: r.sector || '—' }),
          el('td', { text: r.computer || '—' }),
          el('td', { text: formatDate(r.readAt) }),
        ),
      );
    }

    if (pending) {
      $('#reads-pending-section').hidden = false;
      $('#reads-pending-title').textContent = `Ainda não leram (${pending.length})`;
      const pendingBody = $('#reads-pending-body');
      pendingBody.replaceChildren();
      if (pending.length === 0) {
        pendingBody.append(el('tr', {}, el('td', { class: 'empty', colspan: '4', text: 'Todos os destinatários já leram. ✓' })));
      }
      for (const p of pending) {
        pendingBody.append(
          el(
            'tr',
            {},
            el('td', {}, el('strong', { text: p.name }), p.detail ? el('div', { class: 'muted', text: p.detail }) : null),
            el('td', { text: p.type === 'EMPLOYEE' ? 'Funcionário' : 'Computador' }),
            el('td', { text: p.sector || '—' }),
            el('td', { text: p.situation }),
          ),
        );
      }
    } else {
      $('#reads-note').textContent =
        'Mensagem para Todos: cada funcionário logado conta uma leitura, e cada computador sem login também. ' +
        'A lista de quem ainda não leu só aparece para mensagens enviadas a um funcionário, setor, turno ou computador.';
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      readsDialog.close();
      showLogin('Sessão expirada. Entre novamente.');
    } else {
      showFeedback($('#reads-feedback'), `Não foi possível carregar as leituras: ${err.message}`, true);
    }
  }
}

$('#reads-close').addEventListener('click', () => readsDialog.close());
// Clique fora da caixa fecha
readsDialog.addEventListener('click', (event) => {
  if (event.target === readsDialog) readsDialog.close();
});

// ---------------------------------------------------------------- funcionários

const employeeForm = $('#employee-form');

function renderEmployees() {
  const body = $('#employees-body');
  body.replaceChildren();

  if (state.employees.length === 0) {
    body.append(el('tr', {}, el('td', { class: 'empty', colspan: '6', text: 'Nenhum funcionário cadastrado ainda.' })));
  }
  for (const e of state.employees) {
    const active = e.status === 'ACTIVE';
    const edit = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Editar' });
    edit.addEventListener('click', () => startEdit(e));
    const toggle = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: active ? 'Desativar' : 'Reativar' });
    toggle.addEventListener('click', () => void toggleEmployee(e));
    const remove = el('button', { class: 'btn btn--ghost btn--sm btn--danger', type: 'button', text: 'Excluir' });
    remove.addEventListener('click', () => void deleteEmployee(e));

    body.append(
      el(
        'tr',
        { class: active ? '' : 'status-inactive' },
        el('td', { text: e.name }),
        el('td', { text: e.registration }),
        el('td', { text: e.sector || '—' }),
        el('td', { text: e.shift || '—' }),
        el('td', { text: active ? (e.mustChangePassword ? 'Ativo · aguardando troca de senha' : 'Ativo') : 'Inativo' }),
        el('td', {}, el('div', { class: 'row-actions' }, edit, toggle, remove)),
      ),
    );
  }

  // Setores: lista fechada (cadastro). Turnos: sugestões dos já usados.
  renderSectorOptions();
  $('#shift-list').replaceChildren(...distinctGroups('shift').map((s) => el('option', { value: s })));
}

/** Opções do campo Setor do funcionário (mantém a seleção atual) */
function renderSectorOptions(selected) {
  const select = $('#employee-sector');
  const current = selected !== undefined ? selected || '' : select.value;
  select.replaceChildren(
    el('option', { value: '', text: 'Sem setor' }),
    ...state.sectors.map((s) => el('option', { value: s.name, text: s.name })),
  );
  if (current && !state.sectors.some((s) => s.name === current)) {
    // Setor gravado que não está no cadastro: aparece na lista para não ser apagado sem querer ao salvar
    select.append(el('option', { value: current, text: `${current} (não cadastrado)` }));
  }
  select.value = current;
}

function startEdit(employee) {
  closeSectorEditIfOpen();
  employeeForm.id.value = employee.id;
  employeeForm.name.value = employee.name;
  employeeForm.registration.value = employee.registration;
  renderSectorOptions(employee.sector);
  employeeForm.shift.value = employee.shift || '';
  employeeForm.password.value = '';
  $('#employee-password-label').textContent = 'Nova senha (em branco = manter)';
  $('#employee-submit').textContent = 'Salvar alterações';
  $('#employee-cancel').hidden = false;
  employeeForm.scrollIntoView({ block: 'center' });
  employeeForm.name.focus();
}

function resetEmployeeForm() {
  employeeForm.reset();
  employeeForm.id.value = '';
  renderSectorOptions('');
  $('#employee-password-label').textContent = 'Senha inicial';
  $('#employee-submit').textContent = 'Cadastrar funcionário';
  $('#employee-cancel').hidden = true;
}

$('#employee-cancel').addEventListener('click', resetEmployeeForm);

employeeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = $('#employee-feedback');
  const data = new FormData(employeeForm);
  const id = String(data.get('id') || '');
  const fields = {
    name: String(data.get('name') || '').trim(),
    registration: String(data.get('registration') || '').trim(),
    sector: String(data.get('sector') || '') || null,
    shift: String(data.get('shift') || '').trim() || null,
  };
  // Cadastro: senha obrigatória. Edição: senha só se preenchida (redefine).
  const password = String(data.get('password') || '');
  if ((!id || password) && password.length < 8) {
    showFeedback(feedback, `A ${id ? 'nova senha' : 'senha inicial'} precisa ter pelo menos 8 caracteres.`, true);
    return;
  }

  try {
    if (id) {
      await api('PATCH', `/api/employees/${encodeURIComponent(id)}`, fields);
      if (password) {
        try {
          await api('POST', `/api/employees/${encodeURIComponent(id)}/password`, { password });
        } catch (err) {
          if (err instanceof UnauthorizedError) throw err;
          // Os dados já foram salvos: deixa claro que só a senha falhou
          showFeedback(feedback, `Dados de ${fields.name} salvos, mas a senha NÃO foi alterada: ${err.message}`, true);
          resetEmployeeForm();
          await loadAll();
          return;
        }
      }
      showFeedback(
        feedback,
        `Dados de ${fields.name} atualizados${password ? '. Senha redefinida: informe a nova senha ao funcionário' : ''}.`,
        false,
      );
    } else {
      await api('POST', '/api/employees', { ...fields, password });
      showFeedback(feedback, `${fields.name} cadastrado. Entregue a matrícula ${fields.registration} e a senha inicial ao funcionário.`, false);
    }
    resetEmployeeForm();
    await loadAll();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(feedback, err.message, true);
  }
});

async function deleteEmployee(employee) {
  const ok = await askConfirm({
    title: 'Excluir funcionário?',
    text:
      `${employee.name} (matrícula ${employee.registration}) sai dos computadores e não consegue mais entrar. ` +
      'O histórico de mensagens é mantido.\nPara só bloquear o acesso, podendo reativar depois, use "Desativar".',
    okLabel: 'Excluir',
  });
  if (!ok) return;
  try {
    await api('DELETE', `/api/employees/${encodeURIComponent(employee.id)}`);
    if (employeeForm.id.value === employee.id) resetEmployeeForm();
    showFeedback($('#employee-feedback'), `${employee.name} excluído.`, false);
    await loadAll();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback($('#employee-feedback'), err.message, true);
  }
}

// ---------------------------------------------------------------- setores

const sectorForm = $('#sector-form');

function renderSectors() {
  const body = $('#sectors-body');
  body.replaceChildren();

  if (state.sectors.length === 0) {
    body.append(el('tr', {}, el('td', { class: 'empty', colspan: '3', text: 'Nenhum setor cadastrado. Crie os setores antes de cadastrar os funcionários.' })));
  }
  for (const s of state.sectors) {
    const rename = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Renomear' });
    rename.addEventListener('click', () => startSectorEdit(s));
    const remove = el('button', { class: 'btn btn--ghost btn--sm btn--danger', type: 'button', text: 'Excluir' });
    if (s.employeeCount > 0) {
      remove.disabled = true;
      remove.title = 'Mude os funcionários de setor (ou exclua-os) antes de excluir o setor';
    }
    remove.addEventListener('click', () => void deleteSector(s));
    body.append(
      el(
        'tr',
        {},
        el('td', { text: s.name }),
        el('td', { text: String(s.employeeCount) }),
        el('td', {}, el('div', { class: 'row-actions' }, rename, remove)),
      ),
    );
  }
}

function startSectorEdit(sector) {
  sectorForm.id.value = sector.id;
  sectorForm.name.value = sector.name;
  $('#sector-label').textContent = `Novo nome para "${sector.name}"`;
  $('#sector-submit').textContent = 'Salvar nome';
  $('#sector-cancel').hidden = false;
  sectorForm.name.focus();
}

function resetSectorForm() {
  sectorForm.reset();
  sectorForm.id.value = '';
  $('#sector-label').textContent = 'Novo setor';
  $('#sector-submit').textContent = 'Criar setor';
  $('#sector-cancel').hidden = true;
}

function closeSectorEditIfOpen() {
  if (sectorForm.id.value) resetSectorForm();
}

$('#sector-cancel').addEventListener('click', resetSectorForm);

sectorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = $('#sector-feedback');
  const id = sectorForm.id.value;
  const name = sectorForm.name.value.trim();
  if (!name) return;
  try {
    if (id) {
      await api('PATCH', `/api/sectors/${encodeURIComponent(id)}`, { name });
      showFeedback(feedback, `Setor renomeado para "${name}". Os funcionários e as mensagens desse setor foram atualizados.`, false);
    } else {
      await api('POST', '/api/sectors', { name });
      showFeedback(feedback, `Setor "${name}" criado.`, false);
    }
    resetSectorForm();
    await loadAll();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(feedback, err.message, true);
  }
});

async function deleteSector(sector) {
  const ok = await askConfirm({
    title: 'Excluir setor?',
    text: `O setor "${sector.name}" será excluído. Setores com funcionários não podem ser excluídos.`,
    okLabel: 'Excluir',
  });
  if (!ok) return;
  try {
    await api('DELETE', `/api/sectors/${encodeURIComponent(sector.id)}`);
    if (sectorForm.id.value === sector.id) resetSectorForm();
    showFeedback($('#sector-feedback'), `Setor "${sector.name}" excluído.`, false);
    await loadAll();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback($('#sector-feedback'), err.message, true);
  }
}

async function toggleEmployee(employee) {
  const activate = employee.status !== 'ACTIVE';
  if (!activate) {
    const ok = await askConfirm({
      title: 'Desativar funcionário?',
      text: `${employee.name} sai dos computadores e não consegue mais entrar. Dá para reativar depois.`,
      okLabel: 'Desativar',
    });
    if (!ok) return;
  }
  try {
    await api('PATCH', `/api/employees/${encodeURIComponent(employee.id)}`, { status: activate ? 'ACTIVE' : 'INACTIVE' });
    showFeedback($('#employee-feedback'), `${employee.name} ${activate ? 'reativado' : 'desativado'}.`, false);
    await loadAll();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback($('#employee-feedback'), err.message, true);
  }
}

function renderHistory(messages) {
  const body = $('#history-body');
  body.replaceChildren();

  if (messages.length === 0) {
    body.append(el('tr', {}, el('td', { class: 'empty', colspan: '6', text: 'Nenhuma mensagem enviada ainda.' })));
    return;
  }
  for (const m of messages) {
    const meta = TYPE_META[m.type];
    const count = m.attachments?.length ?? 0;
    body.append(
      el(
        'tr',
        {},
        el('td', { text: m.id }),
        el('td', {}, el('span', { class: `badge badge--${meta.tone}`, text: `${meta.icon} ${meta.label}` })),
        el(
          'td',
          { class: 'wrap', title: m.content },
          m.title,
          count ? el('span', { class: 'attach__badge', title: `${count} anexo(s)`, text: ` 📎${count}` }) : null,
        ),
        el('td', { text: targetLabel(m) }),
        el('td', { text: formatDate(m.createdAt) }),
        el('td', {}, readsButton(m)),
      ),
    );
  }
}

// ---------------------------------------------------------------- anexos

const attachInput = $('#attach-input');
const attachDrop = $('#attach-drop');

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function isImageFile(file) {
  return file.type.startsWith('image/');
}

/** Miniatura da imagem escolhida, lida aqui mesmo (não precisa ir ao servidor) */
function thumbnailFor(file, img) {
  const reader = new FileReader();
  reader.onload = () => img.setAttribute('src', String(reader.result));
  reader.readAsDataURL(file);
}

function attachedBytes() {
  return state.attachments.reduce((total, item) => total + item.size, 0);
}

/** Recusa o que o servidor recusaria, com a mensagem antes de subir o arquivo */
function attachmentProblem(file) {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!ATTACH.extensions.includes(extension)) {
    return `"${file.name}": tipo não permitido. Aceitos: ${ATTACH.extensions.join(', ')}`;
  }
  if (file.size === 0) return `"${file.name}" está vazio.`;
  if (file.size > ATTACH.maxBytes) {
    return `"${file.name}" tem ${formatSize(file.size)}; o limite por arquivo é ${formatSize(ATTACH.maxBytes)}.`;
  }
  if (state.attachments.length >= ATTACH.maxFiles) return `No máximo ${ATTACH.maxFiles} anexos por comunicado.`;
  if (attachedBytes() + file.size > ATTACH.totalBytes) {
    return `Os anexos passariam de ${formatSize(ATTACH.totalBytes)} no total.`;
  }
  return null;
}

function renderAttachments() {
  const list = $('#attach-list');
  list.replaceChildren();

  for (const item of state.attachments) {
    const remove = el('button', {
      class: 'icon-btn attach__remove',
      type: 'button',
      title: 'Tirar este anexo',
      'aria-label': `Tirar ${item.name}`,
      text: '×',
    });
    remove.addEventListener('click', () => void removeAttachment(item));

    const icon = item.thumbnail
      ? el('img', { class: 'attach__thumb', alt: '', src: item.thumbnail })
      : el('span', { class: 'attach__file-icon', 'aria-hidden': 'true', text: item.image ? '🖼️' : '📄' });

    const status = item.error
      ? el('small', { class: 'attach__error', text: item.error })
      : el('small', { class: 'muted', text: item.uploading ? 'Enviando...' : formatSize(item.size) });

    list.append(
      el(
        'li',
        { class: `attach__item${item.error ? ' attach__item--error' : ''}` },
        icon,
        el('span', { class: 'attach__info' }, el('strong', { class: 'attach__name', text: item.name }), status),
        remove,
      ),
    );
  }

  $('#attach-counter').textContent = `${state.attachments.length}/${ATTACH.maxFiles}`;
  $('#attach-hint').textContent = state.attachments.length
    ? `${formatSize(attachedBytes())} de ${formatSize(ATTACH.totalBytes)}. Quem receber o comunicado pode abrir e salvar os anexos.`
    : `Até ${ATTACH.maxFiles} arquivos de ${formatSize(ATTACH.maxBytes)} (${ATTACH.extensions.join(', ')}).`;
  renderPreview();
}

/** Sobe o arquivo na hora: o comunicado só cita o id devolvido pelo servidor */
async function uploadAttachment(file) {
  const problem = attachmentProblem(file);
  if (problem) {
    showFeedback($('#compose-feedback'), problem, true);
    return;
  }

  const item = { key: `tmp-${Date.now()}-${Math.random()}`, id: null, name: file.name, size: file.size, image: isImageFile(file), uploading: true, error: null, thumbnail: null };
  state.attachments.push(item);
  renderAttachments();
  if (item.image) {
    const reader = new FileReader();
    reader.onload = () => {
      item.thumbnail = String(reader.result);
      renderAttachments();
    };
    reader.readAsDataURL(file);
  }

  try {
    const response = await fetch('/api/attachments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new UnauthorizedError(data.message || 'Faça login para continuar.');
    if (!response.ok) throw new Error(data.message || `Erro ${response.status}`);

    item.id = data.attachment.id;
    item.name = data.attachment.name;
    item.size = data.attachment.size;
    item.image = data.attachment.kind === 'IMAGE';
    item.uploading = false;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      showLogin('Sessão expirada. Entre novamente.');
      return;
    }
    item.uploading = false;
    item.error = err.message;
  }
  renderAttachments();
}

async function removeAttachment(item) {
  state.attachments = state.attachments.filter((a) => a.key !== item.key);
  renderAttachments();
  // Tira do servidor também; se falhar, a faxina do backend cuida
  if (item.id) await api('DELETE', `/api/attachments/${encodeURIComponent(item.id)}`).catch(() => undefined);
}

function clearAttachments() {
  state.attachments = [];
  attachInput.value = '';
  renderAttachments();
}

function addFiles(files) {
  $('#compose-feedback').hidden = true;
  for (const file of files) void uploadAttachment(file);
}

attachInput.setAttribute('accept', ATTACH.extensions.join(','));
$('#attach-pick').addEventListener('click', () => attachInput.click());
attachInput.addEventListener('change', () => {
  addFiles([...attachInput.files]);
  attachInput.value = ''; // permite escolher o mesmo arquivo de novo
});

for (const type of ['dragenter', 'dragover']) {
  attachDrop.addEventListener(type, (event) => {
    event.preventDefault();
    attachDrop.classList.add('attach__drop--over');
  });
}
for (const type of ['dragleave', 'drop']) {
  attachDrop.addEventListener(type, (event) => {
    event.preventDefault();
    attachDrop.classList.remove('attach__drop--over');
  });
}
attachDrop.addEventListener('drop', (event) => {
  if (event.dataTransfer?.files?.length) addFiles([...event.dataTransfer.files]);
});

// ---- Anexos de um comunicado já enviado (caixa "Leituras") ----

/**
 * Abre o anexo em outra aba. O servidor devolve um link de curta duração,
 * porque a aba nova não manda o token de acesso.
 */
async function openAttachment(attachment, button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Abrindo...';
  try {
    const { url } = await api('POST', `/api/attachments/${encodeURIComponent(attachment.id)}/link`);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback($('#reads-feedback'), `Não foi possível abrir o anexo: ${err.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function renderSentAttachments(message) {
  const section = $('#reads-attachments-section');
  const list = $('#reads-attachments');
  const attachments = message.attachments || [];
  section.hidden = attachments.length === 0;
  list.replaceChildren();

  $('#reads-attachments-title').textContent = `Anexos (${attachments.length})`;
  for (const attachment of attachments) {
    const open = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: attachment.kind === 'IMAGE' ? 'Ver' : 'Baixar' });
    open.addEventListener('click', () => void openAttachment(attachment, open));
    list.append(
      el(
        'li',
        { class: 'attach__item' },
        el('span', { class: 'attach__file-icon', 'aria-hidden': 'true', text: attachment.kind === 'IMAGE' ? '🖼️' : '📄' }),
        el(
          'span',
          { class: 'attach__info' },
          el('strong', { class: 'attach__name', text: attachment.name }),
          el('small', { class: 'muted', text: formatSize(attachment.size) }),
        ),
        open,
      ),
    );
  }
}

// ---------------------------------------------------------------- composição

function readForm() {
  const data = new FormData(form);
  return {
    type: String(data.get('type')),
    title: String(data.get('title') || '').trim(),
    content: String(data.get('content') || '').trim(),
    target: String(data.get('target')),
    targetId: String(data.get('targetId') || ''),
  };
}

function renderPreview() {
  const { type, title, content } = readForm();
  const meta = TYPE_META[type];
  const toast = el(
    'div',
    { class: `toast toast--${meta.tone}` },
    el('span', { class: 'toast__icon', text: meta.icon }),
    el(
      'div',
      { class: 'toast__body' },
      el(
        'div',
        { class: 'toast__top' },
        el('span', { class: 'toast__kicker', text: type === 'URGENTE' ? 'URGENTE · DP' : `${meta.label} · DP` }),
        el('span', { class: 'toast__time', text: 'Agora' }),
      ),
      el('strong', { class: 'toast__title', text: title || 'Título da mensagem' }),
      el('p', { class: 'toast__content', text: content || 'O texto da mensagem aparece aqui.' }),
      state.attachments.length
        ? el('p', {
            class: 'toast__attachments',
            text: `📎 ${state.attachments.length} anexo${state.attachments.length === 1 ? '' : 's'}`,
          })
        : null,
      el(
        'div',
        { class: 'toast__actions' },
        el('span', { class: 'toast__btn', text: 'Fechar' }),
        el('span', { class: 'toast__btn toast__btn--primary', text: 'Visualizar' }),
      ),
    ),
  );
  $('#preview-toast').replaceChildren(toast);

  $('#title-counter').textContent = `${form.title.value.length}/120`;
  $('#content-counter').textContent = `${form.content.value.length}/5000`;
}

form.addEventListener('input', renderPreview);
form.addEventListener('change', (event) => {
  if (event.target.name === 'target') renderTargetOptions();
  renderPreview();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = $('#compose-feedback');
  const input = readForm();

  if (!input.title || !input.content) {
    showFeedback(feedback, 'Preencha o título e a mensagem.', true);
    return;
  }
  if (input.target !== 'ALL' && !input.targetId) {
    showFeedback(feedback, 'Escolha o destino da mensagem.', true);
    return;
  }
  if (state.attachments.some((a) => a.uploading)) {
    showFeedback(feedback, 'Espere os anexos terminarem de subir.', true);
    return;
  }
  if (state.attachments.some((a) => a.error)) {
    showFeedback(feedback, 'Tire da lista os anexos que falharam (ou tente de novo) antes de enviar.', true);
    return;
  }
  if (input.type === 'URGENTE') {
    const ok = await askConfirm({
      title: 'Enviar como URGENTE?',
      text: 'O alerta aparece em vermelho, com som insistente, e nos celulares pode ocupar a tela inteira.',
      okLabel: 'Enviar urgente',
    });
    if (!ok) return;
  }

  const payload = { title: input.title, content: input.content, type: input.type, target: input.target };
  if (input.target !== 'ALL') payload.targetId = input.targetId;
  const attachmentIds = state.attachments.map((a) => a.id).filter(Boolean);
  if (attachmentIds.length > 0) payload.attachmentIds = attachmentIds;

  const button = $('#send-btn');
  button.disabled = true;
  button.textContent = 'Enviando...';
  try {
    const { message, deliveredTo } = await api('POST', '/api/messages', payload);
    const anexos = message.attachments?.length
      ? ` Com ${message.attachments.length} anexo${message.attachments.length === 1 ? '' : 's'}.`
      : '';
    showFeedback(
      feedback,
      `Mensagem ${message.id} enviada.${anexos} Entregue agora a ${deliveredTo} computador(es) online; os demais recebem ao conectar ou quando o funcionário entrar.`,
      false,
    );
    form.title.value = '';
    form.content.value = '';
    clearAttachments();
    await loadAll();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(feedback, `Falha ao enviar: ${err.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar mensagem';
  }
});

// ---------------------------------------------------------------- chat com os funcionários

const CHAT_LIST_REFRESH_MS = 10_000;
const CHAT_THREAD_REFRESH_MS = 5_000;
const chatForm = $('#chat-form');
const chatState = { conversations: [], employeeId: null, signature: '' };

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return date.toLocaleDateString('pt-BR');
}

async function loadChats() {
  try {
    const { conversations } = await api('GET', '/api/chats');
    chatState.conversations = conversations;
    renderChatList();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
  }
}

/** Lista, contador e título da aba: só as conversas da pessoa do DP logada (o servidor já filtra) */
function renderChatList() {
  const total = chatState.conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const badge = $('#chat-unread');
  badge.hidden = total === 0;
  badge.textContent = `${total} nova${total === 1 ? '' : 's'}`;
  const navBadge = $('#nav-chat-badge');
  navBadge.hidden = total === 0;
  navBadge.textContent = total > 99 ? '99+' : String(total);
  document.title = total > 0 ? `(${total}) Central do DP` : 'Central do DP — Comunicação interna';

  const list = $('#chat-conversations');
  list.replaceChildren();
  if (chatState.conversations.length === 0) {
    list.append(el('li', { class: 'muted', text: 'Nenhuma conversa ainda. Use "Nova conversa" acima.' }));
  }
  for (const c of chatState.conversations) {
    const active = c.employee.id === chatState.employeeId;
    const preview = `${c.lastMessage.senderType === 'DP' ? 'DP: ' : ''}${c.lastMessage.content}`;
    const button = el(
      'button',
      { class: `chat__conv ${active ? 'chat__conv--active' : ''}`, type: 'button' },
      el(
        'span',
        { class: 'chat__conv-top' },
        el('span', { class: 'chat__conv-name', text: c.employee.name }),
        c.unreadCount > 0 ? el('span', { class: 'chat__conv-unread', text: String(c.unreadCount) }) : null,
      ),
      el('span', { class: 'chat__conv-preview', text: preview }),
      el('span', {
        class: 'chat__conv-preview',
        text: `${c.employee.sector ? `${c.employee.sector} · ` : ''}${formatDate(c.lastMessage.createdAt)}`,
      }),
    );
    button.addEventListener('click', () => void openChat(c.employee.id));
    list.append(el('li', {}, button));
  }
}

// Nova conversa: lista os setores; ao clicar num setor, lista os funcionários ativos dele
const NO_SECTOR = ' sem-setor';
const pickerState = { open: false, sector: null }; // sector null = lista de setores

function activeEmployeesIn(sector) {
  return state.employees
    .filter((e) => e.status === 'ACTIVE' && (sector === NO_SECTOR ? !e.sector : e.sector === sector))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function pickerButton(label, count, detail) {
  const props = { class: 'chat__conv chat__pick', type: 'button' };
  if (count === 0) props.disabled = ''; // el() usa setAttribute: só passa "disabled" quando é para desabilitar
  return el(
    'button',
    props,
    el(
      'span',
      { class: 'chat__conv-top' },
      el('span', { class: 'chat__conv-name', text: label }),
      count === null ? null : el('span', { class: 'chat__pick-count', text: String(count) }),
    ),
    detail ? el('span', { class: 'chat__conv-preview', text: detail }) : null,
  );
}

function renderChatNewOptions() {
  $('#chat-new-toggle').hidden = pickerState.open;
  $('#chat-picker').hidden = !pickerState.open;
  $('#chat-conversations').hidden = pickerState.open;
  if (!pickerState.open) return;

  const list = $('#chat-picker-list');
  list.replaceChildren();

  if (pickerState.sector === null) {
    $('#chat-picker-title').textContent = 'Escolha o setor';
    $('#chat-picker-back').textContent = '← Conversas';
    const groups = state.sectors.map((s) => ({ key: s.name, label: s.name }));
    if (state.employees.some((e) => e.status === 'ACTIVE' && !e.sector)) groups.push({ key: NO_SECTOR, label: 'Sem setor' });
    if (groups.length === 0) list.append(el('li', { class: 'muted', text: 'Nenhum setor cadastrado. Cadastre em Setores.' }));
    for (const group of groups) {
      const count = activeEmployeesIn(group.key).length;
      const button = pickerButton(group.label, count, count === 0 ? 'Nenhum funcionário ativo' : null);
      if (count > 0) {
        button.addEventListener('click', () => {
          pickerState.sector = group.key;
          renderChatNewOptions();
        });
      }
      list.append(el('li', {}, button));
    }
    return;
  }

  $('#chat-picker-title').textContent = pickerState.sector === NO_SECTOR ? 'Sem setor' : pickerState.sector;
  $('#chat-picker-back').textContent = '← Setores';
  const employees = activeEmployeesIn(pickerState.sector);
  if (employees.length === 0) list.append(el('li', { class: 'muted', text: 'Nenhum funcionário ativo neste setor.' }));
  for (const employee of employees) {
    const hasConversation = chatState.conversations.some((c) => c.employee.id === employee.id);
    const button = pickerButton(
      employee.name,
      null,
      `Matrícula ${employee.registration}${hasConversation ? ' · já tem conversa' : ''}`,
    );
    button.addEventListener('click', () => {
      pickerState.open = false;
      pickerState.sector = null;
      renderChatNewOptions();
      void openChat(employee.id);
    });
    list.append(el('li', {}, button));
  }
}

$('#chat-new-toggle').addEventListener('click', () => {
  pickerState.open = true;
  pickerState.sector = null;
  renderChatNewOptions();
});

$('#chat-picker-back').addEventListener('click', () => {
  if (pickerState.sector !== null) pickerState.sector = null; // funcionários → setores
  else pickerState.open = false; // setores → conversas
  renderChatNewOptions();
});

async function openChat(employeeId) {
  chatState.employeeId = employeeId;
  chatState.signature = '';
  const employee = state.employees.find((e) => e.id === employeeId);
  const conversation = chatState.conversations.find((c) => c.employee.id === employeeId);
  $('#chat-name').textContent = employee?.name ?? conversation?.employee.name ?? 'Funcionário';
  $('#chat-meta').textContent = employee
    ? `Matrícula ${employee.registration}${employee.sector ? ` · ${employee.sector}` : ''}${employee.status !== 'ACTIVE' ? ' · inativo' : ''}`
    : 'Funcionário excluído';
  $('#chat-empty').hidden = true;
  $('#chat-panel').hidden = false;
  $('#chat-feedback').hidden = true;

  const canSend = Boolean(employee && employee.status === 'ACTIVE');
  chatForm.content.disabled = !canSend;
  chatForm.querySelector('button').disabled = !canSend;
  chatForm.content.placeholder = canSend
    ? 'Escreva uma mensagem... (Enter envia, Shift+Enter quebra a linha)'
    : 'Não é possível enviar para um funcionário inativo ou excluído.';

  $('#chat-messages').replaceChildren(el('div', { class: 'chat__empty', text: 'Carregando...' }));
  renderChatList();
  await refreshThread(true);
  if (canSend) chatForm.content.focus();
}

async function refreshThread(force) {
  const employeeId = chatState.employeeId;
  if (!employeeId) return;
  try {
    const { messages } = await api('GET', `/api/chats/${encodeURIComponent(employeeId)}/messages`);
    if (employeeId !== chatState.employeeId) return; // trocou de conversa enquanto carregava
    const signature = messages.map((m) => `${m.id}${m.readAt ? 'r' : ''}`).join(',');
    if (force || signature !== chatState.signature) {
      chatState.signature = signature;
      renderThread(messages);
    }
    // Conversa aberta na tela: o que o funcionário mandou conta como lido pelo DP
    if (messages.some((m) => m.senderType === 'EMPLOYEE' && !m.readAt)) {
      await api('POST', `/api/chats/${encodeURIComponent(employeeId)}/read`);
      void loadChats();
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback($('#chat-feedback'), `Não foi possível carregar a conversa: ${err.message}`, true);
  }
}

function renderThread(messages) {
  const box = $('#chat-messages');
  box.replaceChildren();
  if (messages.length === 0) {
    box.append(el('div', { class: 'chat__empty', text: 'Nenhuma mensagem ainda. Escreva a primeira!' }));
    return;
  }
  let lastDay = '';
  for (const m of messages) {
    const day = dayLabel(m.createdAt);
    if (day !== lastDay) {
      box.append(el('div', { class: 'chat__day', text: day }));
      lastDay = day;
    }
    const mine = m.senderType === 'DP';
    const time = new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const meta = `${m.senderName} · ${time}${mine && m.readAt ? ' · ✓ lida' : ''}`;
    box.append(el('div', { class: `bubble ${mine ? 'bubble--mine' : 'bubble--theirs'}` }, m.content, bubbleMeta(meta, m.automatic)));
  }
  box.scrollTop = box.scrollHeight;
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = chatForm.content.value.trim();
  if (!content || !chatState.employeeId) return;
  const button = chatForm.querySelector('button');
  button.disabled = true;
  $('#chat-feedback').hidden = true;
  try {
    await api('POST', `/api/chats/${encodeURIComponent(chatState.employeeId)}/messages`, { content });
    chatForm.content.value = '';
    await refreshThread(true);
    void loadChats();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback($('#chat-feedback'), `Não foi possível enviar: ${err.message}`, true);
  } finally {
    button.disabled = false;
    chatForm.content.focus();
  }
});

// Enter envia; Shift+Enter quebra a linha
chatForm.content.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

/** Linha de remetente/hora da bolha; respostas automáticas ganham a tag 🤖 */
function bubbleMeta(text, automatic) {
  return el(
    'span',
    { class: 'bubble__meta' },
    automatic ? el('span', { class: 'bubble__tag', text: '🤖 Resposta automática' }) : null,
    text,
  );
}

// ---------------------------------------------------------------- resposta automática (por setor, de cada pessoa do DP)

const AUTO_MAX = 1000;
const DEFAULT_SECTOR_LABEL = 'Todos os setores (padrão)';
const autoForm = $('#auto-form');
const autoState = { rules: [] };

const autoSectorLabel = (sector) => (sector === null ? DEFAULT_SECTOR_LABEL : sector);

async function loadAutoReplies() {
  try {
    const { rules } = await api('GET', '/api/auto-replies');
    autoState.rules = rules;
    $('#auto-list-feedback').hidden = true;
    renderAutoReplies();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback($('#auto-list-feedback'), `Não foi possível carregar as respostas automáticas: ${err.message}`, true);
  }
}

function renderAutoReplies() {
  const body = $('#auto-body');
  body.replaceChildren();
  if (autoState.rules.length === 0) {
    body.append(
      el('tr', {}, el('td', {
        class: 'empty',
        colspan: '4',
        text: 'Você ainda não tem respostas automáticas. Crie a primeira no formulário acima (por exemplo, uma para "Todos os setores").',
      })),
    );
  }
  for (const rule of autoState.rules) {
    const edit = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Editar' });
    edit.addEventListener('click', () => startAutoEdit(rule));
    const toggle = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: rule.active ? 'Pausar' : 'Ativar' });
    toggle.addEventListener('click', () => void toggleAutoReply(rule));
    const remove = el('button', { class: 'btn btn--ghost btn--sm btn--danger', type: 'button', text: 'Excluir' });
    remove.addEventListener('click', () => void deleteAutoReply(rule));
    body.append(
      el(
        'tr',
        { class: rule.active ? '' : 'status-inactive' },
        el('td', {}, el('strong', { text: autoSectorLabel(rule.sector) })),
        el('td', { class: 'auto-text', text: rule.content }),
        el('td', {}, el('span', { class: `badge ${rule.active ? 'badge--active' : 'badge--paused'}`, text: rule.active ? 'Ativa' : 'Pausada' })),
        el('td', {}, el('div', { class: 'row-actions' }, edit, toggle, remove)),
      ),
    );
  }
  renderAutoSectorOptions();
}

/** Setor: "Todos os setores" + cadastro. Setores que já têm resposta ficam desabilitados (menos o da edição). */
function renderAutoSectorOptions() {
  const select = $('#auto-sector');
  const editingId = autoForm.id.value;
  const current = select.value;
  const taken = new Set(autoState.rules.filter((r) => r.id !== editingId).map((r) => r.sector ?? ''));
  const options = [{ value: '', label: DEFAULT_SECTOR_LABEL }, ...state.sectors.map((s) => ({ value: s.name, label: s.name }))];
  const editing = autoState.rules.find((r) => r.id === editingId);
  if (editing && editing.sector !== null && !state.sectors.some((s) => s.name === editing.sector)) {
    options.push({ value: editing.sector, label: `${editing.sector} (não cadastrado)` });
  }
  select.replaceChildren(
    ...options.map((o) => {
      const option = el('option', { value: o.value, text: taken.has(o.value) ? `${o.label} — já tem resposta` : o.label });
      option.disabled = taken.has(o.value);
      return option;
    }),
  );
  const available = options.filter((o) => !taken.has(o.value));
  select.value = available.some((o) => o.value === current) ? current : (available[0]?.value ?? '');
  const noneLeft = available.length === 0;
  $('#auto-submit').disabled = noneLeft;
  $('#auto-sector-hint').textContent = noneLeft
    ? 'Todos os setores já têm resposta. Edite uma da lista abaixo.'
    : state.sectors.length === 0
      ? 'Nenhum setor cadastrado ainda: por enquanto só dá para criar a resposta de "Todos os setores".'
      : '';
}

/** Troca os campos por valores de exemplo, como o servidor faz ao enviar */
function fillPlaceholders(text, sector) {
  const dpName = (storageGet(USER_KEY) || '').replace(/\s*\(DP\)\s*$/, '') || 'DP';
  const values = { primeiro_nome: 'João', funcionario: 'João Silva', setor: sector || 'Produção', nome_dp: dpName };
  return text.replace(/\{(primeiro_nome|funcionario|setor|nome_dp)\}/g, (_match, key) => values[key]);
}

function renderAutoPreview() {
  const content = autoForm.content.value;
  $('#auto-counter').textContent = `${content.length}/${AUTO_MAX}`;
  const sector = autoForm.sector.value || null;
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const filled = content.trim() ? fillPlaceholders(content.trim(), sector) : '';
  $('#auto-preview').replaceChildren(
    el(
      'div',
      { class: 'bubble bubble--theirs' },
      'Bom dia! Tenho uma dúvida sobre o meu holerite.',
      bubbleMeta(`João Silva · ${sector || 'Produção'} · ${time}`, false),
    ),
    el(
      'div',
      { class: `bubble bubble--mine ${filled ? '' : 'bubble--placeholder'}` },
      filled || 'O texto da resposta automática aparece aqui.',
      bubbleMeta(`${storageGet(USER_KEY) || 'DP'} · ${time}`, true),
    ),
  );
}

function resetAutoForm() {
  autoForm.reset();
  autoForm.id.value = '';
  $('#auto-form-title').textContent = 'Nova resposta automática';
  $('#auto-submit').textContent = 'Salvar';
  $('#auto-cancel').hidden = true;
  renderAutoSectorOptions();
  renderAutoPreview();
}

function startAutoEdit(rule) {
  autoForm.id.value = rule.id;
  renderAutoSectorOptions();
  autoForm.sector.value = rule.sector ?? '';
  autoForm.content.value = rule.content;
  autoForm.active.checked = rule.active;
  $('#auto-form-title').textContent = `Editar resposta: ${autoSectorLabel(rule.sector)}`;
  $('#auto-submit').textContent = 'Salvar alterações';
  $('#auto-cancel').hidden = false;
  $('#auto-feedback').hidden = true;
  renderAutoPreview();
  autoForm.scrollIntoView({ block: 'center' });
  autoForm.content.focus();
}

$('#auto-cancel').addEventListener('click', () => {
  $('#auto-feedback').hidden = true;
  resetAutoForm();
});

autoForm.addEventListener('input', renderAutoPreview);
autoForm.addEventListener('change', renderAutoPreview);

// Chips: inserem o campo onde está o cursor
for (const chip of autoForm.querySelectorAll('[data-placeholder]')) {
  chip.addEventListener('click', () => {
    const area = autoForm.content;
    const token = chip.dataset.placeholder;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? area.value.length;
    if (area.value.length - (end - start) + token.length > AUTO_MAX) return;
    area.focus();
    area.setRangeText(token, start, end, 'end');
    renderAutoPreview();
  });
}

autoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const feedback = $('#auto-feedback');
  const id = autoForm.id.value;
  const content = autoForm.content.value.trim();
  if (!content) {
    showFeedback(feedback, 'Escreva o texto da resposta automática.', true);
    autoForm.content.focus();
    return;
  }
  const payload = { sector: autoForm.sector.value || null, content, active: autoForm.active.checked };
  const button = $('#auto-submit');
  button.disabled = true;
  try {
    if (id) await api('PUT', `/api/auto-replies/${encodeURIComponent(id)}`, payload);
    else await api('POST', '/api/auto-replies', payload);
    resetAutoForm();
    showFeedback(
      feedback,
      `Resposta automática ${id ? 'salva' : 'criada'} para ${autoSectorLabel(payload.sector)}${payload.active ? '' : ' (pausada)'}.`,
      false,
    );
    await loadAutoReplies();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(feedback, err.message, true);
  } finally {
    button.disabled = false;
    renderAutoSectorOptions(); // desabilita de novo se não sobrou setor livre
  }
});

async function toggleAutoReply(rule) {
  const feedback = $('#auto-feedback');
  try {
    await api('PUT', `/api/auto-replies/${encodeURIComponent(rule.id)}`, {
      sector: rule.sector,
      content: rule.content,
      active: !rule.active,
    });
    if (autoForm.id.value === rule.id) autoForm.active.checked = !rule.active;
    showFeedback(feedback, `Resposta de ${autoSectorLabel(rule.sector)} ${rule.active ? 'pausada' : 'ativada'}.`, false);
    await loadAutoReplies();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(feedback, err.message, true);
  }
}

// Confirmação com <dialog> (sem window.confirm)
const confirmDialog = $('#confirm-dialog');

function askConfirm({ title, text, okLabel }) {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    const finish = (value) => {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      confirmDialog.removeEventListener('close', onCancel);
      confirmDialog.removeEventListener('click', onBackdrop);
      if (confirmDialog.open) confirmDialog.close();
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false); // botão Cancelar ou Esc
    const onBackdrop = (event) => {
      if (event.target === confirmDialog) finish(false);
    };
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    confirmDialog.addEventListener('close', onCancel);
    confirmDialog.addEventListener('click', onBackdrop);
    confirmDialog.showModal();
    cancel.focus();
  });
}

async function deleteAutoReply(rule) {
  const label = autoSectorLabel(rule.sector);
  const ok = await askConfirm({
    title: 'Excluir resposta automática?',
    text:
      rule.sector === null
        ? `A resposta de "${label}" será excluída.\nFuncionários de setores sem resposta própria deixam de receber resposta automática.`
        : `A resposta do setor ${label} será excluída.\nOs funcionários desse setor passam a receber a resposta de "Todos os setores", se você tiver uma.`,
    okLabel: 'Excluir',
  });
  if (!ok) return;
  const feedback = $('#auto-feedback');
  try {
    await api('DELETE', `/api/auto-replies/${encodeURIComponent(rule.id)}`);
    if (autoForm.id.value === rule.id) resetAutoForm();
    showFeedback(feedback, `Resposta de ${label} excluída.`, false);
    await loadAutoReplies();
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(feedback, err.message, true);
  }
}

renderAutoSectorOptions();
renderAutoPreview();

// A Central não usa WebSocket: consulta as conversas periodicamente (e a conversa aberta com mais frequência)
setInterval(() => {
  if (!document.hidden && !$('#app-view').hidden) void loadChats();
}, CHAT_LIST_REFRESH_MS);
setInterval(() => {
  if (!document.hidden && !$('#app-view').hidden && chatState.employeeId) void refreshThread(false);
}, CHAT_THREAD_REFRESH_MS);

$('#refresh').addEventListener('click', () => void loadAll());

setInterval(() => {
  if (!document.hidden && !$('#app-view').hidden) void loadAll();
}, AUTO_REFRESH_MS);

// ---------------------------------------------------------------- seção TI (só a conta do TI)

const tiFeedback = $('#ti-feedback');

/** Carrega os dois quadros da seção: conversas (só números) e logins do DP */
async function loadTi(messageCount) {
  if (typeof messageCount === 'number') {
    $('#ti-messages-count').textContent =
      messageCount === 0 ? 'Nenhum comunicado guardado.' : `${messageCount} comunicado(s) guardados hoje.`;
  }
  try {
    const [{ summary }, { users }] = await Promise.all([api('GET', '/api/admin/chats'), api('GET', '/api/admin/users')]);
    renderTiChats(summary);
    renderTiUsers(users);
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(tiFeedback, err.message, true);
  }
}

function renderTiChats(summary) {
  const body = $('#ti-chat-body');
  body.replaceChildren();
  if (summary.length === 0) {
    body.append(el('tr', {}, el('td', { class: 'empty', colspan: '5', text: 'Nenhuma pessoa do DP cadastrada.' })));
    return;
  }
  for (const item of summary) {
    const apagar = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Apagar conversas' });
    if (item.messages === 0) apagar.disabled = true;
    else apagar.addEventListener('click', () => void purgeChatOf(item));
    body.append(
      el(
        'tr',
        {},
        el('td', { text: item.name }),
        el('td', { text: String(item.conversations) }),
        el('td', { text: String(item.messages) }),
        el('td', { text: item.lastAt ? formatDate(item.lastAt) : '—' }),
        el('td', {}, apagar),
      ),
    );
  }
}

function renderTiUsers(users) {
  const body = $('#ti-users-body');
  body.replaceChildren();
  for (const user of users) {
    const ehTi = user.superAdmin;
    const ativo = user.status === 'ACTIVE';
    const acoes = el('div', { class: 'row-actions' });
    if (!ehTi) {
      const alternar = el('button', {
        class: 'btn btn--ghost btn--sm',
        type: 'button',
        text: ativo ? 'Desativar' : 'Ativar',
      });
      alternar.addEventListener('click', () => void toggleTiUser(user));
      const senha = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Redefinir senha' });
      senha.addEventListener('click', () => void resetTiPassword(user));
      acoes.append(alternar, senha);
    }
    body.append(
      el(
        'tr',
        {},
        el('td', { text: user.username }),
        el('td', { text: `${user.name}${ehTi ? ' 🛠️' : ''}` }),
        el('td', { text: ehTi ? 'Conta do TI' : ativo ? 'Ativo' : 'Desativado' }),
        el('td', { text: user.chatContact ? 'Sim' : 'Não' }),
        el('td', {}, acoes),
      ),
    );
  }
}

async function purgeChatOf(item) {
  const ok = await askConfirm({
    title: 'Apagar conversas?',
    text: `Todas as ${item.messages} mensagem(ns) das conversas de ${item.name} com os funcionários serão apagadas. Não dá para desfazer.`,
    okLabel: 'Apagar',
  });
  if (!ok) return;
  await tiAction(() => api('POST', '/api/admin/chats/purge', { dpUserId: item.dpUserId }), (r) => `${r.removed} mensagem(ns) apagada(s).`);
}

$('#ti-chat-purge-all').addEventListener('click', async () => {
  const ok = await askConfirm({
    title: 'Apagar todas as conversas?',
    text: 'Todas as conversas entre o DP e os funcionários serão apagadas, de todas as pessoas do DP. Não dá para desfazer.',
    okLabel: 'Apagar tudo',
  });
  if (!ok) return;
  await tiAction(() => api('POST', '/api/admin/chats/purge', {}), (r) => `${r.removed} mensagem(ns) apagada(s).`);
});

$('#ti-chat-refresh').addEventListener('click', () => void loadTi());

$('#ti-messages-purge').addEventListener('click', async () => {
  const dias = Number($('#ti-messages-days').value);
  const ok = await askConfirm({
    title: 'Apagar comunicados?',
    text: dias > 0
      ? `Os comunicados com mais de ${dias} dias serão apagados, junto com as leituras. Não dá para desfazer.`
      : 'TODOS os comunicados e as leituras serão apagados. Não dá para desfazer.',
    okLabel: 'Apagar',
  });
  if (!ok) return;
  await tiAction(
    () => api('POST', '/api/admin/messages/purge', { olderThanDays: dias > 0 ? dias : null }),
    (r) => `${r.removed} comunicado(s) apagado(s).`,
  );
});

$('#ti-user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const done = await tiAction(
    () =>
      api('POST', '/api/admin/users', {
        username: String(data.get('username') || '').trim(),
        name: String(data.get('name') || '').trim(),
        password: String(data.get('password') || ''),
        chatContact: data.get('chatContact') === 'on',
      }),
    (r) => `Login "${r.user.username}" criado.`,
  );
  if (done) form.reset();
});

async function toggleTiUser(user) {
  const ativando = user.status !== 'ACTIVE';
  if (!ativando) {
    const ok = await askConfirm({
      title: 'Desativar login?',
      text: `${user.name} não vai mais conseguir entrar na Central, e a sessão aberta dele será encerrada. As conversas e os comunicados dele continuam guardados.`,
      okLabel: 'Desativar',
    });
    if (!ok) return;
  }
  await tiAction(
    () => api('PATCH', `/api/admin/users/${user.id}`, { status: ativando ? 'ACTIVE' : 'INACTIVE' }),
    () => `Login ${ativando ? 'ativado' : 'desativado'}.`,
  );
}

/** Abre o cartão de redefinir senha (sem caixa de diálogo do navegador) */
function resetTiPassword(user) {
  const card = $('#ti-password-card');
  const form = $('#ti-password-form');
  form.id.value = user.id;
  form.password.value = '';
  $('#ti-password-title').textContent = `Redefinir a senha de ${user.name} (${user.username})`;
  card.hidden = false;
  card.scrollIntoView({ block: 'nearest' });
  form.password.focus();
}

$('#ti-password-cancel').addEventListener('click', () => {
  $('#ti-password-form').reset();
  $('#ti-password-card').hidden = true;
});

$('#ti-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.id.value;
  const senha = form.password.value;
  const done = await tiAction(
    () => api('POST', `/api/admin/users/${id}/password`, { password: senha }),
    () => 'Senha redefinida. A sessão aberta dessa pessoa foi encerrada.',
  );
  if (done) {
    form.reset();
    $('#ti-password-card').hidden = true;
  }
});

/** Executa uma ação do TI, mostra o resultado e recarrega os quadros */
async function tiAction(run, message) {
  try {
    const result = await run();
    showFeedback(tiFeedback, message(result ?? {}), false);
    await loadAll();
    return true;
  } catch (err) {
    if (err instanceof UnauthorizedError) showLogin('Sessão expirada. Entre novamente.');
    else showFeedback(tiFeedback, err.message, true);
    return false;
  }
}

showSection(location.hash.slice(1) || localGet(SECTION_KEY) || DEFAULT_SECTION);
renderAttachments(); // escreve o aviso dos limites e chama renderPreview()
void start();
