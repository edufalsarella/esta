import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasSemVaga, calcularCapacidade, restanteDoDia, temVagaPorTurno, prefixoTabela, mapaTabelaPorTipo, valorPropostoReserva } from './reservas.js';
import type { TabelaPreco } from '../../packages/tarifacao/tarifacao.ts';

const livre = (n) => ({ M: n, T: n, N: n });

test('diasSemVaga: intervalo de 15 dias com 1 dia sem vaga coberta no meio', () => {
  const mapa: Record<string, Record<string, { M: number; T: number; N: number }>> = {};
  for (let d = 1; d <= 15; d++) {
    const iso = `2026-09-${String(d).padStart(2, '0')}`;
    mapa[iso] = { coberta: livre(d === 8 ? 0 : 3), descoberta: livre(10) };
  }
  const dias = diasSemVaga(mapa, 'coberta', '2026-09-01', '2026-09-15');
  assert.deepEqual(dias, [{ dia: '2026-09-08', turnos: ['M', 'T', 'N'] }]);
});

test('diasSemVaga: tudo livre -> lista vazia', () => {
  const mapa = { '2026-09-01': { coberta: livre(2) }, '2026-09-02': { coberta: livre(1) } };
  assert.deepEqual(diasSemVaga(mapa, 'coberta', '2026-09-01', '2026-09-02'), []);
});

test('diasSemVaga: dia fora do mapa (sem dado nenhum) conta como sem vaga', () => {
  const mapa = { '2026-09-01': { coberta: livre(2) } };
  assert.deepEqual(diasSemVaga(mapa, 'coberta', '2026-09-01', '2026-09-02', 'tarde'), [{ dia: '2026-09-02', turnos: ['T'] }]);
});

test('diasSemVaga: só olha os turnos da reserva pedida', () => {
  const mapa = { '2026-10-06': { coberta: { M: 0, T: 2, N: 1 } } };
  assert.deepEqual(diasSemVaga(mapa, 'coberta', '2026-10-06', '2026-10-06', 'tarde'), []);
  assert.deepEqual(diasSemVaga(mapa, 'coberta', '2026-10-06', '2026-10-06', 'manha'), [{ dia: '2026-10-06', turnos: ['M'] }]);
  assert.deepEqual(diasSemVaga(mapa, 'coberta', '2026-10-06', '2026-10-06'), [{ dia: '2026-10-06', turnos: ['M'] }]);
});

test('calcularCapacidade: reserva por turno só tira daquele turno; integral tira dos três', () => {
  const vagas = [{ codigo: 'A1', tipo: 'Única' }, { codigo: 'A2', tipo: 'Única' }];
  const reservas = [
    { tipo: 'Única', periodo: 'manha', data_inicio: '2026-10-06', data_fim: '2026-10-06' },
    { tipo: 'Única', periodo: 'dia_todo', data_inicio: '2026-10-05', data_fim: '2026-10-06' },
  ];
  const mapa = calcularCapacidade({ vagas, reservas, mensalistas: [] }, '2026-10-05', '2026-10-06');
  assert.deepEqual(mapa['2026-10-05']['Única'], { M: 1, T: 1, N: 1 });
  assert.deepEqual(mapa['2026-10-06']['Única'], { M: 0, T: 1, N: 1 });
  assert.equal(restanteDoDia(mapa, '2026-10-06', 'Única'), 0);
});

test('calcularCapacidade: mensalista pelo turno contratado, no tipo do box (ou no único tipo)', () => {
  const vagas = [{ codigo: 'C01', tipo: 'Coberta' }, { codigo: 'C02', tipo: 'Coberta' }, { codigo: 'D01', tipo: 'Descoberta' }];
  const mensalistas = [
    // Só tarde, segunda a sexta (domingo→sábado), box na coberta
    { ativo: true, box: 'c01', qte_vagas: 1, restr_manha: 'NNNNNNN', restr_tarde: 'NSSSSSN', restr_noite: 'NNNNNNN' },
    // Sem box com dois tipos: não dá pra saber a vaga — fica de fora
    { ativo: true, qte_vagas: 1 },
  ];
  const mapa = calcularCapacidade({ vagas, reservas: [], mensalistas }, '2026-10-04', '2026-10-05');
  assert.deepEqual(mapa['2026-10-04'].Coberta, { M: 2, T: 2, N: 2 }); // domingo
  assert.deepEqual(mapa['2026-10-05'].Coberta, { M: 2, T: 1, N: 2 }); // segunda
  assert.deepEqual(mapa['2026-10-05'].Descoberta, { M: 1, T: 1, N: 1 });

  const umTipo = calcularCapacidade({ vagas: [{ codigo: 'X1', tipo: 'Única' }], reservas: [], mensalistas: [{ ativo: true, qte_vagas: 1 }] },
    '2026-10-05', '2026-10-05');
  assert.deepEqual(umTipo['2026-10-05']['Única'], { M: 0, T: 0, N: 0 });
});

