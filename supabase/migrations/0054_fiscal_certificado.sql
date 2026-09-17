-- =============================================================================
-- 0054_fiscal_certificado.sql — certificado digital (.pfx) por filial
--
-- Até aqui só existia UM certificado pro app inteiro (variável de ambiente da
-- Vercel, NFSE_CERTIFICADO_PFX_B64/_SENHA) — funcionava porque só uma filial
-- emitia nota. Com clientes novos (cada um com CNPJ e certificado próprios,
-- ex.: Ginpark e AR7) isso não escala: precisa de um certificado por filial.
--
-- Guarda deliberadamente FORA do padrão de RLS usado no resto do banco (que é
-- sempre "filial_id = filial_do_usuario()", deixando o próprio dono ler pela
-- sessão normal do navegador). Aqui não existe NENHUMA policy pra
-- `authenticated` — nem o fornecedor da própria filial lê direto. Só
-- `service_role` (que bypassa RLS) alcança, e só dentro de
-- api/certificado-fiscal.js, api/gerar-nfse.js e api/consultar-nfse.js —
-- todas Vercel Functions que primeiro confirmam a filial de quem chamou pelo
-- client normal (com RLS), e só then usam o client de serviço pra buscar o
-- certificado DAQUELA filial. Motivo: senha e .pfx aqui dentro assinam nota
-- fiscal em nome jurídico do cliente — não pode ter nenhum caminho de leitura
-- pela sessão comum do navegador, nem a do próprio dono.
-- =============================================================================

create table fiscal_certificados (
  filial_id uuid primary key references filiais (id) on delete cascade,
  pfx_b64 text not null,
  senha text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references perfis (id)
);
comment on table fiscal_certificados is
  'Certificado digital (.pfx, base64) + senha usados pra assinar/enviar NFS-e
  — um por filial, porque cada cliente tem CNPJ e certificado próprios. Ver
  api/certificado-fiscal.js pra salvar/consultar (fornecedor da filial) e
  api/gerar-nfse.js / api/consultar-nfse.js pra usar no envio. RLS fechada de
  propósito: nenhuma policy pra authenticated, só service_role.';

alter table fiscal_certificados enable row level security;
-- Sem "create policy" nenhum aqui — é intencional (ver comentário acima).
