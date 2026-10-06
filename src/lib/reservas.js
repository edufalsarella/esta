// Capacidade de vagas por tipo (ex.: coberta/descoberta), dia e turno, a
// partir de `vagas` (total cadastrado, ver Cadastros → Vagas/boxes),
// `reservas` confirmadas (ver supabase/migrations/0035_reservas.sql) e
// mensalistas pelo turno contratado. Avulsos não entram nessa conta.
//
// `supabase` vem por parâmetro (não importado direto) pro arquivo poder ser
// testado com `node --test` puro (sem Vite, sem import.meta.env) — mesmo
// padrão de src/lib/fiscal.js/notaFiscal.js.
import { somarDias, dataDeISO } from './tempo.js';
import { diaSemanaLegado } from './restricaoMensalista.js';
import { TURNOS, turnosDaReserva, turnosDaVaga, vagasDoMensalista } from './ocupacaoTurno.js';
import { calcularProporcional } from '../../packages/tarifacao/tarifacao.ts';

/**
 * Todo tipo distinto cadastrado em `vagas` (ativas) — usado pra popular o
 * <select> do formulário de reserva sem fixar "coberta/descoberta": cada
 * filial usa o texto que quiser em vagas.tipo.
 */
export async function tiposDeVaga(supabase) {
  const { data } = await supabase.from('vagas').select('tipo').eq('ativo', true).not('tipo', 'is', null);
  return [...new Set((data || []).map((v) => v.tipo).filter(Boolean))].sort();
}

/**
 * Tipo de vaga de cada mensalista: o tipo da vaga cujo código é o `box` do
 * cadastro; sem box (ou box que não é vaga cadastrada), e havendo um tipo só
 * na filial, é esse tipo. Com vários tipos e sem box, não dá pra saber qual
 * vaga ele usa — fica de fora (null).
 */
export function tipoDoMensalista(m, tipoPorCodigo, tipos) {
  const doBox = m.box ? tipoPorCodigo[String(m.box).trim().toUpperCase()] : null;
  if (doBox) return doBox;
  return tipos.length === 1 ? tipos[0] : null;
}

/**
 * Vagas que sobram por dia, tipo e turno: `{ [dataISO]: { [tipo]: { M, T, N } } }`.
 * O total de um tipo num turno é a quantidade de vagas integrais + as daquele
 * turno (vagas.turno, ver 0060_vagas_turno.sql — sem a coluna, tudo integral).
 * Cada reserva confirmada tira uma vaga dos turnos dela (integral = os três,
 * ver turnosDaReserva) e cada mensalista ativo tira `qte_vagas` dos turnos
 * contratados naquele dia da semana (mesma regra do relatório Ocupação por
 * turno, ver ocupacaoTurno.js). Avulsos não entram — não dá pra prever.
 */
export function calcularCapacidade({ vagas, reservas, mensalistas }, dataInicio, dataFim) {
  const totalPorTipo = {};
  const tipoPorCodigo = {};
  for (const v of vagas || []) {
    if (!v.tipo) continue;
    totalPorTipo[v.tipo] ||= { M: 0, T: 0, N: 0 };
    for (const t of turnosDaVaga(v.turno)) totalPorTipo[v.tipo][t] += 1;
    if (v.codigo) tipoPorCodigo[String(v.codigo).trim().toUpperCase()] = v.tipo;
  }
  const tipos = Object.keys(totalPorTipo);
  const mensPorTipo = {};
  for (const m of mensalistas || []) {
    if (m.ativo === false) continue;
    const tipo = tipoDoMensalista(m, tipoPorCodigo, tipos);
    if (tipo) (mensPorTipo[tipo] ||= []).push(m);
  }

  const mapa = {};
  for (let dia = dataInicio; dia <= dataFim; dia = somarDias(dia, 1)) {
    const diaSemana = diaSemanaLegado(dataDeISO(dia));
    mapa[dia] = {};
    for (const tipo of tipos) {
      mapa[dia][tipo] = {};
      for (const t of TURNOS) {
        const mens = (mensPorTipo[tipo] || []).reduce((s, m) => s + vagasDoMensalista(m, t, diaSemana), 0);
        mapa[dia][tipo][t] = totalPorTipo[tipo][t] - mens;
      }
    }
  }
  for (const r of reservas || []) {
    if (!(r.tipo in totalPorTipo)) continue; // tipo sem vaga cadastrada (não deveria acontecer, mas não quebra)
    const inicio = r.data_inicio > dataInicio ? r.data_inicio : dataInicio;
    const fim = r.data_fim < dataFim ? r.data_fim : dataFim;
    for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
      for (const t of turnosDaReserva(r.periodo)) mapa[dia][r.tipo][t] -= 1;
    }
  }
  return mapa;
}

/** A filial cadastrou alguma vaga de turno (não integral)? Aí o calendário mostra manhã/tarde/noite separados. */
export const temVagaPorTurno = (vagas) => (vagas || []).some((v) => v.turno && v.turno !== 'integral');

/**
 * Busca vagas, reservas confirmadas e mensalistas ativos e calcula a
 * capacidade (ver calcularCapacidade). `porTurno`: ver temVagaPorTurno.
 * Vagas com `*` pra funcionar antes e depois da coluna `turno` existir.
 */
