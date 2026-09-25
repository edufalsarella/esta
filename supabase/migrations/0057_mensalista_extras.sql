-- =============================================================================
-- 0057_mensalista_extras.sql — dívida de avulso cobrada na mensalidade de um
-- mensalista (Pátio → saída → forma "Devedor" → "Mensalista")
--
-- Até aqui, forma "Devedor" só tinha um destino: clientes.saldo_devedor por
-- PLACA (ver 0056_divida_pagamentos.sql), cobrado na próxima saída da MESMA
-- placa ou avulso (⋮ → Receber dívida). Agora o operador pode, na hora de
-- escolher "Devedor", atribuir o valor a um MENSALISTA em vez da placa —
-- útil quando quem realmente vai pagar é a empresa/cliente mensalista (ex.:
-- visitante de uma empresa com convênio mensal), não o motorista avulso.
-- Só mensalistas com hora_extra=true (ver 0001_core_schema.sql, "Aceita
-- Extra?" no cadastro) aparecem na lista pra escolher.
--
-- O valor fica pendente aqui até a PRÓXIMA mensalidade desse mensalista ser
-- recebida — ReceberMensalidade.jsx soma os pendentes no valor sugerido, e
-- ao confirmar o pagamento marca cobrado_em + mensalidade_pagamento_id
-- (nunca apaga a linha, fica de histórico).
-- =============================================================================

create table mensalista_extras (
  id                       uuid primary key default gen_random_uuid(),
  filial_id                uuid not null references filiais (id),
  mensalista_id            uuid not null references mensalistas (id) on delete cascade,
  movimento_id             uuid references movimentos (id),
  placa                    text not null,
  valor                    numeric(10,2) not null,
  criado_em                timestamptz not null default now(),
  cobrado_em               timestamptz,                                   -- null = ainda pendente
  mensalidade_pagamento_id uuid references mensalista_pagamentos (id)
);
comment on table mensalista_extras is
  'Dívida de saída avulsa (forma "Devedor") atribuída a um mensalista em vez
  da placa (ver Pátio → saída → Devedor → "Mensalista") — fica pendente até
  entrar na próxima mensalidade paga dele (ReceberMensalidade.jsx). Já conta
  como Faturado na hora da saída (movimentos.valor, igual "Avulso") — na
  mensalidade que cobra de volta, o valor bundled não pode contar de novo no
  Faturado (ver mensalista_pagamentos.valor_extra e Caixa.jsx/caixaRelatorio.js
  "Dívida (turno)", mesmo raciocínio de movimentos.valor_dev).';
create index mensalista_extras_pendentes_idx on mensalista_extras (mensalista_id) where cobrado_em is null;

alter table mensalista_pagamentos add column valor_extra numeric(10,2) not null default 0;
comment on column mensalista_pagamentos.valor_extra is
  'Parte do valor_pago que é dívida de avulso já cobrada antes (ver
  mensalista_extras) — não conta como Faturado novo nesta mensalidade,
  senão a mesma estadia é contada duas vezes (uma na saída avulsa, outra
  aqui). Faturado desta mensalidade = valor_pago - valor_extra.';

alter table mensalista_extras enable row level security;
do $$
declare t text;
begin
  foreach t in array array['mensalista_extras'] loop
    execute format('create policy %I_sel on %I for select to authenticated using (filial_id = filial_do_usuario())', t, t);
    execute format('create policy %I_ins on %I for insert to authenticated with check (filial_id = filial_do_usuario())', t, t);
    execute format('create policy %I_upd on %I for update to authenticated using (filial_id = filial_do_usuario()) with check (filial_id = filial_do_usuario())', t, t);
    execute format('create policy %I_del on %I for delete to authenticated using (filial_id = filial_do_usuario())', t, t);
  end loop;
end $$;
