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
-- O schema é "dp" no servidor. Se o seu for outro, troque nas três partes.

SET search_path TO dp;

-- =====================================================================
-- PARTE 1 — CONFERIR (não muda nada)
-- =====================================================================

-- Quem está nos setores do DP hoje
SELECT id, username, name, sector, role
FROM users
WHERE lower(regexp_replace(COALESCE(sector, ''), '[^a-zA-Z0-9]', '', 'g'))
      IN ('dp', 'departamentopessoal', 'departamentodepessoal', 'deptopessoal')
ORDER BY name;

-- Nomes que terminam em DP e vão virar RH
SELECT id, username, name AS nome_atual,
       regexp_replace(name, '(\s|\()+\(?\s*DP\s*\)?\s*$', ' RH', 'i') AS nome_novo
FROM users
WHERE name ~* '(\s|\()+\(?\s*DP\s*\)?\s*$'
ORDER BY name;

-- Setores cadastrados
SELECT id, name FROM sectors ORDER BY name;

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
