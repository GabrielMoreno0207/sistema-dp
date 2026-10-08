-- ---------------------------------------------------------------------------
-- Conferencia do cadastro de setores (TRINYS_1002_GABRIEL_0438.CSV)
-- Rode DEPOIS do cadastrar-setores-trinys.sql. So le, nao altera nada.
--
-- Confira primeiro em qual schema voce esta (dp = producao, dp_teste = teste):
--   SHOW search_path;
-- ---------------------------------------------------------------------------

-- 1) Resumo: o esperado e 17 de 17, com 0 faltando.
SELECT count(*) FILTER (WHERE s.id IS NOT NULL) AS encontrados,
       count(*)                                 AS esperados,
       count(*) FILTER (WHERE s.id IS NULL)     AS faltando,
       CASE WHEN count(*) = count(*) FILTER (WHERE s.id IS NOT NULL)
            THEN 'OK - todos os 17 estao cadastrados'
            ELSE 'ATENCAO - faltou setor, veja a consulta 2'
       END AS resultado
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
LEFT JOIN sectors s ON translate(lower(s.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') = lower(csv.name);


-- 2) Detalhe linha por linha: mostra o que faltou e a grafia que ficou no banco.
SELECT csv.name                      AS setor_do_csv,
       s.name                        AS como_esta_no_banco,
       CASE WHEN s.id IS NULL        THEN '>>> FALTANDO'
            WHEN s.name = csv.name   THEN 'OK'
            ELSE 'OK (grafia diferente, mantida a do banco)'
       END                           AS situacao,
       s.created_at                  AS cadastrado_em
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
LEFT JOIN sectors s ON translate(lower(s.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') = lower(csv.name)
ORDER BY (s.id IS NOT NULL), lower(csv.name);


-- 3) Checagem de duplicados por acento/caixa (o esperado e 0 linhas).
SELECT translate(lower(s.name), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') AS nome_sem_acento, count(*) AS quantidade, string_agg(s.name, ' | ') AS grafias
FROM sectors s
GROUP BY 1 HAVING count(*) > 1;
