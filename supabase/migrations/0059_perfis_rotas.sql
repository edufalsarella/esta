-- =============================================================================
-- 0059_perfis_rotas.sql — telas liberadas por usuário
--
-- Até aqui o acesso às telas vinha só do papel (operador/gerente/supervisor,
-- ver src/lib/acesso.js). Agora cada usuário pode ter a própria lista de
-- telas do menu (Usuários → editar → "Telas que pode acessar"). NULL = segue
-- o padrão do papel. O papel continua valendo pras permissões finas dentro
-- das telas.
--
-- Trava: a policy de perfis deixa o usuário editar a PRÓPRIA linha (o
-- fornecedor precisa, pra trocar de filial). Sem estender a trava de 0018,
-- um operador poderia se liberar todas as telas — só supervisor muda `rotas`.
-- =============================================================================

alter table perfis add column if not exists rotas text[];
comment on column perfis.rotas is
  'Telas (rotas do menu, ex.: {"/","/caixa"}) que o usuário pode acessar. NULL = padrão do papel. Só supervisor altera (ver perfis_guarda_papel).';

create or replace function perfis_guarda_papel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role (scripts admin e api/criar-usuario.js) não tem auth.uid();
  -- ele já ignora RLS por natureza, então travar aqui seria só teatro.
  if auth.uid() is null then
    return new;
  end if;

  if new.papel = 'fornecedor' and not usuario_eh_fornecedor() then
    raise exception 'Só o fornecedor pode criar outro fornecedor.';
  end if;

  if tg_op = 'INSERT' then
    if new.rotas is not null and not usuario_eh_supervisor() then
      raise exception 'Só supervisor pode definir as telas de um usuário.';
    end if;
  end if;

  -- Tudo que compara com OLD fica aqui dentro: no INSERT o OLD não existe, e
  -- tocar nele fora deste ramo derruba a inserção (o AND do SQL não garante
  -- avaliação da esquerda pra direita).
  if tg_op = 'UPDATE' then
    if new.papel is distinct from old.papel and not usuario_eh_supervisor() then
      raise exception 'Só supervisor pode mudar o papel de um usuário.';
    end if;

    if new.rotas is distinct from old.rotas and not usuario_eh_supervisor() then
      raise exception 'Só supervisor pode mudar as telas de um usuário.';
    end if;

    if old.papel = 'fornecedor' and not usuario_eh_fornecedor() then
      raise exception 'Só o fornecedor pode alterar o perfil de um fornecedor.';
    end if;

    if new.filial_ativa is distinct from old.filial_ativa and not usuario_eh_fornecedor() then
      raise exception 'Só o fornecedor pode trocar a filial ativa.';
    end if;

    if new.filial_id is distinct from old.filial_id and not usuario_eh_fornecedor() then
      raise exception 'Só o fornecedor pode mover um usuário de filial.';
    end if;
  end if;

  return new;
end;
$$;
