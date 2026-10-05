import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensalistasEmAtraso } from './mensalistasAtraso.js';

const M = (id, razao, proximo_pagamento, extra = {}) => ({ id, codigo: `COD${id}`, razao, proximo_pagamento, ativo: true, ...extra });

test('mensalistasEmAtraso: inclui o que vence no dia (0 dia) e ordena do menor atraso pro maior', () => {
  const lista = mensalistasEmAtraso([
    M(1, 'Carlos', '2026-09-05'),
    M(2, 'Ana', '2026-10-05'),
    M(3, 'Bruno', '2026-10-06'), // ainda vai vencer
    M(4, 'Beatriz', '2026-10-01'),
  ], {}, '2026-10-05');
  assert.deepEqual(lista.map((l) => [l.razao, l.dias]), [['Ana', 0], ['Beatriz', 4], ['Carlos', 30]]);
});

test('mensalistasEmAtraso: ignora inativo e sem próximo pagamento; empate vai por nome', () => {
  const lista = mensalistasEmAtraso([
    M(1, 'Zé', '2026-10-01'),
    M(2, 'Ana', '2026-10-01'),
    M(3, 'Inativo', '2026-01-01', { ativo: false }),
    M(4, 'Sem data', null),
  ], {}, '2026-10-05');
  assert.deepEqual(lista.map((l) => l.razao), ['Ana', 'Zé']);
});

test('mensalistasEmAtraso: placas dos veículos; sem veículo usa o código', () => {
  const lista = mensalistasEmAtraso([M(1, 'Ana', '2026-10-01'), M(2, 'Bia', '2026-09-30')],
    { 1: ['XYZ9A99', 'ABC1D23'] }, '2026-10-05');
  assert.deepEqual(lista[0].placas, ['ABC1D23', 'XYZ9A99']);
  assert.deepEqual(lista[1].placas, ['COD2']);
  assert.equal(lista[0].vencimento, '2026-10-01');
});
