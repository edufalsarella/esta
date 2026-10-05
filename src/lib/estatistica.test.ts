import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  minutosDoDia, minutosDePermanencia, fmtDuracao, distribuirNoDia, distribuirPermanencias, resumo,
} from './estatistica.js';

test('minutosDoDia: hora comercial HH.MM (decimal = minutos)', () => {
  assert.equal(minutosDoDia(0), 0);
  assert.equal(minutosDoDia(14.3), 870); // 14h30
  assert.equal(minutosDoDia(8.05), 485);
  assert.equal(minutosDoDia(23.59), 1439);
});

test('minutosDePermanencia: atravessa a meia-noite e vários dias', () => {
  assert.equal(minutosDePermanencia('2026-10-01', 8.0, '2026-10-01', 10.15), 135);
  assert.equal(minutosDePermanencia('2026-10-01', 23.5, '2026-10-02', 0.2), 30);
  assert.equal(minutosDePermanencia('2026-10-01', 12.0, '2026-10-03', 12.0), 2880);
});

test('fmtDuracao', () => {
  assert.equal(fmtDuracao(45), '45 min');
  assert.equal(fmtDuracao(120), '2h');
  assert.equal(fmtDuracao(135), '2h15');
  assert.equal(fmtDuracao(1440), '1d');
  assert.equal(fmtDuracao(1440 + 15), '1d 0h15');
  assert.equal(fmtDuracao(2 * 1440 + 4 * 60), '2d 4h');
});

test('distribuirNoDia: soma os dias numa grade de 24 h', () => {
  const faixas = distribuirNoDia([8.0, 8.14, 8.15, 23.59, 0.0, 8.05], 15);
  assert.equal(faixas.length, 96);
  assert.equal(faixas[32].rotulo, '08:00–08:15');
  assert.equal(faixas[32].quantidade, 3); // 8:00, 8:14, 8:05
  assert.equal(faixas[33].quantidade, 1); // 8:15
  assert.equal(faixas[0].quantidade, 1);
  assert.equal(faixas[95].rotulo, '23:45–00:00');
  assert.equal(faixas[95].quantidade, 1);
  assert.equal(distribuirNoDia([], 60).length, 24);
  assert.equal(distribuirNoDia([], 30).length, 48);
});

test('distribuirPermanencias: de 0 até a maior permanência', () => {
  const faixas = distribuirPermanencias([10, 20, 59, 60, 150, -5], 60);
  assert.deepEqual(faixas.map((f) => f.quantidade), [3, 1, 1]); // 0–1h, 1h–2h, 2h–3h (o -5 é ignorado)
  assert.equal(faixas[0].rotulo, '0 min a 1h');
  assert.deepEqual(distribuirPermanencias([], 15), []);
});

test('resumo: total, pico e (permanência) média/mediana/maior', () => {
  const duracoes = [10, 20, 59, 60, 150];
  const faixas = distribuirPermanencias(duracoes, 60);
  const r = resumo(faixas, duracoes);
  assert.equal(r.total, 5);
  assert.equal(r.pico.inicio, 0);
  assert.equal(r.media, 60);
  assert.equal(r.mediana, 59);
  assert.equal(r.maior, 150);
});
