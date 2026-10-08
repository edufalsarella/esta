-- =============================================================================
-- 0062_fornecedor_segunda_senha.sql — segunda senha (fixa) pro fornecedor
-- entrar no app, depois do login normal (ver src/telas/SegundaSenhaGate.jsx).
--
-- A senha NÃO fica no código do app (o JavaScript do navegador é legível
-- por qualquer um) nem neste arquivo (vai pro GitHub): fica só o hash bcrypt
-- na tabela `segredos`, que nenhum usuário lê (RLS ligada e sem policy). A
-- conferência é feita aqui dentro, pela function — o app só recebe sim/não.
--
-- Gravar/trocar a senha (no SQL Editor, fora do git):
--   insert into segredos (chave, hash)
--   values ('fornecedor_segunda_senha', extensions.crypt('NOVA SENHA', extensions.gen_salt('bf')))
--   on conflict (chave) do update set hash = excluded.hash, atualizado_em = now();
--
-- Atenção: é uma trava de tela (UI). Os dados continuam protegidos pela RLS
-- normal do fornecedor — quem tiver o e-mail/senha dele e chamar a API do
-- Supabase direto não passa por aqui.
-- =============================================================================

create table segredos (
  chave          text primary key,
  hash           text not null,
  atualizado_em  timestamptz not null default now()
);
comment on table segredos is
  'Hashes de senhas fixas do sistema (ex.: segunda senha do fornecedor). Ninguém lê pela API — só functions security definer.';
alter table segredos enable row level security;
revoke all on segredos from anon, authenticated;

create or replace function conferir_segunda_senha_fornecedor(senha text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text;
begin
  -- Só quem é fornecedor pode tentar (evita outros usuários testarem senhas).
  if not usuario_eh_fornecedor() then
    return false;
  end if;
  select hash into h from segredos where chave = 'fornecedor_segunda_senha';
  if h is null or senha is null then
    return false;
  end if;
  return h = extensions.crypt(senha, h);
end $$;

comment on function conferir_segunda_senha_fornecedor is
  'Segunda senha do fornecedor (ver 0062). Devolve só true/false; o hash nunca sai do banco.';

revoke execute on function conferir_segunda_senha_fornecedor(text) from public, anon;
grant execute on function conferir_segunda_senha_fornecedor(text) to authenticated;
