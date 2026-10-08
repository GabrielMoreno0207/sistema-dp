-- Renomeia o Departamento Pessoal para RH nos dados do servidor.
--
-- O código já aceita os dois nomes de setor (acesso-por-setor.ts), então este
-- script pode rodar depois que o servidor novo subir, sem pressa e sem ninguém
-- perder acesso no meio do caminho.
--
-- COMO USAR (DBeaver, conectado no banco do servidor):
--   1. Rode só a PARTE 1 e confira na tela o que vai mudar.
--   2. Rode a PARTE 2 inteira, de uma vez (ela é uma transação só).
--   3. Rode a PARTE 3 para conferir o resultado.
--
-- ATENÇÃO AO AUTO-COMMIT (foi o que pegou na primeira vez):
-- O DBeaver vem em auto-commit, e aí cada comando é confirmado sozinho. O
-- BEGIN abre uma transação que fecha na hora, e o COMMIT reclama "there is no
-- transaction in progress". Duas saídas:
--   a) mudar para Manual Commit na barra de ferramentas, e aí a PARTE 2 roda
--      como transação de verdade; ou
--   b) deixar em auto-commit e rodar os três UPDATE da PARTE 2 um a um
--      (Ctrl+Enter), conferindo o "Updated Rows" de CADA um.
-- Em auto-commit o "Updated Rows: 0" que aparece no fim é do COMMIT, não dos
-- UPDATE — ele não diz nada sobre quantas linhas mudaram.
--
-- CONEXÃO (DBeaver): host 192.168.20.1, porta 5433, banco sistema_dp,
-- usuário sistema_dp. A senha está no servidor, em /opt/comunicacao-dp:
--   grep POSTGRES_PASSWORD .env.postgres
-- Atenção: NÃO é o 192.168.20.10 (só HTTPS do domínio) nem a porta 5432.
--
-- As tabelas estão no schema "dp". As consultas abaixo escrevem "dp." na frente
-- de propósito, assim cada uma funciona sozinha com Ctrl+Enter, sem depender da
-- linha de search_path ter sido rodada antes.

SET search_path TO dp;

-- =====================================================================
-- PARTE 1 — CONFERIR (não muda nada)
-- =====================================================================

-- 1.1 Quem é o quê, pelos olhos do sistema.
--     A coluna "acesso" repete a mesma regra do acesso-por-setor.ts: é ela que
--     decide quem abre as telas de administração.
SELECT
  username,
  name,
  sector,
  role,
  CASE
    WHEN lower(regexp_replace(COALESCE(sector,''), '[^a-zA-Z0-9]', '', 'g'))
         IN ('dp','departamentopessoal','departamentodepessoal','deptopessoal')
      THEN 'DP (antigo)'
    WHEN lower(regexp_replace(COALESCE(sector,''), '[^a-zA-Z0-9]', '', 'g'))
         IN ('rh','recursoshumanos','deptorecursoshumanos','departamentoderecursoshumanos')
      THEN 'RH (novo)'
    WHEN lower(regexp_replace(COALESCE(sector,''), '[^a-zA-Z0-9]', '', 'g'))
         IN ('ti','tecnologiadainformacao','tecnologiadeinformacao','informatica')
      THEN 'TI'
    ELSE 'sem acesso admin'
  END AS acesso
FROM dp.users
ORDER BY acesso, name;

-- 1.2 Nomes que terminam em DP, com a prévia de como ficariam
SELECT username, name AS nome_atual,
       regexp_replace(name, '(\s|\()+\(?\s*DP\s*\)?\s*$', ' RH', 'i') AS vira
FROM dp.users
WHERE name ~* '(\s|\()+\(?\s*DP\s*\)?\s*$'
ORDER BY name;

-- 1.3 Setores cadastrados
SELECT id, name FROM dp.sectors ORDER BY name;

-- 1.4 Resumo: quantos serão afetados
SELECT
  count(*) FILTER (WHERE name ~* '(\s|\()+\(?\s*DP\s*\)?\s*$')         AS nomes_com_dp,
  count(*) FILTER (WHERE lower(regexp_replace(COALESCE(sector,''), '[^a-zA-Z0-9]', '', 'g'))
                   IN ('dp','departamentopessoal','departamentodepessoal','deptopessoal')) AS setor_dp,
  count(*) FILTER (WHERE lower(regexp_replace(COALESCE(sector,''), '[^a-zA-Z0-9]', '', 'g'))
                   IN ('rh','recursoshumanos'))                         AS setor_rh
FROM dp.users;

-- =====================================================================
-- PARTE 2 — APLICAR (rode tudo junto)
-- =====================================================================

BEGIN;

-- 2.1 O setor na lista de setores.
--     sectors.name é CITEXT com UNIQUE: se "RH" já existir, renomear daria
--     conflito. Por isso: apaga o antigo quando o RH já existe, senão renomeia.
DELETE FROM sectors
WHERE lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))
      IN ('dp', 'departamentopessoal', 'departamentodepessoal', 'deptopessoal')
  AND EXISTS (SELECT 1 FROM sectors s2 WHERE s2.name = 'RH');

UPDATE sectors
SET name = 'RH'
WHERE lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))
      IN ('dp', 'departamentopessoal', 'departamentodepessoal', 'deptopessoal');

-- 2.2 O setor de cada pessoa
UPDATE users
SET sector = 'RH'
WHERE lower(regexp_replace(COALESCE(sector, ''), '[^a-zA-Z0-9]', '', 'g'))
      IN ('dp', 'departamentopessoal', 'departamentodepessoal', 'deptopessoal');

-- 2.3 O sufixo do nome: "Andressa DP" e "Andressa (DP)" viram "Andressa RH".
--     O login (username) não muda, como combinado.
UPDATE users
SET name = regexp_replace(name, '(\s|\()+\(?\s*DP\s*\)?\s*$', ' RH', 'i')
WHERE name ~* '(\s|\()+\(?\s*DP\s*\)?\s*$';

COMMIT;

-- =====================================================================
-- PARTE 3 — CONFERIR O RESULTADO
-- =====================================================================

-- Deve listar o pessoal do RH, com nome terminando em RH
SELECT id, username, name, sector, role
FROM users
WHERE sector = 'RH'
ORDER BY name;

-- Deve voltar VAZIO: ninguém mais no setor antigo
SELECT id, username, name, sector
FROM users
WHERE lower(regexp_replace(COALESCE(sector, ''), '[^a-zA-Z0-9]', '', 'g'))
      IN ('dp', 'departamentopessoal', 'departamentodepessoal', 'deptopessoal');

-- Deve voltar VAZIO: nenhum nome terminando em DP
SELECT id, username, name FROM users WHERE name ~* '(\s|\()+\(?\s*DP\s*\)?\s*$';
