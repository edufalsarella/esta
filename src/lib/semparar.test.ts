import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erroSemParar, detalheSemParar, codigoRetorno } from '../servidor/semparar.js';

test('erroSemParar: código conhecido vira frase + detalhe da Sem Parar', () => {
  const m = erroSemParar(200, { dados: { codigoRetorno: '12', mensagemRetorno: 'Hash invalido' } });
  assert.match(m, /^Hash do estabelecimento inválido/);
  assert.match(m, /\[Sem Parar: HTTP 200 — código 12 — Hash invalido\]/);
});

test('erroSemParar: resposta fora do formato (ex.: chave recusada) não vira "código NaN"', () => {
  const m = erroSemParar(403, { message: 'Forbidden' });
  assert.match(m, /^Resposta inesperada do Sem Parar/);
  assert.match(m, /HTTP 403 — Forbidden/);
  assert.doesNotMatch(m, /NaN/);
});

test('detalheSemParar: sem texto conhecido mostra o corpo (cortado) ou "resposta vazia"', () => {
  assert.equal(detalheSemParar(500, {}), 'HTTP 500 — resposta vazia');
  assert.equal(detalheSemParar(502, { foo: 1 }), 'HTTP 502 — {"foo":1}');
});

test('codigoRetorno: ausente ou inválido é null', () => {
  assert.equal(codigoRetorno({ dados: { codigoRetorno: 0 } }), 0);
  assert.equal(codigoRetorno({ dados: {} }), null);
  assert.equal(codigoRetorno({}), null);
});
