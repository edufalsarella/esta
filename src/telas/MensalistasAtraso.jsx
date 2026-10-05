import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { hojeISO, fmtDataBR } from '../lib/tempo.js';
import { mensalistasEmAtraso } from '../lib/mensalistasAtraso.js';

const TAMANHO_PAGINA = 1000;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Todas as linhas da consulta (o Supabase devolve no máximo 1000 por vez). */
async function todas(consulta) {
  const linhas = [];
  for (let desde = 0; ; desde += TAMANHO_PAGINA) {
    const { data, error } = await consulta().range(desde, desde + TAMANHO_PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data || []));
    if (!data || data.length < TAMANHO_PAGINA) return linhas;
  }
}

const textoDias = (d) => (d === 0 ? 'vence hoje' : `${d} dia${d === 1 ? '' : 's'}`);

// Impressão em janela dedicada — mesmo padrão do Relatório de convênios.
function imprimir({ linhas, dataRef, filial }) {
  const cabecalho = filial && (filial.nome_fantasia || filial.endereco || filial.cnpj) ? `
    ${filial.nome_fantasia ? `<div class="nome">${escapeHtml(filial.nome_fantasia)}</div>` : ''}
    ${filial.endereco ? `<div class="linha-end">${escapeHtml(filial.endereco)}</div>` : ''}
    ${filial.cnpj ? `<div class="linha-end">CNPJ: ${escapeHtml(filial.cnpj)}</div>` : ''}
    <hr>` : '';
  const corpo = linhas.map((l) => `<tr><td>${escapeHtml(l.placas.join(', '))}</td><td>${escapeHtml(l.razao)}</td>`
    + `<td>${escapeHtml(fmtDataBR(l.vencimento))}</td><td style="text-align:right">${escapeHtml(textoDias(l.dias))}</td></tr>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Mensalistas em atraso</title>
    <style>
      @page { margin: 12mm; }
      body { font-family: system-ui, Arial, sans-serif; color: #000; }
      .nome { font-size: 18px; font-weight: 800; margin-bottom: 2px; }
      .linha-end { font-size: 12px; color: #333; margin-bottom: 2px; }
      hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
      h1 { font-size: 16px; margin: 0 0 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
      th { text-align: left; padding: 3px 6px 3px 0; border-bottom: 1px solid #999; }
      td { padding: 3px 6px 3px 0; border-bottom: 1px solid #ddd; }
      .total { font-size: 13px; margin-top: 10px; text-align: right; }
    </style></head><body>
      ${cabecalho}
      <h1>Mensalistas em atraso</h1>
      <p class="linha-end">Emitido em ${escapeHtml(fmtDataBR(dataRef))} — vencimentos até esta data, inclusive</p>
      ${linhas.length ? `<table>
        <thead><tr><th>Placa</th><th>Mensalista</th><th>Último vencimento</th><th style="text-align:right">Dias em atraso</th></tr></thead>
        <tbody>${corpo}</tbody>
      </table>` : '<p>Nenhum mensalista em atraso.</p>'}
      <p class="total">${linhas.length} mensalista(s) em atraso</p>
    </body></html>`;

  const win = window.open('', '_blank', 'width=520,height=650');
  if (!win) { window.alert('Permita pop-ups para imprimir o relatório.'); return; }
  win.document.write(html);
  win.document.close();
  win.onafterprint = () => win.close();
  win.focus();
  win.print();
}

/**
 * Mensalistas com a mensalidade vencida na data de emissão (inclusive os que
 * vencem no próprio dia), do menor atraso pro maior. Regra em
 * lib/mensalistasAtraso.js.
 */
export default function MensalistasAtraso({ perfil }) {
  const [dataRef, setDataRef] = useState(hojeISO);
  const [base, setBase] = useState(null); // { mensalistas, placasPorMensalista }
  const [filial, setFilial] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    supabase.from('filiais').select('nome_fantasia, endereco, cnpj').eq('id', perfil.filial_id).maybeSingle()
      .then(({ data }) => setFilial(data));
    Promise.all([
      todas(() => supabase.from('mensalistas').select('id, codigo, razao, proximo_pagamento, ativo').order('id')),
      todas(() => supabase.from('mensalista_veiculos').select('id, mensalista_id, placa').order('id')),
    ]).then(([mensalistas, veiculos]) => {
      const placasPorMensalista = {};
      for (const v of veiculos) (placasPorMensalista[v.mensalista_id] ||= []).push(v.placa);
      setBase({ mensalistas, placasPorMensalista });
    }).catch((e) => setErro(e.message));
  }, [perfil.filial_id]);

  const linhas = base && dataRef ? mensalistasEmAtraso(base.mensalistas, base.placasPorMensalista, dataRef) : [];

  return (
    <>
      <div className="card">
        <div className="card-cab">
          <div>
            <h2>Mensalistas em atraso</h2>
            <p className="suave">
              Mensalistas ativos com o vencimento até a data de emissão (inclusive os que vencem no dia),
              do menor atraso para o maior. O vencimento é o "Próx. pagamento" do cadastro.
            </p>
          </div>
          <div className="linha-form">
            <button className="btn-primary" disabled={!base} onClick={() => imprimir({ linhas, dataRef, filial })}>
              Imprimir
            </button>
          </div>
        </div>
        {erro && <div className="aviso">{erro}</div>}
        <div className="linha-form">
          <div className="campo">
            <label>Data de emissão</label>
            <input type="date" value={dataRef} onChange={(e) => setDataRef(e.target.value)} />
          </div>
        </div>
      </div>

      {!base && !erro && <div className="card suave">Carregando…</div>}

      {base && (
        <div className="card">
          <p className="suave" style={{ marginTop: 0 }}>
            Emitido em {fmtDataBR(dataRef)} — {linhas.length} mensalista(s) em atraso
          </p>
          {linhas.length === 0 ? (
            <p className="suave">Nenhum mensalista em atraso.</p>
          ) : (
            <div className="tabela-scroll">
              <table>
                <thead><tr>
                  <th>Placa</th><th>Mensalista</th><th>Último vencimento</th>
                  <th style={{ textAlign: 'right' }}>Dias em atraso</th>
                </tr></thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.id}>
                      <td className="mono">{l.placas.join(', ')}</td>
                      <td>{l.razao}</td>
                      <td className="mono">{fmtDataBR(l.vencimento)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{textoDias(l.dias)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
