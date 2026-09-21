export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Migrações do banco, aplicadas em ordem na inicialização.
 * Nunca altere uma migração já aplicada: crie uma nova com o próximo número.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'computadores e mensagens',
    sql: `
      CREATE TABLE computers (
        computer_id   TEXT PRIMARY KEY,
        hostname      TEXT NOT NULL,
        app_version   TEXT NOT NULL,
        platform      TEXT NOT NULL,
        status        TEXT NOT NULL CHECK (status IN ('ONLINE', 'OFFLINE')),
        registered_at TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL
      );

      CREATE TABLE messages (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        content    TEXT NOT NULL,
        type       TEXT NOT NULL,
        target     TEXT NOT NULL,
        target_id  TEXT,
        sender     TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_messages_target ON messages (target, target_id);

      CREATE TABLE message_reads (
        message_seq INTEGER NOT NULL REFERENCES messages (seq) ON DELETE CASCADE,
        computer_id TEXT NOT NULL,
        read_at     TEXT NOT NULL,
        PRIMARY KEY (message_seq, computer_id)
      );
      CREATE INDEX idx_message_reads_computer ON message_reads (computer_id);
    `,
  },
  {
    version: 2,
    name: 'autenticação',
    sql: `
      -- Segredo próprio de cada instalação (hash), exigido nos registros seguintes do mesmo PC
      ALTER TABLE computers ADD COLUMN secret_hash TEXT;

      -- Usuários: hoje só o DP (ADMIN); estrutura pronta para funcionários
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name          TEXT NOT NULL,
        registration  TEXT,
        sector        TEXT,
        shift         TEXT,
        role          TEXT NOT NULL CHECK (role IN ('ADMIN', 'EMPLOYEE')),
        status        TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );

      -- Tokens de acesso (guardamos só o hash SHA-256)
      CREATE TABLE auth_tokens (
        token_hash   TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('USER', 'COMPUTER')),
        subject_id   TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        expires_at   TEXT
      );
      CREATE INDEX idx_auth_tokens_subject ON auth_tokens (subject_type, subject_id);
    `,
  },
  {
    version: 3,
    name: 'login do funcionário',
    sql: `
      -- Leitura passa a ser por "leitor": o funcionário logado no PC ou, sem login, o próprio PC
      ALTER TABLE message_reads RENAME COLUMN computer_id TO reader_id;
      DROP INDEX idx_message_reads_computer;
      CREATE INDEX idx_message_reads_reader ON message_reads (reader_id);

      -- Funcionário atualmente logado em cada computador
      ALTER TABLE computers ADD COLUMN current_user_id TEXT REFERENCES users (id);

      -- Matrícula única entre funcionários
      CREATE UNIQUE INDEX idx_users_registration ON users (registration) WHERE registration IS NOT NULL;
    `,
  },
  {
    version: 4,
    name: 'validade da sessão e troca de senha obrigatória',
    sql: `
      -- Quando o funcionário entrou no computador (a sessão expira após EMPLOYEE_SESSION_HOURS)
      ALTER TABLE computers ADD COLUMN current_user_since TEXT;

      -- 1 = precisa trocar a senha no próximo acesso (senha inicial ou redefinida pelo DP)
      ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 5,
    name: 'cadastro de setores',
    sql: `
      CREATE TABLE sectors (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL
      );

      -- Setores que já estavam em uso nos funcionários entram no cadastro
      INSERT OR IGNORE INTO sectors (id, name, created_at)
        SELECT lower(hex(randomblob(16))), sector, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        FROM (SELECT DISTINCT sector FROM users WHERE role = 'EMPLOYEE' AND sector IS NOT NULL);
    `,
  },
  {
    version: 6,
    name: 'computador da leitura',
    sql: `
      -- Em qual computador a mensagem foi lida (para a Central mostrar "lida no PC X")
      ALTER TABLE message_reads ADD COLUMN computer_id TEXT;
      UPDATE message_reads SET computer_id = reader_id WHERE reader_id LIKE 'PC-%';
    `,
  },
  {
    version: 7,
    name: 'chat entre o DP e o funcionário',
    sql: `
      -- Uma conversa por funcionário com o DP (employee_id identifica a conversa)
      CREATE TABLE chat_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id TEXT NOT NULL,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('DP', 'EMPLOYEE')),
        sender_name TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        -- quando o outro lado leu (DP → funcionário: o funcionário; funcionário → DP: qualquer pessoa do DP)
        read_at     TEXT
      );
      CREATE INDEX idx_chat_employee ON chat_messages (employee_id, id);
    `,
  },
  {
    version: 8,
    name: 'nome de quem leu e grafia dos setores',
    sql: `
      -- Guarda nome e matrícula de quem leu: excluir o funcionário não apaga "quem leu"
      ALTER TABLE message_reads ADD COLUMN reader_name TEXT;
      ALTER TABLE message_reads ADD COLUMN reader_registration TEXT;
      UPDATE message_reads
        SET reader_name = (SELECT name FROM users u WHERE u.id = message_reads.reader_id),
            reader_registration = (SELECT registration FROM users u WHERE u.id = message_reads.reader_id)
        WHERE reader_id NOT LIKE 'PC-%';

      -- Alinha o setor dos funcionários à grafia do cadastro (a migração 5 descartou variações de maiúsculas)
      UPDATE users
        SET sector = (SELECT s.name FROM sectors s WHERE s.name = users.sector COLLATE NOCASE)
        WHERE role = 'EMPLOYEE' AND sector IS NOT NULL
          AND EXISTS (SELECT 1 FROM sectors s WHERE s.name = users.sector COLLATE NOCASE);
    `,
  },
  {
    version: 9,
    name: 'chat individual com cada pessoa do DP',
    sql: `
      -- A conversa passa a ser (funcionário, pessoa do DP)
      ALTER TABLE chat_messages ADD COLUMN dp_user_id TEXT;

      -- Conversas antigas: mensagem do DP fica com quem a escreveu (pelo nome)...
      UPDATE chat_messages
        SET dp_user_id = (SELECT u.id FROM users u WHERE u.role = 'ADMIN' AND u.name = chat_messages.sender_name LIMIT 1)
        WHERE sender_type = 'DP';
      -- ...mensagem do funcionário fica com a pessoa do DP que respondeu por último nessa conversa...
      UPDATE chat_messages
        SET dp_user_id = (SELECT m.dp_user_id FROM chat_messages m
                          WHERE m.employee_id = chat_messages.employee_id AND m.dp_user_id IS NOT NULL
                          ORDER BY m.id DESC LIMIT 1)
        WHERE dp_user_id IS NULL;
      -- ...e o que sobrar (ninguém do DP respondeu) vai para o login mais antigo do DP
      UPDATE chat_messages
        SET dp_user_id = (SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at LIMIT 1)
        WHERE dp_user_id IS NULL;

      CREATE INDEX idx_chat_conversation ON chat_messages (employee_id, dp_user_id, id);

      -- 1 = aparece na lista de contatos do chat no app (pessoas do DP); 0 = não (ex.: TI, admin)
      ALTER TABLE users ADD COLUMN chat_contact INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 10,
    name: 'resposta automática do chat',
    sql: `
      -- 1 = enviada pela resposta automática (o app e a Central mostram uma etiqueta)
      ALTER TABLE chat_messages ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0;

      -- Textos que cada pessoa do DP escolhe, por setor do funcionário
      CREATE TABLE auto_replies (
        id TEXT PRIMARY KEY,
        dp_user_id TEXT NOT NULL,
        sector TEXT, -- NULL = todos os setores (usada quando não há uma para o setor)
        content TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_auto_replies_sector ON auto_replies (dp_user_id, COALESCE(sector, ''));
    `,
  },
  {
    version: 11,
    name: 'índices para muitos computadores e conversas',
    sql: `
      -- Lista de conversas de cada pessoa do DP (a Central consulta a cada 10 s)
      CREATE INDEX idx_chat_dp ON chat_messages (dp_user_id, employee_id, id);
      -- Contagem de destinatários por setor/turno e cadastro de funcionários
      CREATE INDEX idx_users_role_sector ON users (role, sector);
      CREATE INDEX idx_users_role_shift ON users (role, shift);
      -- Computador em que cada funcionário está logado
      CREATE INDEX idx_computers_current_user ON computers (current_user_id);
      ANALYZE;
    `,
  },
  {
    version: 12,
    name: 'conta do TI com poderes extras',
    sql: `
      -- 1 = login do TI: além do que o DP faz, pode apagar comunicados e conversas e
      -- gerenciar os logins do DP. Continua sem ler o conteúdo das conversas.
      ALTER TABLE users ADD COLUMN super_admin INTEGER NOT NULL DEFAULT 0;
      UPDATE users SET super_admin = 1 WHERE role = 'ADMIN' AND username = 'ti' COLLATE NOCASE;
    `,
  },
  {
    version: 13,
    name: 'anexos dos comunicados',
    sql: `
      -- Arquivos e imagens anexados pelo DP. O conteúdo fica em data/uploads/;
      -- aqui ficam só os dados (nome original, tipo, tamanho).
      CREATE TABLE attachments (
        id          TEXT PRIMARY KEY,
        -- NULL = enviado para o servidor mas o comunicado ainda não foi enviado (some na faxina)
        message_seq INTEGER REFERENCES messages (seq) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        size        INTEGER NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('IMAGE', 'FILE')),
        -- nome do arquivo dentro da pasta de anexos
        stored_name TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_attachments_message ON attachments (message_seq);
      CREATE INDEX idx_attachments_pending ON attachments (created_at) WHERE message_seq IS NULL;
    `,
  },
  {
    version: 14,
    name: 'mural, mídias, atalhos e foto de perfil',
    sql: `
      -- Imagens e vídeos do mural e fotos de perfil. O arquivo fica em data/midias;
      -- aqui ficam só os dados (nome original, tipo, tamanho, hash).
      CREATE TABLE midias (
        id          TEXT PRIMARY KEY,
        tipo        TEXT NOT NULL CHECK (tipo IN ('IMAGEM', 'VIDEO')),
        nome        TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        tamanho     INTEGER NOT NULL,
        sha256      TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        enviado_por TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      -- Mural: o recado que a Central do DP deixa fixado na tela inicial
      CREATE TABLE mural_posts (
        id         TEXT PRIMARY KEY,
        titulo     TEXT NOT NULL,
        texto      TEXT NOT NULL,
        midia_id   TEXT REFERENCES midias (id) ON DELETE SET NULL,
        ativo      INTEGER NOT NULL DEFAULT 1,
        criado_por TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_mural_ativo ON mural_posts (ativo, created_at);

      -- Atalhos que cada colaborador monta na tela inicial
      CREATE TABLE atalhos (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        ordem      INTEGER NOT NULL,
        rotulo     TEXT NOT NULL,
        icone      TEXT NOT NULL,
        cor        TEXT NOT NULL,
        destino    TEXT NOT NULL CHECK (destino IN ('COMUNICADOS', 'CHAT', 'PERFIL', 'CONFIGURACOES', 'MURAL')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_atalhos_user ON atalhos (user_id, ordem);

      -- Foto de perfil do colaborador
      ALTER TABLE users ADD COLUMN foto_midia_id TEXT REFERENCES midias (id);
    `,
  },
  {
    version: 15,
    name: 'chamados para o TI',
    sql: `
      -- Chamados abertos para o TI (separados do chat com o DP)
      CREATE TABLE chamados (
        id                TEXT PRIMARY KEY,
        -- número curto, o que as pessoas falam ("chamado 42")
        numero            INTEGER NOT NULL UNIQUE,
        titulo            TEXT NOT NULL,
        descricao         TEXT NOT NULL,
        categoria         TEXT NOT NULL CHECK (categoria IN ('COMPUTADOR', 'IMPRESSORA', 'SISTEMA', 'REDE', 'ACESSO', 'OUTRO')),
        prioridade        TEXT NOT NULL CHECK (prioridade IN ('BAIXA', 'NORMAL', 'ALTA')),
        status            TEXT NOT NULL CHECK (status IN ('ABERTO', 'EM_ANDAMENTO', 'RESOLVIDO', 'FECHADO')),
        -- quem abriu: funcionário no app ou pessoa do DP na Central
        solicitante_id    TEXT NOT NULL,
        -- nome guardado junto: excluir o usuário não apaga o histórico do chamado
        solicitante_nome  TEXT NOT NULL,
        -- de qual computador foi aberto (ajuda o TI a achar a máquina)
        computador_id     TEXT,
        -- pessoa do TI que assumiu
        responsavel_id    TEXT,
        responsavel_nome  TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        resolvido_em      TEXT
      );
      CREATE INDEX idx_chamados_status ON chamados (status, created_at);
      CREATE INDEX idx_chamados_solicitante ON chamados (solicitante_id, created_at);

      -- Conversa dentro do chamado
      CREATE TABLE chamado_mensagens (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chamado_id  TEXT NOT NULL REFERENCES chamados (id) ON DELETE CASCADE,
        autor_id    TEXT NOT NULL,
        autor_nome  TEXT NOT NULL,
        autor_tipo  TEXT NOT NULL CHECK (autor_tipo IN ('SOLICITANTE', 'TI')),
        conteudo    TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        -- quando o outro lado leu
        lida_em     TEXT
      );
      CREATE INDEX idx_chamado_mensagens ON chamado_mensagens (chamado_id, id);

      -- Prints e fotos anexados na abertura do chamado
      CREATE TABLE chamado_midias (
        chamado_id TEXT NOT NULL REFERENCES chamados (id) ON DELETE CASCADE,
        midia_id   TEXT NOT NULL REFERENCES midias (id) ON DELETE CASCADE,
        ordem      INTEGER NOT NULL,
        PRIMARY KEY (chamado_id, midia_id)
      );
    `,
  },
  {
    version: 16,
    name: 'conversas entre pessoas e grupos',
    sql: `
      -- midias passa a aceitar documentos (PDF, Word, Excel) além de imagem e vídeo.
      -- O SQLite não altera CHECK, então a tabela é refeita com o mesmo conteúdo.
      CREATE TABLE midias_nova (
        id          TEXT PRIMARY KEY,
        tipo        TEXT NOT NULL CHECK (tipo IN ('IMAGEM', 'VIDEO', 'ARQUIVO')),
        nome        TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        tamanho     INTEGER NOT NULL,
        sha256      TEXT NOT NULL,
        stored_name TEXT NOT NULL,
        enviado_por TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      INSERT INTO midias_nova SELECT * FROM midias;
      DROP TABLE midias;
      ALTER TABLE midias_nova RENAME TO midias;

      -- Conversas: diretas (duas pessoas) ou grupos
      CREATE TABLE conversas (
        id         TEXT PRIMARY KEY,
        tipo       TEXT NOT NULL CHECK (tipo IN ('DIRETA', 'GRUPO')),
        -- só para grupo
        nome       TEXT,
        criado_por TEXT NOT NULL,
        created_at TEXT NOT NULL,
        -- última movimentação: ordena a lista de conversas
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_conversas_movimento ON conversas (updated_at);

      -- Quem participa de cada conversa
      CREATE TABLE conversa_membros (
        conversa_id    TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
        user_id        TEXT NOT NULL,
        -- ADMIN do grupo: muda o nome e mexe nos participantes
        papel          TEXT NOT NULL CHECK (papel IN ('ADMIN', 'MEMBRO')),
        entrou_em      TEXT NOT NULL,
        -- data da última vez que abriu (conta as não lidas)
        ultima_leitura TEXT,
        -- saiu do grupo: fica no histórico, sem receber mensagem nova
        saiu_em        TEXT,
        PRIMARY KEY (conversa_id, user_id)
      );
      CREATE INDEX idx_conversa_membros_user ON conversa_membros (user_id, saiu_em);

      CREATE TABLE conversa_mensagens (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        conversa_id TEXT NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
        autor_id    TEXT NOT NULL,
        -- nome guardado junto: excluir o usuário não apaga o histórico
        autor_nome  TEXT NOT NULL,
        -- SISTEMA: "fulano entrou no grupo", "beltrano saiu"
        tipo        TEXT NOT NULL CHECK (tipo IN ('TEXTO', 'MIDIA', 'SISTEMA')),
        conteudo    TEXT NOT NULL,
        -- imagem, vídeo ou documento anexado
        midia_id    TEXT REFERENCES midias (id),
        -- resposta automática de uma pessoa do DP
        automatica  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        apagada_em  TEXT
      );
      CREATE INDEX idx_conversa_mensagens ON conversa_mensagens (conversa_id, id);

      -- Registro de quando o TI abre uma conversa (auditoria de quem leu o quê)
      CREATE TABLE conversa_acessos_ti (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        conversa_id  TEXT NOT NULL,
        usuario_id   TEXT NOT NULL,
        usuario_nome TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_acessos_ti ON conversa_acessos_ti (conversa_id, created_at);
    `,
  },
];
