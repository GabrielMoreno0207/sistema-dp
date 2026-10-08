-- ---------------------------------------------------------------------------
-- Cadastro dos 17 setores do TRINYS_1002_GABRIEL_0438.CSV
--
-- É UMA UNICA INSTRUCAO, de proposito: pode colar inteiro em qualquer cliente
-- (Adminer, DBeaver, pgAdmin, psql) que mesmo rodando "so a do cursor" vai
-- cadastrar todos os 17 de uma vez. Nao tem BEGIN/COMMIT: o proprio INSERT ja
-- e atomico, entao ou entra tudo ou nao entra nada.
--
-- Pode rodar quantas vezes quiser: quem ja existe e ignorado (a comparacao
-- ignora maiusculas E acentos, igual ao sameName() do backend).
--
-- ANTES DE RODAR confira o schema (dp = producao, dp_teste = teste):
--   SHOW search_path;
-- ---------------------------------------------------------------------------

INSERT INTO sectors (id, name, created_at)
SELECT gen_random_uuid()::text,
       csv.name,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (VALUES
        ('0A4'),
        ('COD. BARRAS'),
        ('COMERCIAL'),
        ('COMERCIO EXTERIOR'),
        ('COMPRAS CONFECCAO'),
        ('CUSTO CONFECCAO'),
        ('CUSTO SAPATILHA'),
        ('DESENVOLVIMENTO'),
        ('ECOMMERCE'),
        ('ESTOQUE FESTIVAL'),
        ('EXPEDICAO'),
        ('FATURAMENTO'),
        ('LOJA CAIXA'),
        ('LOJA ESTOQUE'),
        ('LOJA GERENTE'),
        ('LOJA MATRIZ'),
        ('PCP-PRODUCAO')
     ) AS csv(name)
WHERE NOT EXISTS (SELECT 1 FROM sectors s WHERE translate(lower(s.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') = lower(csv.name));