export async function capacidadePorDia(supabase, dataInicio, dataFim) {
  const [v, r, m] = await Promise.all([
    supabase.from('vagas').select('*').eq('ativo', true).not('tipo', 'is', null),
    supabase.from('reservas').select('tipo, periodo, data_inicio, data_fim')
      .eq('status', 'confirmada').lte('data_inicio', dataFim).gte('data_fim', dataInicio),
    supabase.from('mensalistas').select('box, ativo, qte_vagas, restr_manha, restr_tarde, restr_noite').eq('ativo', true),
  ]);
  return {
    mapa: calcularCapacidade({ vagas: v.data, reservas: r.data, mensalistas: m.data }, dataInicio, dataFim),
    porTurno: temVagaPorTurno(v.data),
  };
}

/** Menor sobra entre os turnos do dia (o que o calendário mostra) — null sem dado. */
export function restanteDoDia(mapaCapacidade, dia, tipo) {
  const porTurno = mapaCapacidade[dia]?.[tipo];
  return porTurno ? Math.min(...TURNOS.map((t) => porTurno[t])) : null;
}

/**
 * Dias do intervalo em que falta vaga do tipo em algum turno que a reserva
 * ocuparia: `[{ dia, turnos: ['T', …] }]` (vazio = tudo livre). Dia fora do
 * mapa conta como sem vaga nos turnos da reserva.
 */
export function diasSemVaga(mapaCapacidade, tipo, dataInicio, dataFim, periodo = 'dia_todo') {
  const dias = [];
  for (let dia = dataInicio; dia <= dataFim; dia = somarDias(dia, 1)) {
    const porTurno = mapaCapacidade[dia]?.[tipo];
    const turnos = turnosDaReserva(periodo).filter((t) => porTurno?.[t] == null || porTurno[t] <= 0);
    if (turnos.length) dias.push({ dia, turnos });
  }
  return dias;
}

/**
 * Prefixo (letras iniciais) do código da vaga — ex.: "C001" -> "C". Mesmo
 * texto que o "Prefixo do código" do cadastro em lote (ver cadastros.jsx)
 * pede pra digitar; aqui ele também vira o código da tabela de preço usada
 * pra propor um valor de reserva (ver `mapaTabelaPorTipo`/`valorPropostoReserva`).
 */
export function prefixoTabela(codigo) {
  return String(codigo || '').match(/^[^\d]+/)?.[0]?.trim().toUpperCase() || '';
}

/**
 * Tabela de preço predominante de cada tipo de vaga, a partir do prefixo do
 * código (ex.: vagas "C001".."C040" tipo "Coberta" -> tabela "C"). Quando um
 * tipo tem prefixos divergentes entre as vagas (cadastro inconsistente), vence
 * o mais frequente. Tipo sem nenhum prefixo reconhecível fica de fora do mapa
 * (sem valor proposto pra ele — não quebra nada, só não estima).
 */
export function mapaTabelaPorTipo(vagas) {
  const contagem = {};
  for (const v of vagas || []) {
    const prefixo = prefixoTabela(v.codigo);
    if (!prefixo || !v.tipo) continue;
    contagem[v.tipo] ??= {};
    contagem[v.tipo][prefixo] = (contagem[v.tipo][prefixo] || 0) + 1;
  }
  const mapa = {};
  for (const [tipo, porPrefixo] of Object.entries(contagem)) {
    mapa[tipo] = Object.entries(porPrefixo).sort(([, a], [, b]) => b - a)[0][0];
  }
  return mapa;
}

/** Busca `vagas` e devolve o mapa tipo -> tabela de preço (ver `mapaTabelaPorTipo`). */
export async function tabelaPorTipoDeVaga(supabase) {
  const { data } = await supabase.from('vagas').select('tipo, codigo').eq('ativo', true);
  return mapaTabelaPorTipo(data || []);
}

/**
 * Valor proposto pra uma reserva de `dataInicio` a `dataFim` (dias corridos,
 * ambos inclusive) na tabela de preço `tabelaCodigo` — usa o MESMO motor de
 * tarifação da cobrança real (ver packages/tarifacao), simulando uma entrada
 * às 00:00 de `dataInicio` e saída às 00:00 do dia seguinte a `dataFim` (pra
 * contar o último dia inteiro). É só uma estimativa impressa no ticket —
 * quem cobra de verdade é a saída real do veículo (ver Patio.jsx), que pode
 * dar um valor diferente (hora exata de chegada, convênio, serviços...).
 * `null` quando não há tabela pro código (tipo sem prefixo reconhecível ou
 * sem tabela de preço vigente com esse código).
 */
export function valorPropostoReserva(tabelas, tabelaCodigo, dataInicio, dataFim) {
  const tbl = tabelas?.[tabelaCodigo];
  if (!tbl) return null;
  const movimento = {
    dtEntrada: dataDeISO(dataInicio), entrada: 0,
    dtSaida: dataDeISO(somarDias(dataFim, 1)), saida: 0,
  };
  const r = calcularProporcional(tbl, movimento);
  return { valor: r.valor ?? 0, pedeValor: !!r.pedeValor, manual: r.valor == null };
}
