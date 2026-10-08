-- =============================================================================
-- 0063_controle_reinicio.sql — número de controle do ticket volta pro 1 a
-- cada N dias (Configurações → Opções do pátio, padrão 1 = todo dia) e
-- tem um botão de reinício manual (supervisor pra cima).
--
-- Antes (0020) a sequência só voltava pro 1 depois do 9999. Agora ela
-- recomeça no início de cada ciclo: a "última" entrada considerada é só a
-- do ciclo atual. Continua pulando os números dos carros que ainda estão
-- no pátio (o índice único de 0020 segue garantindo que não repete ali).
--
-- Ciclo:
--   • `config.patio.controleReinicioDias` (padrão 1; 0 = não reinicia
--     sozinho, só no botão);
--   • os ciclos contam a partir do último reinício manual
--     (`filiais.controle_reiniciado_em`); sem nenhum, a partir de uma
--     segunda-feira fixa (03/01/2000) — com 7 dias, vira toda segunda;
--   • sempre à meia-noite de Brasília, exceto o próprio reinício manual,
--     que vale a partir do momento do clique.
-- =============================================================================

alter table filiais add column controle_reiniciado_em timestamptz;
comment on column filiais.controle_reiniciado_em is
  'Último reinício manual do número de controle do ticket (ver 0063). Também é a referência pra contar os ciclos de N dias.';

create or replace function inicio_ciclo_controle(p_filial uuid)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  txt       text;
  dias      integer;
  base      timestamptz;
  base_dia  date;
  hoje      date := (now() at time zone 'America/Sao_Paulo')::date;
  ciclo     date;
begin
  select config->'patio'->>'controleReinicioDias', controle_reiniciado_em
    into txt, base
    from filiais where id = p_filial;
  if not found then
    return '-infinity';
  end if;
  dias := case when txt ~ '^\d+$' then txt::integer else 1 end;
  if dias <= 0 then
    return coalesce(base, '-infinity');
  end if;
  base_dia := coalesce((base at time zone 'America/Sao_Paulo')::date, date '2000-01-03');
  ciclo := base_dia + ((hoje - base_dia) / dias) * dias;
  if base is not null and ciclo = base_dia then
    return base; -- ainda no ciclo aberto pelo reinício manual
  end if;
  return ciclo::timestamp at time zone 'America/Sao_Paulo';
end $$;

comment on function inicio_ciclo_controle is
  'Início do ciclo atual do número de controle da filial (ver 0063): meia-noite do dia em que o ciclo de N dias começou, ou o momento do reinício manual.';

-- Mesma assinatura e mesma regra de 0020, só que "a última" é a do ciclo.
create or replace function proximo_controle(p_filial uuid, p_max integer default 9999)
returns integer
language sql
stable
set search_path = public
as $$
  with ultimo as (
    select coalesce((
      select controle from movimentos
       where filial_id = p_filial and controle is not null
         and created_at >= inicio_ciclo_controle(p_filial)
       order by created_at desc
       limit 1), 0) as n
  ),
  ocupados as (
    select controle from movimentos
     where filial_id = p_filial
       and controle is not null
       and dt_saida is null
       and excluido_em is null
  )
  select cand
    from (
      select i, (((select n from ultimo) + i - 1) % p_max) + 1 as cand
        from generate_series(1, p_max) as i
    ) t
   where cand not in (select controle from ocupados)
   order by i
   limit 1;
$$;

-- Botão "Reiniciar numeração" (Configurações): supervisor/fornecedor, na
-- filial que está operando.
create or replace function reiniciar_controle()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  quando timestamptz := now();
begin
  if not usuario_eh_supervisor() then
    raise exception 'Só supervisor pode reiniciar a numeração.';
  end if;
  update filiais set controle_reiniciado_em = quando where id = filial_do_usuario();
  return quando;
end $$;

revoke execute on function reiniciar_controle() from public, anon;
grant execute on function reiniciar_controle() to authenticated;
