-- =============================================================================
-- 0060_vagas_turno.sql — turno em que a vaga existe (pra reserva por turno)
--
-- 'integral' (padrão, o que toda vaga já é hoje) conta nos três turnos;
-- 'manha'/'tarde'/'noite' só no próprio. A capacidade de um tipo num turno
-- passa a ser: vagas integrais + vagas daquele turno (ver
-- src/lib/reservas.js, calcularCapacidade).
--
-- Caso de uso: estacionamento pequeno que reserva por turno e tem uma
-- quantidade de vagas por turno (ex.: M001..M020 manhã, T001..T020 tarde,
-- N001..N020 noite). Quem não usa (aeroporto: tudo integral) não muda nada.
-- =============================================================================

alter table vagas add column turno text not null default 'integral'
  check (turno in ('integral', 'manha', 'tarde', 'noite'));
comment on column vagas.turno is
  'Turno em que a vaga existe: integral (os três, padrão) ou manha/tarde/noite. Capacidade de reserva por turno = integrais + as do turno (ver src/lib/reservas.js).';
