import { test } from 'node:test';
import assert from 'node:assert/strict';
import { podeAcessar, rotasPadraoDoPapel, primeiraRotaPermitida } from './acesso.js';

test('podeAcessar: sem telas escolhidas, segue o papel', () => {
  assert.equal(podeAcessar({ papel: 'operador' }, '/caixa'), true);
  assert.equal(podeAcessar({ papel: 'operador' }, '/precos'), false);
  assert.equal(podeAcessar({ papel: 'supervisor' }, '/precos'), true);
});

test('podeAcessar: telas escolhidas valem no lugar do papel (pra mais e pra menos)', () => {
  const operadorComPrecos = { papel: 'operador', rotas: ['/', '/precos'] };
  assert.equal(podeAcessar(operadorComPrecos, '/precos'), true);
  assert.equal(podeAcessar(operadorComPrecos, '/caixa'), false);
  const supervisorRestrito = { papel: 'supervisor', rotas: ['/caixa'] };
  assert.equal(podeAcessar(supervisorRestrito, '/configuracoes'), false);
});

test('podeAcessar: Ajuda/Sobre sempre; Importar só fornecedor; fornecedor ignora a lista', () => {
  const restrito = { papel: 'operador', rotas: ['/caixa'] };
  assert.equal(podeAcessar(restrito, '/ajuda'), true);
  assert.equal(podeAcessar(restrito, '/sobre'), true);
  assert.equal(podeAcessar({ papel: 'supervisor', rotas: ['/importar'] }, '/importar'), false);
  assert.equal(podeAcessar({ papel: 'fornecedor', rotas: ['/caixa'] }, '/configuracoes'), true);
});

test('podeAcessar: rota fora do menu (financeiro) segue o papel mesmo com lista', () => {
  assert.equal(podeAcessar({ papel: 'gerente', rotas: ['/'] }, '/receber'), true);
  assert.equal(podeAcessar({ papel: 'operador', rotas: ['/'] }, '/receber'), false);
});

test('rotasPadraoDoPapel e primeiraRotaPermitida', () => {
  assert.deepEqual(rotasPadraoDoPapel('operador'), ['/', '/caixa', '/reservas']);
  assert.equal(primeiraRotaPermitida({ papel: 'operador', rotas: ['/fiscal'] }), '/fiscal');
  assert.equal(primeiraRotaPermitida({ papel: 'operador', rotas: [] }), '/ajuda');
});
