-- =============================================================================
-- 0055_reforco_caixa.sql — reforço de caixa (suprimento), o oposto da sangria
--
-- Reaproveita a tabela `sangrias` (mesmo formato: valor + motivo + caixa +
-- operador) em vez de criar uma tabela nova — só ganha um `tipo` pra
-- diferenciar retirada de entrada. Linhas existentes (todas sangria de
-- verdade) viram 'sangria' pelo default, sem precisar de UPDATE.
-- =============================================================================

alter table sangrias add column tipo text not null default 'sangria'
  check (tipo in ('sangria', 'reforco'));
comment on column sangrias.tipo is
  'sangria = retirada de dinheiro do caixa (comportamento de sempre, sai do
  esperado no caixa). reforco = suprimento/entrada de dinheiro durante o
  turno (ex.: troco reforçado no meio do dia) — soma no esperado no caixa em
  vez de subtrair. Ver Caixa.jsx.';
