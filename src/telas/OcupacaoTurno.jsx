import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { hojeISO, somarDias, fmtDataBR } from '../lib/tempo.js';
import { ocupacaoPorTurno, TURNOS, ROTULO_TURNO } from '../lib/ocupacaoTurno.js';

// diaSemana do legado: 1 = domingo … 7 = sábado
const DIA_SEMANA = ['', 'Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIA_SEMANA_CURTO = ['', 'Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MAX_DIAS = 62;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const diaMes = (iso) => fmtDataBR(iso).slice(0, 5);

/**
 * Impressão na bobina de 58mm (mesmo padrão do fechamento de caixa, ver
 * caixaRelatorio.js) — 4 colunas curtas: "Seg 06/10 | M | T | N".
 */
function imprimir({ dias, de, ate, totalVagas, filial }) {
  const cabecalho = filial?.nome_fantasia ? `<div class="nome">${escapeHtml(filial.nome_fantasia)}</div><hr>` : '';
  const linhas = dias.map((l) => `<tr><td>${DIA_SEMANA_CURTO[l.diaSemana]} ${diaMes(l.dia)}</td>`
    + TURNOS.map((t) => `<td class="n">${l[t].total}</td>`).join('') + '</tr>').join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ocupação por turno</title>
    <style>
      @page { size: 58mm auto; margin: 0; }
      body { font-family: system-ui, Arial, sans-serif; color: #000; margin: 0; padding: 2mm 3mm; box-sizing: border-box; }
      .nome { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
      hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
      h1 { font-size: 14px; margin: 0 0 2px; text-align: center; }
      .periodo { font-size: 11px; text-align: center; color: #333; margin-bottom: 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { font-size: 11px; text-align: right; border-bottom: 1px dashed #999; padding: 2px 0; }
      th:first-child { text-align: left; }
      td { padding: 2px 0; border-bottom: 1px dotted #ccc; }
      td.n { text-align: right; font-variant-numeric: tabular-nums; }
      .rodape { font-size: 10px; color: #333; margin-top: 8px; }
    </style></head><body>
      ${cabecalho}
      <h1>Ocupação por turno</h1>
      <div class="periodo">${escapeHtml(fmtDataBR(de))} a ${escapeHtml(fmtDataBR(ate))}${totalVagas ? `<br>Vagas: ${totalVagas}` : ''}</div>
      <table>
        <thead><tr><th>Dia</th><th>Manhã</th><th>Tarde</th><th>Noite</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="rodape">
        Reservas + mensalistas (pelo turno contratado).<br>
        Impresso em ${new Date().toLocaleString('pt-BR')}
      </div>
    </body></html>`;
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) { window.alert('Permita pop-ups para imprimir o relatório.'); return; }
  win.document.write(html);
  win.document.close();
  win.onafterprint = () => win.close();
  win.focus();
  win.print();
}

/**
 * Ocupação do estacionamento por dia e turno (manhã/tarde/noite): reservas
 * + mensalistas pelo turno contratado. Regras em lib/ocupacaoTurno.js.
 */
export default function OcupacaoTurno({ perfil }) {
  const [de, setDe] = useState(hojeISO);
  const [ate, setAte] = useState(() => somarDias(hojeISO(), 6));
  const [dados, setDados] = useState(null); // { de, ate, dias, totalVagas }
  const [filial, setFilial] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    supabase.from('filiais').select('nome_fantasia').eq('id', perfil.filial_id).maybeSingle()
      .then(({ data }) => setFilial(data));
  }, [perfil.filial_id]);

  const periodoInvalido = !de || !ate || de > ate;
  const longoDemais = !periodoInvalido && somarDias(de, MAX_DIAS - 1) < ate;

  useEffect(() => {
    if (periodoInvalido || longoDemais) return;
    let ativo = true;
    setCarregando(true); setErro('');
    Promise.all([
      supabase.from('reservas').select('periodo, data_inicio, data_fim, status')
        .in('status', ['confirmada', 'concluida']).lte('data_inicio', ate).gte('data_fim', de),
      supabase.from('mensalistas').select('ativo, qte_vagas, restr_manha, restr_tarde, restr_noite').eq('ativo', true),
      supabase.from('vagas').select('id', { count: 'exact', head: true }).eq('ativo', true),
    ]).then(([r, m, v]) => {
      if (!ativo) return;
      const falha = r.error || m.error || v.error;
      if (falha) { setErro(falha.message); return; }
      setDados({ de, ate, dias: ocupacaoPorTurno(r.data, m.data, de, ate), totalVagas: v.count || 0 });
    }).finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [de, ate, periodoInvalido, longoDemais]);

  return (
    <>
      <div className="card">
        <div className="card-cab">
          <div>
            <h2>Ocupação por turno</h2>
            <p className="suave">
              Vagas ocupadas em cada dia, por turno: reservas (integral conta nos três turnos) mais os
              mensalistas, de acordo com o dia/turno contratado no cadastro.
            </p>
          </div>
          <div className="linha-form">
            <button className="btn-primary" disabled={!dados || carregando}
              onClick={() => imprimir({ ...dados, filial })}>
              Imprimir
            </button>
          </div>
        </div>
        {erro && <div className="aviso">{erro}</div>}
        <div className="linha-form" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="campo"><label>De</label><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
          <div className="campo"><label>Até</label><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
          <button type="button" className="btn-ghost" onClick={() => { setDe(hojeISO()); setAte(somarDias(hojeISO(), 6)); }}>
            Próximos 7 dias
          </button>
        </div>
        {periodoInvalido && de && ate && <p className="aviso">A data inicial está depois da final.</p>}
        {longoDemais && <p className="aviso">Escolha um período de até {MAX_DIAS} dias.</p>}
      </div>

      {!dados && carregando && <div className="card suave">Carregando…</div>}

      {dados && (
        <div className="card" style={{ opacity: carregando ? 0.5 : 1, transition: 'opacity .2s' }}>
          <p className="suave" style={{ marginTop: 0 }}>
            {fmtDataBR(dados.de)} a {fmtDataBR(dados.ate)}
            {dados.totalVagas > 0 && <> — {dados.totalVagas} vaga(s) cadastrada(s)</>}
          </p>
          <div className="tabela-scroll">
            <table>
              <thead><tr>
                <th>Dia</th>
                {TURNOS.map((t) => <th key={t} style={{ textAlign: 'right' }}>{ROTULO_TURNO[t]}</th>)}
              </tr></thead>
              <tbody>
                {dados.dias.map((l) => (
                  <tr key={l.dia}>
                    <td><span className="mono">{fmtDataBR(l.dia)}</span> {DIA_SEMANA[l.diaSemana]}</td>
                    {TURNOS.map((t) => {
                      const c = l[t];
                      const lotado = dados.totalVagas > 0 && c.total >= dados.totalVagas;
                      return (
                        <td key={t} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                          title={`${c.reservas} reserva(s) + ${c.mensalistas} mensalista(s)`}>
                          <strong style={lotado ? { color: 'var(--erro)' } : undefined}>{c.total}</strong>
                          <div className="suave" style={{ fontSize: 11 }}>R {c.reservas} · M {c.mensalistas}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="suave" style={{ fontSize: 11, marginBottom: 0 }}>
            R = reservas · M = mensalistas. Em vermelho: turno com todas as vagas cadastradas ocupadas.
            Reservas canceladas ou "não veio" não contam.
          </p>
        </div>
      )}
    </>
  );
}
