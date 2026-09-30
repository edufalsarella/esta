import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarTomadorCadastrado, resumoEndereco } from './tomador.js';

/** Supabase de mentira: from(tabela) devolve as linhas dadas, ignorando filtros. */
function supabaseFalso(tabelas) {
  return {
    from(tabela) {
      const q = {
        select: () => q, in: () => q, order: () => q, limit: () => q,
        then: (ok) => ok({ data: tabelas[tabela] || [], error: null }),
      };
      return q;
    },
  };
}

const END_NOTA = { endereco: 'Rua da Nota', numero: '10', bairro: 'Centro', cidade: 'Campinas', uf: 'SP', cep: '13015-904', cod_ibge: '3509502' };
const END_MENS = { endereco: 'Rua do Mensalista', numero: '20', bairro: 'Cambuí', cidade: 'Campinas', uf: 'SP', cep: '13025-000', cod_ibge: '3509502' };

test('buscarTomadorCadastrado: CPF inválido ou vazio não consulta nada', async () => {
  assert.equal(await buscarTomadorCadastrado(supabaseFalso({}), ''), null);
  assert.equal(await buscarTomadorCadastrado(supabaseFalso({}), '123'), null);
});

test('buscarTomadorCadastrado: nota fiscal anterior tem prioridade sobre o mensalista', async () => {
  const sb = supabaseFalso({
    notas_fiscais: [{ tomador: { cpf_cnpj: '12345678909', nome: 'Fulano da Nota', ...END_NOTA } }],
    mensalistas: [{ razao: 'Fulano Mensalista', ...END_MENS }],
  });
  const t = await buscarTomadorCadastrado(sb, '123.456.789-09');
  assert.equal(t.nome, 'Fulano da Nota');
  assert.equal(t.endereco, 'Rua da Nota');
  assert.equal(t.origem, 'nota fiscal anterior');
});

test('buscarTomadorCadastrado: endereço vem inteiro da fonte completa, nome da primeira que tiver', async () => {
  const sb = supabaseFalso({
    notas_fiscais: [{ tomador: { cpf_cnpj: '12345678909', nome: 'Fulano da Nota', cep: '13000-000' } }],
    mensalistas: [{ razao: 'Fulano Mensalista', ...END_MENS }],
  });
  const t = await buscarTomadorCadastrado(sb, '12345678909');
  assert.equal(t.nome, 'Fulano da Nota');
  assert.equal(t.cep, END_MENS.cep, 'CEP não pode vir da nota incompleta junto com a rua do mensalista');
  assert.equal(t.endereco, 'Rua do Mensalista');
  assert.equal(t.origem, 'cadastro de mensalista');
});

test('buscarTomadorCadastrado: CNPJ acha no cadastro de convênio', async () => {
  const sb = supabaseFalso({ convenios: [{ razao: 'Empresa Conveniada', ...END_MENS }] });
  const t = await buscarTomadorCadastrado(sb, '11.222.333/0001-81');
  assert.equal(t.nome, 'Empresa Conveniada');
  assert.equal(t.origem, 'cadastro de convênio');
});

test('buscarTomadorCadastrado: CPF sem cadastro nenhum devolve null', async () => {
  assert.equal(await buscarTomadorCadastrado(supabaseFalso({}), '12345678909'), null);
});

test('resumoEndereco: uma linha, sem pedaços vazios', () => {
  assert.equal(resumoEndereco(END_NOTA), 'Rua da Nota, 10 — Centro — Campinas/SP');
  assert.equal(resumoEndereco({ endereco: 'Rua X' }), 'Rua X');
});
