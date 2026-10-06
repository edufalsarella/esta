-- =============================================================================
-- 0061_pacote_encerramento.sql — pacote (mensalista tipo 'P') se encerra
-- sozinho e é excluído 7 dias depois, sem perder o histórico de dinheiro.
--
-- Regra (combinada com o Eduardo):
--   • Pacote ativo cuja data "Próx. pagamento" já passou (a partir do dia
--     seguinte, sem contar a tolerância) é desativado e marcado com
--     `pacote_encerrado_em`.
--   • 7 dias depois do encerramento, se continuar inativo, o cadastro é
--     excluído (a placa fica livre) — menos se houver dívida pendente
--     (mensalista_extras ainda não cobrado), que fica pra alguém resolver.
--   • Reativar (marcar Ativo de novo) ou renovar (avançar o Próx. pagamento
--     pra hoje ou depois) desfaz o encerramento.
--   • Desativar na mão NÃO marca `pacote_encerrado_em` — não é excluído.
--
-- Pra exclusão não apagar dinheiro já recebido (fechamentos de caixa e
-- BI/Painel), os recebimentos deixam de ser apagados junto com o cadastro:
-- guardam o nome do cliente (`mensalista_nome`) e ficam com
-- mensalista_id = null. Mesma coisa pros títulos a receber.
--
-- Roda no próprio Postgres (pg_cron), todo dia 03:10 UTC (00:10 em
-- Brasília) — mesmo padrão de 0036_limpeza_reservas_antigas.sql.
-- =============================================================================

-- 1) Recebimentos sobrevivem à exclusão do cadastro, com o nome guardado.
alter table mensalista_pagamentos add column mensalista_nome text;
comment on column mensalista_pagamentos.mensalista_nome is
  'Nome do mensalista no momento do recebimento — continua aparecendo no caixa/BI mesmo se o cadastro for excluído (ver 0061).';

update mensalista_pagamentos p set mensalista_nome = m.razao
  from mensalistas m where m.id = p.mensalista_id and p.mensalista_nome is null;

create or replace function mensalista_pagamentos_guarda_nome() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mensalista_nome is null and new.mensalista_id is not null then
    select razao into new.mensalista_nome from mensalistas where id = new.mensalista_id;
  end if;
  return new;
end $$;

create trigger mensalista_pagamentos_guarda_nome before insert on mensalista_pagamentos
  for each row execute function mensalista_pagamentos_guarda_nome();

alter table mensalista_pagamentos alter column mensalista_id drop not null;
alter table mensalista_pagamentos drop constraint mensalista_pagamentos_mensalista_id_fkey;
alter table mensalista_pagamentos add constraint mensalista_pagamentos_mensalista_id_fkey
  foreign key (mensalista_id) references mensalistas (id) on delete set null;

-- Títulos a receber já têm cliente_nome; só não podem travar a exclusão.
alter table titulos_receber drop constraint titulos_receber_mensalista_id_fkey;
alter table titulos_receber add constraint titulos_receber_mensalista_id_fkey
  foreign key (mensalista_id) references mensalistas (id) on delete set null;

-- 2) Marca do encerramento automático.
alter table mensalistas add column pacote_encerrado_em timestamptz;
comment on column mensalistas.pacote_encerrado_em is
  'Quando o pacote (tipo P) foi desativado automaticamente por vencer o Próx. pagamento. 7 dias depois, ainda inativo, o cadastro é excluído (ver 0061). Null = não encerrado automaticamente.';

-- Reativar ou renovar desfaz o encerramento.
create or replace function mensalistas_reabre_pacote() returns trigger
language plpgsql as $$
begin
  if old.pacote_encerrado_em is not null then
    if new.ativo and not old.ativo then
      new.pacote_encerrado_em := null;
    elsif new.proximo_pagamento is distinct from old.proximo_pagamento
      and new.proximo_pagamento >= (now() at time zone 'America/Sao_Paulo')::date then
      new.ativo := true;
      new.pacote_encerrado_em := null;
    end if;
  end if;
  return new;
end $$;

create trigger mensalistas_reabre_pacote before update on mensalistas
  for each row execute function mensalistas_reabre_pacote();

-- 3) Rotina diária: encerra os vencidos e exclui os encerrados há 7 dias.
create or replace function encerrar_pacotes() returns void
language plpgsql security definer set search_path = public as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  update mensalistas
     set ativo = false, pacote_encerrado_em = now()
   where tipo_mens = 'P' and ativo
     and proximo_pagamento is not null and proximo_pagamento < hoje;

  delete from mensalistas m
   where m.tipo_mens = 'P' and not m.ativo
     and m.pacote_encerrado_em < now() - interval '7 days'
     and not exists (select 1 from mensalista_extras e
                      where e.mensalista_id = m.id and e.cobrado_em is null);
end $$;

revoke execute on function encerrar_pacotes() from public, anon, authenticated;

select cron.schedule('encerrar_pacotes', '10 3 * * *', $$ select encerrar_pacotes() $$);
