-- =============================================================================
-- 0056_divida_pagamentos.sql — quitação avulsa de saldo devedor (⋮ → Receber dívida)
--
-- Até aqui, saldo devedor (clientes.saldo_devedor) só era quitado embutido no
-- valor de uma saída nova (ver Patio.jsx dividaAnterior/valor_dev) — o carro
-- precisava passar pelo pátio de novo. Esta tabela registra a quitação
-- avulsa, direto pela placa, sem depender de uma saída (ex.: o cliente
-- aparece só pra pagar o que deve, sem tirar o carro).
--
-- Mesmo raciocínio já aplicado a valor_dev no Caixa.jsx/caixaRelatorio.js:
-- entra no "Total do turno"/"Total recebido" (é dinheiro de verdade agora),
-- mas NUNCA no Faturado (essa receita já foi contabilizada quando a dívida
-- foi gerada, na saída original) — soma no lado "quitada" de "Dívida (turno)".
-- =============================================================================

create table divida_pagamentos (
  id               uuid primary key default gen_random_uuid(),
  filial_id        uuid not null references filiais (id),
  placa            text not null,
  valor            numeric(10,2) not null,
  forma_pagamento  text not null,                 -- codigo da forma (ver formas_pagamento)
  caixa_id         uuid references caixas (id),    -- caixa que recebeu, na hora do pagamento
  operador_id      uuid references perfis (id),
  criado_em        timestamptz not null default now()
);
comment on table divida_pagamentos is
  'Quitação avulsa do saldo devedor de uma placa (ver Pátio → ⋮ → Receber
  dívida, clientes.saldo_devedor) — fora do fluxo normal de saída, o carro
  pode nem estar no pátio. Soma no fechamento de caixa como dívida quitada
  (Total do turno sim, Faturado não — mesmo raciocínio de movimentos.valor_dev,
  ver Caixa.jsx "Dívida (turno)"). NUNCA gera RPS/NFS-e — não é serviço novo.';
create index divida_pagamentos_caixa_idx on divida_pagamentos (caixa_id);
create index divida_pagamentos_placa_idx on divida_pagamentos (filial_id, placa);

alter table divida_pagamentos enable row level security;
do $$
declare t text;
begin
  foreach t in array array['divida_pagamentos'] loop
    execute format('create policy %I_sel on %I for select to authenticated using (filial_id = filial_do_usuario())', t, t);
    execute format('create policy %I_ins on %I for insert to authenticated with check (filial_id = filial_do_usuario())', t, t);
    execute format('create policy %I_upd on %I for update to authenticated using (filial_id = filial_do_usuario()) with check (filial_id = filial_do_usuario())', t, t);
    execute format('create policy %I_del on %I for delete to authenticated using (filial_id = filial_do_usuario())', t, t);
  end loop;
end $$;
