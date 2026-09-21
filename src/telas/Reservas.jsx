import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { hojeISO, fmtDataBR, fmtBRL } from '../lib/tempo.js';
import { tiposDeVaga, capacidadePorDia, diasSemVaga, tabelaPorTipoDeVaga, valorPropostoReserva } from '../lib/reservas.js';
import { carregarModelosTicket, carregarTabelasPreco } from '../lib/dados.js';
import { dadosFilial, dadosReserva } from '../lib/dadosTicket.js';
import { TicketModal } from '../componentes/Ticket.jsx';
import AbrirCaixaInline from '../componentes/AbrirCaixaInline.jsx';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ROTULO_PERIODO = { dia_todo: 'Dia todo', manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const ROTULO_STATUS = { confirmada: 'Confirmada', cancelada: 'Cancelada', no_show: 'Não veio', concluida: 'Concluída' };

/** Quantidade de reservas por tipo (ordem alfabética), pro rodapé da lista/relatório do dia. */
function totaisPorTipo(reservas) {
  const totais = {};
  for (const r of reservas) totais[r.tipo] = (totais[r.tipo] || 0) + 1;
  return Object.fromEntries(Object.entries(totais).sort(([a], [b]) => a.localeCompare(b, 'pt-BR')));
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Relatório impresso (janela dedicada), mesmo padrão de imprimirRelatorio em BI.jsx.
function imprimirRelatorioDia(dia, reservas, filial) {
  const cabecalho = filial && (filial.nome_fantasia || filial.endereco || filial.cnpj) ? `
    ${filial.nome_fantasia ? `<div class="nome">${escapeHtml(filial.nome_fantasia)}</div>` : ''}
    ${filial.endereco ? `<div class="linha-end">${escapeHtml(filial.endereco)}</div>` : ''}
    ${filial.cnpj ? `<div class="linha-end">CNPJ: ${escapeHtml(filial.cnpj)}</div>` : ''}
    <hr>` : '';
  const linhas = reservas.map((r) => `<tr>
      <td>${Number(r.valor_antecipado) > 0 ? '$ ' : ''}${escapeHtml(r.tipo)}</td>
      <td>${escapeHtml(ROTULO_PERIODO[r.periodo] || r.periodo)}</td>
      <td>${escapeHtml(r.placa || '—')}</td>
      <td>${escapeHtml(r.modelo || '—')}</td>
      <td>${escapeHtml(r.nome || '—')}</td>
      <td>${escapeHtml(r.telefone || '—')}</td>
      <td>${escapeHtml(ROTULO_STATUS[r.status] || r.status)}</td>
      <td>${r.chegou_em ? 'Sim' : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="8">Nenhuma reserva neste dia.</td></tr>';
  const totais = Object.entries(totaisPorTipo(reservas)).map(([t, n]) => `${escapeHtml(t)}: ${n}`).join(' · ');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Reservas ${escapeHtml(fmtDataBR(dia))}</title>
    <style>
      body { font-family: system-ui, Arial, sans-serif; color: #000; padding: 20px; max-width: 760px; }
      .nome { font-size: 18px; font-weight: 800; margin-bottom: 2px; }
      .linha-end { font-size: 12px; color: #333; margin-bottom: 2px; }
      hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
      h1 { font-size: 16px; margin: 0 0 10px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; padding: 4px 6px 4px 0; border-bottom: 1px solid #999; }
      td { padding: 4px 6px 4px 0; border-bottom: 1px solid #ddd; }
      tfoot td { border-bottom: none; padding-top: 8px; font-weight: 700; }
    </style></head><body>
      ${cabecalho}
      <h1>Reservas — ${escapeHtml(fmtDataBR(dia))}</h1>
      <table><thead><tr>
        <th>Tipo</th><th>Período</th><th>Placa</th><th>Modelo</th><th>Nome</th><th>Telefone</th><th>Status</th><th>Chegou</th>
      </tr></thead><tbody>${linhas}</tbody>
      ${reservas.length ? `<tfoot><tr><td colspan="8">Total: ${totais}</td></tr></tfoot>` : ''}
      </table>
    </body></html>`;
  const win = window.open('', '_blank', 'width=560,height=700');
  if (!win) { window.alert('Permita pop-ups para imprimir o relatório.'); return; }
  win.document.write(html);
  win.document.close();
  win.onafterprint = () => win.close();
  win.focus();
  win.print();
}

/** Verde com folga (>5), amarelo apertado (1-5), vermelho esgotado (<=0). */
function corRestante(restante) {
  if (restante == null) return undefined;
  if (restante <= 0) return 'var(--erro)';
  if (restante < 5) return 'var(--amarelo)';
  return 'var(--ok)';
}

function anoMesAtual() {
  const [ano, mes] = hojeISO().split('-');
  return `${ano}-${mes}`;
}

/** Grade de células do mês (com `null` de preenchimento antes do dia 1), começando no domingo. */
function celulasDoMes(anoMes) {
  const [ano, mes] = anoMes.split('-').map(Number);
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();
  const totalDias = new Date(ano, mes, 0).getDate();
  const celulas = Array(primeiroDiaSemana).fill(null);
  for (let d = 1; d <= totalDias; d++) celulas.push(`${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return celulas;
}

function mudarAnoMes(anoMes, delta) {
  const [ano, mes] = anoMes.split('-').map(Number);
  const d = new Date(ano, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Calendário mensal: pra cada dia, quantas vagas de cada tipo (coberta/
// descoberta, texto livre — ver Cadastros → Vagas/boxes) ainda sobram até
// esgotar. Clicar num dia mostra as reservas que o cobrem + botão pra
// reservar. Mensalistas e avulsos não entram nessa conta — só reservas
// confirmadas (ver src/lib/reservas.js).
export default function Reservas({ perfil }) {
  const [anoMes, setAnoMes] = useState(anoMesAtual());
  const [tipos, setTipos] = useState([]);
  const [capacidade, setCapacidade] = useState({});
  const [diaSelecionado, setDiaSelecionado] = useState(null);
  const [reservasDoDia, setReservasDoDia] = useState([]);
  const [modalNova, setModalNova] = useState(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [filial, setFilial] = useState(null);
  const [modelosTicket, setModelosTicket] = useState({});
  const [ticket, setTicket] = useState(null);
  const [celularTicket, setCelularTicket] = useState('');
  const [formas, setFormas] = useState([]);
  const [caixaAberto, setCaixaAberto] = useState(null);
  const [tabelaPorTipo, setTabelaPorTipo] = useState({});
  const [tabelasPreco, setTabelasPreco] = useState({});
  const [pendenteCaixa, setPendenteCaixa] = useState(null); // { executar } — ação esperando caixa aberto

  const celulas = useMemo(() => celulasDoMes(anoMes), [anoMes]);

  useEffect(() => {
    supabase.from('filiais').select('nome_fantasia, endereco, cnpj, numero, bairro, inscricao_mun, inscricao_est, razao_social, config')
      .eq('id', perfil.filial_id).maybeSingle().then(({ data }) => setFilial(data));
    carregarModelosTicket().then(setModelosTicket);
    supabase.from('formas_pagamento').select('*').eq('ativo', true).order('codigo').then(({ data }) => setFormas(data || []));
    supabase.from('caixas').select('id').eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle()
      .then(({ data }) => setCaixaAberto(data));
    // Prefixo do código das vagas -> tabela de preço, pra propor um valor de
    // reserva com o mesmo motor de cobrança real (ver src/lib/reservas.js).
    tabelaPorTipoDeVaga(supabase).then(setTabelaPorTipo);
    carregarTabelasPreco().then(setTabelasPreco).catch(() => setTabelasPreco({}));
  }, [perfil.filial_id, perfil.id]);

  const valorProposto = useMemo(() => {
    if (!modalNova?.tipo || !modalNova.data_inicio || !modalNova.data_fim) return null;
    const tabelaCodigo = tabelaPorTipo[modalNova.tipo];
    if (!tabelaCodigo) return null;
    return valorPropostoReserva(tabelasPreco, tabelaCodigo, modalNova.data_inicio, modalNova.data_fim);
  }, [modalNova?.tipo, modalNova?.data_inicio, modalNova?.data_fim, tabelaPorTipo, tabelasPreco]);

  async function carregarMes() {
    setCarregando(true); setErro('');
    const primeiro = `${anoMes}-01`;
    const ultimo = celulas.filter(Boolean).at(-1) || primeiro;
    const [ts, mapa] = await Promise.all([tiposDeVaga(supabase), capacidadePorDia(supabase, primeiro, ultimo)]);
    setTipos(ts);
    setCapacidade(mapa);
    setCarregando(false);
  }
  useEffect(() => { carregarMes(); /* eslint-disable-next-line */ }, [anoMes]);

  async function carregarReservasDoDia(dia) {
    const { data, error } = await supabase.from('reservas').select('*')
      .lte('data_inicio', dia).gte('data_fim', dia).order('status').order('tipo');
    if (error) { setErro(error.message); return; }
    setReservasDoDia(data || []);
  }

  function selecionarDia(dia) {
    if (!dia) return;
    setDiaSelecionado((d) => (d === dia ? null : dia));
    setMsg('');
    if (dia !== diaSelecionado) carregarReservasDoDia(dia);
  }

  function abrirNovaReserva() {
    setModalNova({
      tipo: tipos[0] || '', periodo: 'dia_todo',
      data_inicio: diaSelecionado || hojeISO(), data_fim: diaSelecionado || hojeISO(),
      nome: '', telefone: '', placa: '', modelo: '', observacao: '',
      valorAntecipado: '', formaAntecipado: '',
      diasSemVaga: null, confirmando: false,
    });
    setErro('');
  }

  async function tentarSalvarReserva(forcar = false) {
    const m = modalNova;
    if (m.data_inicio < hojeISO()) { setErro('Não é possível reservar pra uma data antes de hoje.'); return; }
    if (m.data_fim < m.data_inicio) { setErro('A data final não pode ser antes da data inicial.'); return; }
    if (!m.tipo) { setErro('Escolha o tipo de vaga.'); return; }

    if (!forcar) {
      const mapa = await capacidadePorDia(supabase, m.data_inicio, m.data_fim);
      const dias = diasSemVaga(mapa, m.tipo, m.data_inicio, m.data_fim);
      if (dias.length) { setModalNova({ ...m, diasSemVaga: dias }); return; }
    }

    setErro('');
    // Valor antecipado conta como pagamento recebido AGORA (mesmo espírito
    // do antecipado na entrada do Pátio) — precisa de caixa aberto pra não
    // ficar de fora do fechamento (ver Caixa.jsx e 0040_reserva_antecipado.sql
    // e AbrirCaixaInline). Busca direto no banco (não do state `caixaAberto`):
    // esta função é chamada de novo assim que o operador abre o caixa
    // (pendenteCaixa.executar), e o state daquele render ainda não teria
    // atualizado — bateria o gate de novo e tentaria abrir um SEGUNDO caixa
    // (erro de unicidade).
    let caixaIdAntecipado = null;
    if (Number(m.valorAntecipado) > 0) {
      const { data: cx } = await supabase.from('caixas').select('*')
        .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
      if (!cx) {
        setPendenteCaixa({ executar: () => tentarSalvarReserva(forcar) });
        return;
      }
      if (!caixaAberto) setCaixaAberto(cx);
      caixaIdAntecipado = cx.id;
    }
    const { error } = await supabase.from('reservas').insert({
      filial_id: perfil.filial_id, tipo: m.tipo, periodo: m.periodo,
      data_inicio: m.data_inicio, data_fim: m.data_fim,
      nome: m.nome || null, telefone: m.telefone || null, placa: m.placa || null,
      modelo: m.modelo || null, observacao: m.observacao || null, criado_por: perfil.id,
      valor_proposto: valorProposto && !valorProposto.pedeValor ? valorProposto.valor : null,
      valor_antecipado: Number(m.valorAntecipado) || null,
      forma_antecipado: Number(m.valorAntecipado) > 0
        ? (m.formaAntecipado || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || null) : null,
      caixa_id_antecipado: caixaIdAntecipado,
    });
    if (error) { setErro(error.message); return; }
    setModalNova(null);
    setMsg('Reserva criada.');
    carregarMes();
    if (diaSelecionado) carregarReservasDoDia(diaSelecionado);
  }

  function imprimirReserva(r) {
    setTicket({
      titulo: 'Reserva de vaga',
      linhas: [
        ['Placa', r.placa || '—'], ['Modelo', r.modelo || '—'],
        ['Data início', fmtDataBR(r.data_inicio)], ['Data final', fmtDataBR(r.data_fim)],
        ['Tipo', r.tipo], ['Nome', r.nome || '—'], ['Telefone', r.telefone || '—'],
        ...(Number(r.valor_proposto) > 0 ? [['Valor proposto', fmtBRL(Number(r.valor_proposto))]] : []),
        ...(Number(r.valor_antecipado) > 0 ? [['Valor antecipado', fmtBRL(Number(r.valor_antecipado))]] : []),
        ...(r.observacao ? [['Observações', r.observacao]] : []),
      ],
      tipo: 'reserva',
      ...(modelosTicket.reserva ? { modelo: modelosTicket.reserva } : {}),
      dados: { ...dadosFilial(filial || {}), ...dadosReserva(r), US: perfil.nome },
    });
    setCelularTicket(r.telefone || '');
  }

  async function mudarStatus(reserva, status) {
    if (status === 'cancelada' && !window.confirm('Excluir esta reserva? Os dias voltam a ficar disponíveis.')) return;
    const { error } = await supabase.from('reservas').update({ status }).eq('id', reserva.id);
    if (error) { setErro(error.message); return; }
    carregarMes();
    if (diaSelecionado) carregarReservasDoDia(diaSelecionado);
  }

  const [ano, mesNum] = anoMes.split('-').map(Number);
  const nomeMes = new Date(ano, mesNum - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <>
      <div className="card">
        <div className="card-cab">
          <div>
            <h2>Reservas de vaga</h2>
            <p className="suave">
              Por dia, quantas vagas de cada tipo ainda sobram até esgotar — mensalistas e avulsos
              não entram nessa conta, só reservas confirmadas.
            </p>
          </div>
          <button className="btn-primary" onClick={abrirNovaReserva} disabled={!tipos.length}>+ Nova reserva</button>
        </div>
        {!tipos.length && !carregando && (
          <p className="aviso">
            Nenhum tipo de vaga cadastrado ainda — cadastre em Cadastros → Vagas/boxes
            (ex.: algumas com tipo "coberta", outras "descoberta") antes de reservar.
          </p>
        )}
        {erro && <div className="aviso">{erro}</div>}
        {msg && <div className="ok-txt">{msg}</div>}

        <div className="linha-form" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <button className="btn-ghost" onClick={() => setAnoMes((a) => mudarAnoMes(a, -1))}>‹ Mês anterior</button>
          <strong style={{ textTransform: 'capitalize' }}>{carregando ? 'Carregando…' : nomeMes}</strong>
          <button className="btn-ghost" onClick={() => setAnoMes((a) => mudarAnoMes(a, 1))}>Mês seguinte ›</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="suave" style={{ textAlign: 'center', fontSize: 12 }}>{d}</div>
          ))}
          {celulas.map((dia, i) => (
            <div key={dia || `vazio-${i}`}
              className={dia ? 'linha-clicavel' + (dia === diaSelecionado ? ' linha-selecionada' : '') : ''}
              onClick={() => selecionarDia(dia)}
              style={{ minHeight: 56, borderRadius: 8, padding: 6, border: dia ? '1px solid var(--linha)' : 'none' }}>
              {dia && (
                <>
                  <div className="mono" style={{ fontSize: 12 }}>{Number(dia.slice(-2))}</div>
                  {tipos.map((t) => (
                    <div key={t} className="suave" style={{ fontSize: 11 }}>
                      {t}: <strong style={{ color: corRestante(capacidade[dia]?.[t]) }}>{capacidade[dia]?.[t] ?? '—'}</strong>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {diaSelecionado && (
        <div className="card">
          <div className="card-cab">
            <h2>Reservas em {fmtDataBR(diaSelecionado)}</h2>
            <button className="btn-ghost" onClick={() => imprimirRelatorioDia(diaSelecionado, reservasDoDia, filial)}>
              Imprimir relatório do dia
            </button>
          </div>
          <table>
            <thead><tr><th>Tipo</th><th>Período</th><th>Cliente</th><th>Placa</th><th>Status</th><th>Chegou</th><th></th></tr></thead>
            <tbody>
              {reservasDoDia.map((r) => (
                <tr key={r.id}>
                  <td>
                    {Number(r.valor_antecipado) > 0 && <span title={`Antecipado: ${fmtBRL(Number(r.valor_antecipado))}`}>$ </span>}
                    {r.tipo}
                  </td>
                  <td>{ROTULO_PERIODO[r.periodo] || r.periodo}</td>
                  <td>{r.nome || '—'}{r.telefone ? ` · ${r.telefone}` : ''}</td>
                  <td className="mono">{r.placa || '—'}</td>
                  <td>{ROTULO_STATUS[r.status] || r.status}</td>
                  <td>{r.chegou_em ? 'Sim' : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn-ghost" onClick={() => imprimirReserva(r)}>Imprimir</button>
                    {r.status === 'confirmada' && (
                      <>
                        <button className="btn-ghost" onClick={() => mudarStatus(r, 'concluida')}>Concluída</button>
                        <button className="btn-ghost" onClick={() => mudarStatus(r, 'no_show')}>Não veio</button>
                        <button className="btn-ghost aviso-btn" onClick={() => mudarStatus(r, 'cancelada')}>Excluir</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {reservasDoDia.length === 0 && <tr><td colSpan={7} className="suave">Nenhuma reserva cobre este dia.</td></tr>}
            </tbody>
            {reservasDoDia.length > 0 && (
              <tfoot><tr>
                <td colSpan={7}>
                  <strong>Total: </strong>
                  {Object.entries(totaisPorTipo(reservasDoDia)).map(([t, n]) => `${t}: ${n}`).join(' · ')}
                </td>
              </tr></tfoot>
            )}
          </table>
        </div>
      )}

      {modalNova && (
        <div className="modal-bg" onClick={() => setModalNova(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
            <h2>Nova reserva</h2>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ flex: 1 }}>
                <label>Tipo de vaga</label>
                <select value={modalNova.tipo} onChange={(e) => setModalNova({ ...modalNova, tipo: e.target.value, diasSemVaga: null })}>
                  {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="campo" style={{ flex: 1 }}>
                <label>Período</label>
                <select value={modalNova.periodo} onChange={(e) => setModalNova({ ...modalNova, periodo: e.target.value })}>
                  {Object.entries(ROTULO_PERIODO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ flex: 1 }}>
                <label>De</label>
                <input type="date" min={hojeISO()} value={modalNova.data_inicio}
                  onChange={(e) => setModalNova({ ...modalNova, data_inicio: e.target.value, diasSemVaga: null })} />
              </div>
              <div className="campo" style={{ flex: 1 }}>
                <label>Até</label>
                <input type="date" min={modalNova.data_inicio || hojeISO()} value={modalNova.data_fim}
                  onChange={(e) => setModalNova({ ...modalNova, data_fim: e.target.value, diasSemVaga: null })} />
              </div>
            </div>
            <div className="campo" style={{ marginBottom: 10 }}>
              <label>Nome (opcional)</label>
              <input value={modalNova.nome} onChange={(e) => setModalNova({ ...modalNova, nome: e.target.value })} />
            </div>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ flex: 1 }}>
                <label>Telefone (opcional)</label>
                <input value={modalNova.telefone} onChange={(e) => setModalNova({ ...modalNova, telefone: e.target.value })} />
              </div>
              <div className="campo" style={{ flex: 1 }}>
                <label>Placa (opcional)</label>
                <input className="mono" style={{ textTransform: 'uppercase' }} value={modalNova.placa}
                  onChange={(e) => setModalNova({ ...modalNova, placa: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="campo" style={{ marginBottom: 10 }}>
              <label>Modelo do veículo (opcional)</label>
              <input value={modalNova.modelo} onChange={(e) => setModalNova({ ...modalNova, modelo: e.target.value })} />
              <span className="suave" style={{ fontSize: 11 }}>
                Se bater com um modelo já cadastrado, a entrada no dia da reserva sai sozinha.
              </span>
            </div>
            <div className="campo" style={{ marginBottom: 10 }}>
              <label>Observação (opcional)</label>
              <input value={modalNova.observacao} onChange={(e) => setModalNova({ ...modalNova, observacao: e.target.value })} />
            </div>
            <p className="suave" style={{ fontSize: 12, marginBottom: 10 }}>
              {valorProposto && !valorProposto.pedeValor
                ? <>Valor proposto (tabela {tabelaPorTipo[modalNova.tipo]}): <strong>{fmtBRL(valorProposto.valor)}</strong> — estimativa, a cobrança real acontece na saída.</>
                : 'Sem estimativa de valor: cadastre o código das vagas desse tipo com o prefixo da tabela de preço (ver Cadastros → Vagas/boxes).'}
            </p>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ flex: 1 }}>
                <label>Valor antecipado (opcional)</label>
                <input type="number" step="0.01" min="0" value={modalNova.valorAntecipado}
                  onChange={(e) => setModalNova({ ...modalNova, valorAntecipado: e.target.value })} />
              </div>
              {Number(modalNova.valorAntecipado) > 0 && (
                <div className="campo" style={{ flex: 1 }}>
                  <label>Forma de pagamento</label>
                  <select value={modalNova.formaAntecipado || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || ''}
                    onChange={(e) => setModalNova({ ...modalNova, formaAntecipado: e.target.value })}>
                    {formas.map((f) => <option key={f.codigo} value={f.codigo}>{f.descricao}</option>)}
                  </select>
                </div>
              )}
            </div>
            {Number(modalNova.valorAntecipado) > 0 && (
              <p className="suave" style={{ fontSize: 11, marginTop: -6, marginBottom: 10 }}>
                Conta como pagamento recebido agora — entra no caixa aberto deste momento. Na entrada
                do carro, é descontado do valor total calculado na saída.
                {!caixaAberto && ' Sem caixa aberto — ao reservar, vamos pedir o troco inicial pra abrir um.'}
              </p>
            )}
            {erro && <p className="aviso">{erro}</p>}
            {modalNova.diasSemVaga && (
              <div className="aviso" style={{ marginBottom: 10 }}>
                Sem vaga "{modalNova.tipo}" em: {modalNova.diasSemVaga.map(fmtDataBR).join(', ')}.
                Ainda dá pra reservar mesmo assim, se for o caso.
              </div>
            )}
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setModalNova(null)}>Cancelar</button>
              {modalNova.diasSemVaga ? (
                <button className="btn-primary" onClick={() => tentarSalvarReserva(true)}>Reservar mesmo assim</button>
              ) : (
                <button className="btn-primary" onClick={() => tentarSalvarReserva(false)}>Reservar</button>
              )}
            </div>
          </div>
        </div>
      )}

      {ticket && (
        <TicketModal ticket={ticket} filial={filial} perfil={perfil} celular={celularTicket}
          onCelular={setCelularTicket} onFechar={() => setTicket(null)} />
      )}

      {pendenteCaixa && (
        // z-index acima do padrão (50): nasce de dentro do modal "Nova reserva",
        // que já está aberto — precisa ficar por cima dele.
        <div className="modal-bg" style={{ zIndex: 60 }} onClick={() => setPendenteCaixa(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 92vw)' }}>
            <h2>Abrir caixa</h2>
            <AbrirCaixaInline perfil={perfil}
              onAberto={(cx) => { setCaixaAberto(cx); const { executar } = pendenteCaixa; setPendenteCaixa(null); executar(); }} />
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setPendenteCaixa(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
