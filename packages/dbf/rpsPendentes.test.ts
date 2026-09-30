import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarRpsPendentes } from './rpsPendentes.ts';

const CAMPOS = ['NUMERONF', 'NUMNFSE', 'VALOR', 'DATA', 'DATASAIDA', 'RPSDESCR', 'VEICULO', 'CPFCOMPL', 'NOMECOMPL', 'CIDCOMPL', 'ESTACOMPL', 'TIPORECOL', 'CEPCOMPL'];

test('detectarRpsPendentes: só NUMERONF > 0 sem NUMNFSE, em ordem de número', () => {
  const { rps, faltandoCampos } = detectarRpsPendentes(CAMPOS, [
    { NUMERONF: 0, NUMNFSE: '', VALOR: 10 },
    { NUMERONF: 7, NUMNFSE: '716', VALOR: 10 },
    { NUMERONF: 9, NUMNFSE: '  ', VALOR: 20, DATASAIDA: '2026-07-25', DATA: '2026-07-24', RPSDESCR: 'AVULSO', VEICULO: 'ABC1D23' },
    { NUMERONF: 3, NUMNFSE: '', VALOR: 13, DATASAIDA: null, DATA: '2026-07-24', CPFCOMPL: '820.617.508-34', NOMECOMPL: 'Fulano', CIDCOMPL: 'CAMPINAS', ESTACOMPL: 'sp', TIPORECOL: 'a', CEPCOMPL: '13015-904' },
  ]);
  assert.deepEqual(faltandoCampos, []);
  assert.deepEqual(rps.map((r) => r.numero_rps), [3, 9]);
  assert.equal(rps[0].competencia, '2026-07-24', 'sem DATASAIDA usa DATA');
  assert.equal(rps[1].competencia, '2026-07-25');
  assert.equal(rps[0].tomador.cpf_cnpj, '82061750834');
  assert.equal(rps[0].tomador.cep, '13015904');
  assert.equal(rps[0].tomador.uf, 'SP');
  assert.equal(rps[0].tipoRecol, 'A');
  assert.equal(rps[1].descricao, 'AVULSO');
  assert.equal(rps[0].descricao, null);
});

test('detectarRpsPendentes: arquivo sem os campos do ESTAMORT avisa o que falta', () => {
  const { rps, faltandoCampos } = detectarRpsPendentes(['CODIGO', 'RAZAO'], [{ CODIGO: '1' }]);
  assert.deepEqual(rps, []);
  assert.deepEqual(faltandoCampos, ['NUMERONF', 'NUMNFSE', 'VALOR']);
});
