import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocupacaoPorTurno } from './ocupacaoTurno.js';

const R = (periodo, data_inicio, data_fim, status = 'confirmada') => ({ periodo, data_inicio, data_fim, status });
const totais = (l) => [l.M.total, l.T.total, l.N.total];

test('ocupacaoPorTurno: reserva integral ocupa os 3 turnos; por turno só o próprio', () => {
  const dias = ocupacaoPorTurno([
    R('dia_todo', '2026-10-05', '2026-10-06'),
    R('manha', '2026-10-06', '2026-10-06'),
    R('noite', '2026-10-06', '2026-10-06'),
  ], [], '2026-10-05', '2026-10-06');
  assert.deepEqual(dias.map((d) => d.dia), ['2026-10-05', '2026-10-06']);
  assert.deepEqual(totais(dias[0]), [1, 1, 1]);
  assert.deepEqual(totais(dias[1]), [2, 1, 2]);
  assert.equal(dias[0].diaSemana, 2); // 05/10/2026 é segunda (1 = domingo)
});

test('ocupacaoPorTurno: cancelada e não veio não ocupam; concluída ocupa; reserva fora do período é cortada', () => {
  const dias = ocupacaoPorTurno([
    R('dia_todo', '2026-10-05', '2026-10-05', 'cancelada'),
    R('dia_todo', '2026-10-05', '2026-10-05', 'no_show'),
    R('tarde', '2026-10-05', '2026-10-05', 'concluida'),
    R('manha', '2026-09-01', '2026-12-31'),
  ], [], '2026-10-05', '2026-10-05');
  assert.deepEqual(totais(dias[0]), [1, 1, 0]);
});

test('ocupacaoPorTurno: mensalista pelo dia/turno contratado, com qte_vagas; sem restrição ocupa tudo', () => {
  // Domingo→sábado. Só manhã de segunda a sexta.
  const soManhaUteis = { ativo: true, qte_vagas: 2, restr_manha: 'NSSSSSN', restr_tarde: 'NNNNNNN', restr_noite: 'NNNNNNN' };
  const semRestricao = { ativo: true, qte_vagas: 1 };
  const inativo = { ativo: false, qte_vagas: 5 };
  const dias = ocupacaoPorTurno([R('tarde', '2026-10-05', '2026-10-05')], [soManhaUteis, semRestricao, inativo], '2026-10-04', '2026-10-05');
  // 04/10 domingo: só o sem restrição
  assert.deepEqual(totais(dias[0]), [1, 1, 1]);
  // 05/10 segunda: manhã 2+1, tarde 1 + reserva, noite 1
  assert.deepEqual(totais(dias[1]), [3, 2, 1]);
  assert.deepEqual([dias[1].T.reservas, dias[1].T.mensalistas], [1, 1]);
});
