// Relatório "Ocupação por turno": para cada dia do período, quantas vagas
// estão comprometidas na manhã, tarde e noite — reservas (ver
// 0035_reservas.sql, campo `periodo`) + mensalistas pelo dia/turno
// contratado (RESTRM/T/N, ver restricaoMensalista.js).
//
// Reserva "dia_todo" (integral) ocupa os três turnos; manhã/tarde/noite só o
// próprio. Conta reserva confirmada e concluída (o carro veio — a vaga foi
// usada); cancelada e "não veio" ficam de fora.
//
// Mensalista ativo ocupa `qte_vagas` em cada turno contratado naquele dia da
// semana. Sem restrição configurada (campos vazios) = contratado todo dia e
// todo turno — mesma regra do pátio (turnoContratado).

import { somarDias, dataDeISO } from './tempo.js';
import { diaSemanaLegado, turnoContratado } from './restricaoMensalista.js';

export const TURNOS = ['M', 'T', 'N'];
export const ROTULO_TURNO = { M: 'Manhã', T: 'Tarde', N: 'Noite' };
const TURNOS_DA_RESERVA = { dia_todo: TURNOS, manha: ['M'], tarde: ['T'], noite: ['N'] };
const STATUS_QUE_OCUPA = ['confirmada', 'concluida'];

/** Turnos (M/T/N) que uma reserva ocupa pelo `periodo` — integral (ou desconhecido) = os três. */
export const turnosDaReserva = (periodo) => TURNOS_DA_RESERVA[periodo] || TURNOS;

/** Vagas que o mensalista ocupa no turno nesse dia da semana (0 se não contratado). */
export function vagasDoMensalista(m, turno, diaSemana) {
  return turnoContratado(turno, diaSemana, m.restr_manha, m.restr_tarde, m.restr_noite) ? Number(m.qte_vagas || 1) : 0;
}

/**
 * @param reservas  linhas de `reservas` (periodo, data_inicio, data_fim, status)
 * @param mensalistas  linhas de `mensalistas` (ativo, qte_vagas, restr_manha/tarde/noite)
 * @returns [{ dia: 'YYYY-MM-DD', diaSemana: 1..7 (1=domingo),
 *             M: { reservas, mensalistas, total }, T: {…}, N: {…} }]
 */
export function ocupacaoPorTurno(reservas, mensalistas, de, ate) {
  const ativos = (mensalistas || []).filter((m) => m.ativo !== false);
  const dias = [];
  for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) {
    const diaSemana = diaSemanaLegado(dataDeISO(dia));
    const linha = { dia, diaSemana };
    for (const t of TURNOS) {
      const mens = ativos.reduce((soma, m) => soma + vagasDoMensalista(m, t, diaSemana), 0);
      linha[t] = { reservas: 0, mensalistas: mens, total: mens };
    }
    dias.push(linha);
  }
  const porDia = Object.fromEntries(dias.map((l) => [l.dia, l]));
  for (const r of reservas || []) {
    if (!STATUS_QUE_OCUPA.includes(r.status)) continue;
    const turnos = turnosDaReserva(r.periodo);
    for (let dia = r.data_inicio > de ? r.data_inicio : de; dia <= r.data_fim && dia <= ate; dia = somarDias(dia, 1)) {
      for (const t of turnos) {
        porDia[dia][t].reservas += 1;
        porDia[dia][t].total += 1;
      }
    }
  }
  return dias;
}
