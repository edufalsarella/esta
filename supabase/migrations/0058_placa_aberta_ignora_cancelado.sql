-- =============================================================================
-- 0058_placa_aberta_ignora_cancelado.sql — estadia CANCELADA não ocupa mais a
-- placa no pátio
--
-- movimentos_aberto_por_placa_idx (0001) impede duas estadias abertas da
-- mesma placa na mesma filial, mas "aberta" era só dt_saida IS NULL. Entrada
-- cancelada (excluido_em preenchido) continua com dt_saida nulo — a placa
-- ficava travada pra sempre naquela filial ("Essa placa já está no pátio",
-- com o pátio vazio). O índice do nº do ticket (movimentos_controle_patio_uidx)
-- já ignorava as canceladas; este passa a ignorar também.
--
-- Não altera dado nenhum — só troca o índice por um mais permissivo.
-- =============================================================================

drop index if exists movimentos_aberto_por_placa_idx;
create unique index movimentos_aberto_por_placa_idx
  on movimentos (filial_id, placa)
  where dt_saida is null and excluido_em is null;