test('prefixoTabela: letras iniciais do código, maiúsculas', () => {
  assert.equal(prefixoTabela('C001'), 'C');
  assert.equal(prefixoTabela('g045'), 'G');
  assert.equal(prefixoTabela('BOX01'), 'BOX');
  assert.equal(prefixoTabela('12A'), ''); // começa com dígito -> sem prefixo
  assert.equal(prefixoTabela(''), '');
  assert.equal(prefixoTabela(null), '');
});

test('mapaTabelaPorTipo: prefixo predominante por tipo, ignora tipo sem prefixo reconhecível', () => {
  const vagas = [
    { tipo: 'Coberta', codigo: 'C001' }, { tipo: 'Coberta', codigo: 'C002' },
    { tipo: 'Coberta', codigo: 'G099' }, // prefixo minoritário nesse tipo -> não vence
    { tipo: 'Descoberta', codigo: 'D001' },
    { tipo: 'SemPrefixo', codigo: '001' },
  ];
  assert.deepEqual(mapaTabelaPorTipo(vagas), { Coberta: 'C', Descoberta: 'D' });
});

test('valorPropostoReserva: sem tabela pro código -> null', () => {
  assert.equal(valorPropostoReserva({}, 'C', '2026-09-01', '2026-09-01'), null);
});

test('valorPropostoReserva: 1 diária (mesmo dia início/fim)', () => {
  const tabelas: Record<string, TabelaPreco> = {
    C: { tipo: 'C', faixas: [{ ate: 9999, hor: 50, con: 0, tipoCobranca: 'hora', periodo: 24 }] },
  };
  const r = valorPropostoReserva(tabelas, 'C', '2026-09-01', '2026-09-01');
  assert.deepEqual(r, { valor: 50, pedeValor: false, manual: false });
});

test('valorPropostoReserva: 3 diárias corridas', () => {
  const tabelas: Record<string, TabelaPreco> = {
    C: { tipo: 'C', faixas: [{ ate: 9999, hor: 50, con: 0, tipoCobranca: 'hora', periodo: 24 }] },
  };
  const r = valorPropostoReserva(tabelas, 'C', '2026-09-01', '2026-09-03');
  assert.equal(r?.valor, 150);
});

test('calcularCapacidade: vagas por turno (M/T/N) + integrais somam no turno; temVagaPorTurno', () => {
  const vagas = [
    ...Array.from({ length: 3 }, (_, i) => ({ codigo: `M00${i + 1}`, tipo: 'Normal', turno: 'manha' })),
    ...Array.from({ length: 2 }, (_, i) => ({ codigo: `T00${i + 1}`, tipo: 'Normal', turno: 'tarde' })),
    { codigo: 'N001', tipo: 'Normal', turno: 'noite' },
    { codigo: 'X001', tipo: 'Normal', turno: 'integral' },
  ];
  const reservas = [{ tipo: 'Normal', periodo: 'tarde', data_inicio: '2026-10-06', data_fim: '2026-10-06' }];
  const mapa = calcularCapacidade({ vagas, reservas, mensalistas: [] }, '2026-10-06', '2026-10-06');
  assert.deepEqual(mapa['2026-10-06'].Normal, { M: 4, T: 2, N: 2 });
  assert.equal(temVagaPorTurno(vagas), true);
  // Sem a coluna turno (antes da migration 0060) ou tudo integral: igual a antes.
  assert.equal(temVagaPorTurno([{ codigo: 'C1', tipo: 'Coberta' }, { codigo: 'C2', tipo: 'Coberta', turno: 'integral' }]), false);
  const semColuna = calcularCapacidade({ vagas: [{ codigo: 'C1', tipo: 'Coberta' }], reservas: [], mensalistas: [] }, '2026-10-06', '2026-10-06');
  assert.deepEqual(semColuna['2026-10-06'].Coberta, { M: 1, T: 1, N: 1 });
});
