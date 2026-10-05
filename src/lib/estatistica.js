// Cálculos do relatório Estatística (src/telas/Estatistica.jsx): quantos
// veículos por faixa de horário (entrada/saída, somando todos os dias do
// período num dia de 24 h) e por faixa de permanência (0 até a maior).
// Puro — sem banco nem tela —, pra testar.
import { diferencaEmDias } from './tempo.js';

/** Hora comercial HH.MM (14.30 = 14h30) -> minutos desde 00:00. */
export function minutosDoDia(hhmm) {
  const h = Math.trunc(Number(hhmm));
  const m = Math.round((Number(hhmm) - h) * 100);
  return h * 60 + m;
}

/** Minutos entre entrada e saída (datas ISO + horas comerciais). */
export function minutosDePermanencia(dtEntrada, hrEntrada, dtSaida, hrSaida) {
  return diferencaEmDias(dtEntrada, dtSaida) * 1440 + minutosDoDia(hrSaida) - minutosDoDia(hrEntrada);
}

/** "08:15" a partir de minutos do dia. */
export function fmtMinutosDoDia(min) {
  const h = Math.floor(min / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** "45 min", "2h", "2h15", "3d 4h" a partir de minutos de duração. */
export function fmtDuracao(min) {
  if (min < 60) return `${min} min`;
  const dias = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const horas = m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  if (dias) return h || m ? `${dias}d ${horas}` : `${dias}d`;
  return horas;
}

/**
 * Faixas do dia (0–24 h) de `intervalo` minutos com a quantidade de horários
 * em cada uma. `horarios`: horas comerciais (HH.MM).
 */
export function distribuirNoDia(horarios, intervalo) {
  const faixas = Array.from({ length: Math.ceil(1440 / intervalo) }, (_, i) => ({
    inicio: i * intervalo,
    rotulo: `${fmtMinutosDoDia(i * intervalo)}–${fmtMinutosDoDia((i + 1) * intervalo)}`, // a última termina em 00:00
    quantidade: 0,
  }));
  for (const hhmm of horarios) {
    const min = minutosDoDia(hhmm);
    if (min < 0 || min >= 1440 || Number.isNaN(min)) continue;
    faixas[Math.floor(min / intervalo)].quantidade++;
  }
  return faixas;
}

/**
 * Faixas de permanência de `intervalo` minutos, de 0 até a maior permanência
 * da lista. `duracoes`: minutos (negativos — dado inconsistente — são ignorados).
 */
export function distribuirPermanencias(duracoes, intervalo) {
  const validas = duracoes.filter((d) => Number.isFinite(d) && d >= 0);
  if (!validas.length) return [];
  const maior = Math.max(...validas);
  const faixas = Array.from({ length: Math.floor(maior / intervalo) + 1 }, (_, i) => ({
    inicio: i * intervalo,
    rotulo: `${fmtDuracao(i * intervalo)} a ${fmtDuracao((i + 1) * intervalo)}`,
    quantidade: 0,
  }));
  for (const d of validas) faixas[Math.floor(d / intervalo)].quantidade++;
  return faixas;
}

/** Total, faixa de pico e (pra permanência) média e mediana em minutos. */
export function resumo(faixas, duracoes = null) {
  const total = faixas.reduce((s, f) => s + f.quantidade, 0);
  const pico = faixas.reduce((p, f) => (f.quantidade > (p?.quantidade ?? 0) ? f : p), null);
  const r = { total, pico };
  if (duracoes) {
    const validas = duracoes.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
    if (validas.length) {
      r.media = Math.round(validas.reduce((s, d) => s + d, 0) / validas.length);
      const meio = Math.floor(validas.length / 2);
      r.mediana = validas.length % 2 ? validas[meio] : Math.round((validas[meio - 1] + validas[meio]) / 2);
      r.maior = validas.at(-1);
    }
  }
  return r;
}
