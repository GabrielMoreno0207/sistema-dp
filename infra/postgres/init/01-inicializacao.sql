-- Executado apenas na PRIMEIRA criação do banco (quando o volume está vazio).
-- Para rodar de novo: docker compose -f docker-compose.postgres.yml down -v (apaga os dados).

-- pgcrypto: gen_random_uuid() para chaves primárias e funções de hash.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- citext: colunas de texto que ignoram maiúsculas/minúsculas na comparação,
-- úteis para login (username) e matrícula, imitando o NOCASE do SQLite.
CREATE EXTENSION IF NOT EXISTS citext;

-- unaccent: busca que ignora acentos ("producao" encontra "Produção").
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Schema onde as tabelas do sistema vão ficar.
CREATE SCHEMA IF NOT EXISTS dp;

-- Faz o schema dp ser o padrão nas conexões deste banco.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO dp, public', current_database());
END
$$;
