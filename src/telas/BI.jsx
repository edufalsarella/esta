import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { hojeISO, dataDeISO, dataHoraDe, limitesDiaLocal, fmtBRL, fmtHora, fmtDataBR } from '../lib/tempo.js';
import { GraficoLinha, GraficoBarras } from '../componentes/Graficos.jsx';
import { horas, minuto, minutosParaHHMM } from '../../packages/tarifacao/tarifacao.ts';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Impressão numa janela dedicada (mesmo padrão do ticket de entrada/saída).
// `veiculosDetalhe` vem null quando o checkbox "Ver veículos" está desmarcado.
function imprimirRelatorio(dados, de, ate, filial, veiculosDetalhe) {
  const cabecalho = filial && (filial.nome_fantasia || filial.endereco || filial.cnpj) ? `
    ${filial.nome_fantasia ? `<div class="nome">${escapeHtml(filial.nome_fantasia)}</div>` : ''}
    ${filial.endereco ? `<div class="linha-end">${escapeHtml(filial.endereco)}</div>` : ''}
    ${filial.cnpj ? `<div class="linha-end">CNPJ: ${escapeHtml(filial.cnpj)}</div>` : ''}
    <hr>` : '';

  const kpis = [
    ['Saídas', dados.totalVeic],
    ['Avulso', fmtBRL(dados.valorAvulso)],
    ['Serviços', fmtBRL(dados.valorServicos)],
    ['Convênio', fmtBRL(dados.descontos)],
    ['Antecipados', fmtBRL(dados.antecipados)],
    ['Bônus fidelidade', fmtBRL(dados.bonus)],
    ['Tempo médio', fmtHora(dados.tempoMedio)],
    ['Mensalidades recebidas', `${dados.mensalidades.length} · ${fmtBRL(dados.mensalidadesTotal)}`],
    ['Venda de produtos', `${dados.produtosVendidos.length} · ${fmtBRL(dados.produtosTotal)}`],
    ['Faturado (avulso + serviços + convênio + antecipados + bônus + mensalidades + produtos)', fmtBRL(dados.faturado)],
  ].map(([r, v]) => `<p><strong>${escapeHtml(r)}:</strong> ${escapeHtml(v)}</p>`).join('');

  const porOperador = Object.entries(dados.porOperador)
    .sort(([, a], [, b]) => b.faturado - a.faturado)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v.qtd}</td><td style="text-align:right">${escapeHtml(fmtBRL(v.faturado))}</td></tr>`).join('');
  const resumoDiario = dados.resumoDiario.map((d) => `<tr>
      <td>${escapeHtml(fmtDataBR(d.dia))}</td>
      <td style="text-align:right">${escapeHtml(fmtBRL(d.faturado))}</td>
      <td style="text-align:right">${escapeHtml(fmtBRL(d.desconto))}</td>
      <td style="text-align:right">${escapeHtml(fmtBRL(d.bonus))}</td>
      <td style="text-align:right">${escapeHtml(fmtBRL(d.recebido))}</td>
    </tr>`).join('');
  const porTipo = Object.entries(dados.porTipo)
    .map(([k, v]) => `<tr><td>${escapeHtml(rotuloTipo(k))}</td><td style="text-align:right">${v}</td></tr>`).join('');
  const porForma = Object.entries(dados.recebidoPorForma)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${escapeHtml(fmtBRL(v))}</td></tr>`).join('');
  const porTipoCancelado = Object.entries(dados.porTipoCancelado)
    .map(([k, v]) => `<tr><td>${escapeHtml(rotuloTipo(k))}</td><td style="text-align:right">${v}</td></tr>`).join('');
  const porServico = Object.entries(dados.porServico)
    .sort(([, a], [, b]) => b.valor - a.valor)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right">${v.quantidade}</td><td style="text-align:right">${escapeHtml(fmtBRL(v.valor))}</td></tr>`).join('');

  const mensalidadesHtml = `
      <h2>Mensalidades recebidas (${dados.mensalidades.length})</h2>
      <table><thead><tr>
        <th>Pagamento</th><th>Mensalista</th><th>Forma</th><th>Próximo</th><th>Valor</th>
      </tr></thead><tbody>${dados.mensalidades.map((p) => `<tr>
        <td>${escapeHtml(fmtDataBR(p.dt_pagamento))}</td>
        <td>${escapeHtml(p.mensalista)}</td>
        <td>${escapeHtml(p.forma)}</td>
        <td>${escapeHtml(fmtDataBR(p.proximo_pagamento))}</td>
        <td style="text-align:right">${escapeHtml(fmtBRL(p.valor))}</td>
      </tr>`).join('') || '<tr><td colspan="5">Nenhuma mensalidade recebida no período.</td></tr>'}</tbody>
      ${dados.mensalidades.length ? `<tfoot><tr><td colspan="4"><strong>Total</strong></td><td style="text-align:right"><strong>${escapeHtml(fmtBRL(dados.mensalidadesTotal))}</strong></td></tr></tfoot>` : ''}
      </table>`;

  const produtosHtml = `
      <h2>Vendas de produtos (${dados.produtosVendidos.length})</h2>
      <table><thead><tr>
        <th>Data</th><th>Produto</th><th>Qtde</th><th>Forma</th><th>Valor</th><th>Estoque atual</th>
      </tr></thead><tbody>${dados.produtosVendidos.map((v) => `<tr>
        <td>${escapeHtml(new Date(v.criado_em).toLocaleString('pt-BR'))}</td>
        <td>${escapeHtml(v.produto)}</td>
        <td style="text-align:right">${v.quantidade}</td>
        <td>${escapeHtml(v.forma)}</td>
        <td style="text-align:right">${escapeHtml(fmtBRL(v.valor))}</td>
        <td style="text-align:right">${v.estoque ?? '—'}</td>
      </tr>`).join('') || '<tr><td colspan="6">Nenhuma venda de produto no período.</td></tr>'}</tbody>
      ${dados.produtosVendidos.length ? `<tfoot><tr><td colspan="4"><strong>Total</strong></td><td style="text-align:right"><strong>${escapeHtml(fmtBRL(dados.produtosTotal))}</strong></td><td></td></tr></tfoot>` : ''}
      </table>`;

  // Cada veículo em 2-3 linhas de texto corrido (não colunas de tabela) —
  // com 10 dados por veículo, uma tabela larga estourava a largura da
  // página impressa e cortava colunas fora (não saía completa). Texto
  // corrido só quebra linha, nunca corta — mesmo raciocínio do relatório
  // de caixa (ver src/lib/caixaRelatorio.js).
  const veiculosHtml = veiculosDetalhe != null ? `
      <h2>Veículos (${veiculosDetalhe.length})</h2>
      ${veiculosDetalhe.map((v) => `
        <div class="veiculo">
          <p class="v1"><strong>${escapeHtml(v.placa)}</strong> — ${escapeHtml(v.modelo || '—')} (${escapeHtml(v.tipo_veic)})${v.cancelado ? ' <strong>· Cancelado</strong>' : ''}</p>
          <p class="v2">Entrada: ${escapeHtml(v.dt_entrada.split('-').reverse().join('/'))} ${escapeHtml(fmtHora(Number(v.hr_entrada)))}${
            v.cancelado ? '' : ` · Saída: ${escapeHtml(v.dt_saida.split('-').reverse().join('/'))} ${escapeHtml(fmtHora(Number(v.hr_saida)))} · Tempo: ${v.tempo != null ? escapeHtml(fmtHora(v.tempo)) : '—'}`
          }</p>
          ${v.cancelado ? '' : `<p class="v3">Pagto: ${escapeHtml(v.pagamento)} · Valor: ${escapeHtml(fmtBRL(v.valor))}${v.valorCalculado != null ? ' *' : ''}${
            v.descontoConvenio ? ` · Convênio: ${escapeHtml(fmtBRL(v.descontoConvenio))}` : ''
          }${v.servico != null ? ` · Serviço: ${escapeHtml(fmtBRL(v.servico))}` : ''}</p>`}
        </div>`).join('') || '<p>Nenhum veículo no período.</p>'}
      ${veiculosDetalhe.some((v) => v.valorCalculado != null)
        ? '<p style="font-size:11px">* valor alterado na saída (diferente do calculado pela tabela).</p>' : ''
      }` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório BI</title>
    <style>
      body { font-family: system-ui, Arial, sans-serif; color: #000; padding: 20px; max-width: 640px; }
      .nome { font-size: 18px; font-weight: 800; margin-bottom: 2px; }
      .linha-end { font-size: 12px; color: #333; margin-bottom: 2px; }
      hr { border: none; border-top: 1px dashed #999; margin: 12px 0; }
      h1 { font-size: 16px; margin: 0 0 4px; }
      h2 { font-size: 14px; margin: 16px 0 6px; }
      p { font-size: 13px; margin: 3px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; padding: 4px 6px 4px 0; border-bottom: 1px solid #999; }
      td { padding: 4px 6px 4px 0; border-bottom: 1px solid #ddd; }
      .veiculo { border-bottom: 1px dashed #ccc; padding-bottom: 4px; margin-bottom: 4px; }
      .veiculo p { margin: 1px 0; font-size: 12px; }
      .veiculo .v1 { font-size: 13px; }
    </style></head><body>
      ${cabecalho}
      <h1>Painel / BI</h1>
      <p class="linha-end">Período: ${escapeHtml(de.split('-').reverse().join('/'))} a ${escapeHtml(ate.split('-').reverse().join('/'))}</p>
      ${kpis}
      ${dados.resumoDiario.length > 1 ? `
      <h2>Resumo por dia</h2>
      <table><thead><tr><th>Data</th><th style="text-align:right">Faturado</th><th style="text-align:right">Desconto</th><th style="text-align:right">Bônus</th><th style="text-align:right">Recebido</th></tr></thead>
      <tbody>${resumoDiario}</tbody></table>` : ''}
      <h2>Por operador</h2>
      <table><thead><tr><th>Operador</th><th style="text-align:right">Qtde</th><th style="text-align:right">Faturado</th></tr></thead>
      <tbody>${porOperador || '<tr><td colspan="3">Sem movimentação no período.</td></tr>'}</tbody></table>
      <h2>Por tipo</h2>
      <table><tbody>${porTipo || '<tr><td>—</td></tr>'}</tbody></table>
      <h2>Cancelados por tipo</h2>
      <table><tbody>${porTipoCancelado || '<tr><td>Nenhum cancelamento no período.</td></tr>'}</tbody></table>
      <h2>Por tipo de lavagem</h2>
      <table><thead><tr><th>Serviço</th><th style="text-align:right">Qtde</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>${porServico || '<tr><td colspan="3">Nenhum serviço no período.</td></tr>'}</tbody></table>
      <h2>Por forma de pagamento</h2>
      <table><tbody>${porForma || '<tr><td>Sem pagamentos no período.</td></tr>'}</tbody></table>
      ${mensalidadesHtml}
      ${produtosHtml}
      ${veiculosHtml}
    </body></html>`;
  const win = window.open('', '_blank', 'width=420,height=650');
  if (!win) { window.alert('Permita pop-ups para imprimir o relatório.'); return; }
  win.document.write(html);
  win.document.close();
  win.onafterprint = () => win.close();
  win.focus();
  win.print();
}

// Versão em texto simples (sem HTML) do mesmo relatório, pra WhatsApp/Email.
function textoRelatorio(dados, de, ate, filial) {
  const linhas = [];
  if (filial?.nome_fantasia) linhas.push(filial.nome_fantasia);
  if (filial?.endereco) linhas.push(filial.endereco);
  if (filial?.cnpj) linhas.push(`CNPJ: ${filial.cnpj}`);
  if (linhas.length) linhas.push('');
  linhas.push('Painel / BI');
  linhas.push(`Período: ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`);
  linhas.push('');
  linhas.push(`Saídas: ${dados.totalVeic}`);
  linhas.push(`Avulso: ${fmtBRL(dados.valorAvulso)}`);
  linhas.push(`Serviços: ${fmtBRL(dados.valorServicos)}`);
  linhas.push(`Convênio: ${fmtBRL(dados.descontos)}`);
  linhas.push(`Antecipados: ${fmtBRL(dados.antecipados)}`);
  linhas.push(`Bônus fidelidade: ${fmtBRL(dados.bonus)}`);
  linhas.push(`Tempo médio: ${fmtHora(dados.tempoMedio)}`);
  linhas.push('');
  if (dados.resumoDiario.length > 1) {
    linhas.push('Resumo por dia (data — faturado / desconto / bônus / recebido):');
    for (const d of dados.resumoDiario) {
      linhas.push(`  ${fmtDataBR(d.dia)} — ${fmtBRL(d.faturado)} / ${fmtBRL(d.desconto)} / ${fmtBRL(d.bonus)} / ${fmtBRL(d.recebido)}`);
    }
    linhas.push('');
  }
  linhas.push('Por operador:');
  const porOperador = Object.entries(dados.porOperador).sort(([, a], [, b]) => b.faturado - a.faturado);
  if (porOperador.length) for (const [nome, v] of porOperador) linhas.push(`  ${nome}: ${v.qtd} · ${fmtBRL(v.faturado)}`);
  else linhas.push('  Sem movimentação no período.');
  linhas.push('');
  linhas.push('Por tipo:');
  for (const [k, v] of Object.entries(dados.porTipo)) linhas.push(`  ${rotuloTipo(k)}: ${v}`);
  linhas.push('');
  linhas.push('Cancelados por tipo:');
  const cancelados = Object.entries(dados.porTipoCancelado);
  if (cancelados.length) for (const [k, v] of cancelados) linhas.push(`  ${rotuloTipo(k)}: ${v}`);
  else linhas.push('  Nenhum cancelamento no período.');
  linhas.push('');
  linhas.push('Por tipo de lavagem:');
  const porServico = Object.entries(dados.porServico).sort(([, a], [, b]) => b.valor - a.valor);
  if (porServico.length) for (const [k, v] of porServico) linhas.push(`  ${k}: ${v.quantidade} · ${fmtBRL(v.valor)}`);
  else linhas.push('  Nenhum serviço no período.');
  linhas.push('');
  linhas.push('Recebido por forma de pagamento:');
  const formas = Object.entries(dados.recebidoPorForma);
  if (formas.length) for (const [k, v] of formas) linhas.push(`  ${k}: ${fmtBRL(v)}`);
  else linhas.push('  Sem pagamentos no período.');
  linhas.push('');
  linhas.push(`Mensalidades recebidas: ${dados.mensalidades.length} · ${fmtBRL(dados.mensalidadesTotal)}`);
  for (const p of dados.mensalidades) {
    linhas.push(`  ${fmtDataBR(p.dt_pagamento)} — ${p.mensalista}: ${fmtBRL(p.valor)} (${p.forma}) · próx. ${fmtDataBR(p.proximo_pagamento)}`);
  }
  if (!dados.mensalidades.length) linhas.push('  Nenhuma mensalidade recebida no período.');
  linhas.push('');
  linhas.push(`Venda de produtos: ${dados.produtosVendidos.length} · ${fmtBRL(dados.produtosTotal)}`);
  for (const v of dados.produtosVendidos) {
    linhas.push(`  ${new Date(v.criado_em).toLocaleString('pt-BR')} — ${v.produto}: ${v.quantidade} un · ${fmtBRL(v.valor)} (${v.forma}) · estoque atual: ${v.estoque ?? '—'}`);
  }
  if (!dados.produtosVendidos.length) linhas.push('  Nenhuma venda de produto no período.');
  linhas.push('');
  linhas.push(`Faturado (avulso + serviços + descontos + antecipados + bônus + mensalidades + produtos): ${fmtBRL(dados.faturado)}`);
  return linhas.join('\n');
}

function linkWhatsAppRelatorio(texto) {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

function linkEmailRelatorio(texto, de, ate) {
  const assunto = `Relatório BI — ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}`;
  return `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;
}

const MENSALISTA = new Set(['I', 'P', 'H']);

export default function BI({ perfil }) {
  const [de, setDe] = useState(hojeISO());
  const [ate, setAte] = useState(hojeISO());
  const [dados, setDados] = useState(null);
  const [veiculos, setVeiculos] = useState([]);
  const [verVeiculos, setVerVeiculos] = useState(false);
  const [filial, setFilial] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    supabase.from('filiais').select('nome_fantasia, endereco, cnpj').eq('id', perfil.filial_id).maybeSingle()
      .then(({ data }) => setFilial(data));
  }, [perfil.filial_id]);

  const carregar = useCallback(async () => {
    setErro('');
    const { data: movs, error } = await supabase.from('movimentos').select('*')
      .gte('dt_saida', de).lte('dt_saida', ate).not('dt_saida', 'is', null);
    if (error) { setErro(error.message); return; }
    const { inicio, fim } = limitesDiaLocal(de, ate);
    const { data: cancelados, error: errCanc } = await supabase.from('movimentos').select('*')
      .gte('excluido_em', inicio).lt('excluido_em', fim);
    if (errCanc) { setErro(errCanc.message); return; }
    const ids = movs.map((m) => m.id);
    let pagtos = [];
    let movsComServico = new Set();
    let servicosDoMovimento = [];
    if (ids.length) {
      const { data } = await supabase.from('movimento_pagamentos').select('*').in('movimento_id', ids);
      pagtos = data || [];
      // Serviço sempre substitui a tabela do veículo (nunca soma às duas —
      // ver Patio.jsx), então "quanto veio de serviço" é o valor inteiro dos
      // movimentos com pelo menos um serviço marcado, não uma fração.
      const { data: ms } = await supabase.from('movimento_servicos')
        .select('movimento_id, servico_id, valor, servicos(codigo, descricao, tabela_tipo)').in('movimento_id', ids);
      servicosDoMovimento = ms || [];
      movsComServico = new Set(servicosDoMovimento.map((r) => r.movimento_id));
    }
    // Valor FIXO de cada tabela usada como serviço (valor_servico/VALORSERV,
    // ver Preços) — o que o serviço realmente vale, separado da estadia
    // (faixas). Serviço "Pede valor" (movimento_servicos.valor preenchido)
    // já tem seu próprio valor exato, não precisa disso.
    const { data: tabelasPreco } = await supabase.from('tabelas_preco').select('tipo, valor_servico');
    const valorServicoPorTipo = Object.fromEntries((tabelasPreco || []).map((t) => [t.tipo, Number(t.valor_servico || 0)]));
    const porMovimento = {};
    for (const r of servicosDoMovimento) (porMovimento[r.movimento_id] ||= []).push(r);
    // Quanto de serviço (fixo) teve em cada movimento — o resto do valor
    // cobrado é a estadia (faixas), ver totais logo abaixo e packages/tarifacao.
    function valorServicoDoMovimento(itens) {
      return itens.reduce((s, i) => s + (i.valor != null ? Number(i.valor) : (valorServicoPorTipo[i.servicos?.tabela_tipo] || 0)), 0);
    }
    const { data: formas } = await supabase.from('formas_pagamento').select('codigo,descricao');
    const descForma = Object.fromEntries((formas || []).map((f) => [f.codigo, f.descricao]));
    // Tabela EFETIVA de cada saída pra mostrar na lista de veículos — nem
    // sempre é a do cadastro do carro (tipo_veic): convênio com tabela
    // alternativa (tab_conv) ou serviço marcado (cada um com sua própria
    // tabela) trocam o que o motor usa de verdade pra calcular (ver
    // calcularTarifa em packages/tarifacao — tipoEfetivo = tabConv || tipoVeic,
    // e servicosTipos substitui isso inteiro quando tem serviço).
    const { data: convenios } = await supabase.from('convenios').select('codigo, tab_conv');
    const tabConvPorCodigo = Object.fromEntries((convenios || []).map((c) => [c.codigo, c.tab_conv]));
    const tabelasServicoPorMov = {};
    for (const r of servicosDoMovimento) {
      const t = r.servicos?.tabela_tipo;
      if (!t) continue;
      const lista = (tabelasServicoPorMov[r.movimento_id] ||= []);
      if (!lista.includes(t)) lista.push(t);
    }
    function tabelaEfetiva(m) {
      if (tabelasServicoPorMov[m.id]) return tabelasServicoPorMov[m.id].join(' + ');
      if (m.convenio_codigo && tabConvPorCodigo[m.convenio_codigo]) return tabConvPorCodigo[m.convenio_codigo];
      return m.tipo_veic;
    }

    // Recebimentos de mensalidade no período (evento gravado no cadastro do mensalista).
    const { data: mensPagtos, error: errMens } = await supabase.from('mensalista_pagamentos')
      .select('*, mensalistas(razao)')
      .gte('dt_pagamento', de).lte('dt_pagamento', ate)
      .order('dt_pagamento', { ascending: false });
    if (errMens) { setErro(errMens.message); return; }

    // Vendas de produto (balcão) no período — nunca passa por movimentos/
    // notas_fiscais (ver 0042_produtos.sql), soma à parte igual mensalidade.
    const { data: vendasProdutos, error: errProd } = await supabase.from('vendas_produtos')
      .select('*, produtos(codigo, descricao, quantidade_estoque)')
      .gte('criado_em', inicio).lt('criado_em', fim)
      .order('criado_em', { ascending: false });
    if (errProd) { setErro(errProd.message); return; }

    // Nome de quem processou cada saída/mensalidade/venda (ver "Por
    // operador" abaixo) — um select só, reaproveitado nos três.
    const { data: perfis } = await supabase.from('perfis').select('id, nome');
    const nomeDoOperador = Object.fromEntries((perfis || []).map((p) => [p.id, p.nome]));
    const SEM_OPERADOR = '—';

    // "Por operador" (qtd + faturado) e "Resumo por dia" (data, faturado,
    // desconto, bônus, recebido) — cada evento que já entra no Faturado geral
    // (saída, mensalidade, produto) soma aqui também, só quebrado por quem
    // processou e por dia, em vez do período inteiro de uma vez.
    const porOperador = {};
    const porDia = {};
    function somaOperador(id, faturado) {
      const nome = nomeDoOperador[id] || SEM_OPERADOR;
      const e = (porOperador[nome] ||= { qtd: 0, faturado: 0 });
      e.qtd++; e.faturado += faturado;
    }
    function somaDia(dia, { faturado = 0, desconto = 0, bonus = 0 }) {
      if (!dia) return;
      const e = (porDia[dia] ||= { faturado: 0, desconto: 0, bonus: 0 });
      e.faturado += faturado; e.desconto += desconto; e.bonus += bonus;
    }

    const porTipo = {};
    let recebidoSaidas = 0, tabelaCheia = 0, valorServicos = 0, valorAvulso = 0, valorConvenioTotal = 0,
      antecipadoTotal = 0, bonusTotal = 0, minutosTotal = 0, saidasComTempo = 0;
    for (const m of movs) {
      porTipo[m.tipo_mens] = (porTipo[m.tipo_mens] || 0) + 1;
      recebidoSaidas += Number(m.valor || 0);
      tabelaCheia += Number(m.valor_proporcional || 0);
      valorConvenioTotal += Number(m.valor_convenio || 0);
      // Antecipado e bônus fidelidade também abatem do valor cobrado (ver
      // comAntecipado/comBonus em Patio.jsx) sem mexer em valor_proporcional
      // — precisam entrar na soma do Faturado igual o desconto de convênio,
      // senão o total fica maior que a soma das colunas visíveis (Avulso +
      // Serviço + Convênio + Mensalidade + Produtos), sem dar pra
      // conferir a conta batendo.
      antecipadoTotal += Number(m.valor_antecipado || 0);
      bonusTotal += Number(m.bonus_fidelidade || 0);
      // Mesma parcela desta saída na conta do Faturado geral, só que quebrada
      // por quem processou e por dia (ver "Por operador"/"Resumo por dia").
      const faturadoDaSaida = Number(m.valor || 0) + Number(m.valor_convenio || 0)
        + Number(m.valor_antecipado || 0) + Number(m.bonus_fidelidade || 0);
      somaOperador(m.usuario_saida, faturadoDaSaida);
      somaDia(m.dt_saida, { faturado: faturadoDaSaida, desconto: Number(m.valor_convenio || 0), bonus: Number(m.bonus_fidelidade || 0) });
      // Serviço marcado: "valor do serviço" é só a soma dos valores FIXOS
      // dos serviços (valor_servico/pede-valor) — o resto do valor cobrado é
      // a estadia (faixas), que entra no Avulso igual qualquer outro carro
      // (ver packages/tarifacao: valorProporcional = somaFixos + estadia).
      if (movsComServico.has(m.id)) {
        const totalServico = valorServicoDoMovimento(porMovimento[m.id] || []);
        valorServicos += totalServico;
        valorAvulso += Math.max(0, Number(m.valor || 0) - totalServico);
      }
      // Avulso: o carro que passa pela balança normal (com convênio ou sem —
      // convênio é só um desconto em cima do avulso, não outra categoria).
      // Fora daqui: mensalista/pacote/hóspede (0 nesta fase).
      else if (!MENSALISTA.has(m.tipo_mens)) valorAvulso += Number(m.valor || 0);
      if (m.hr_saida != null && m.hr_entrada != null) {
        const decorrido = horas({
          dtEntrada: dataDeISO(m.dt_entrada), entrada: Number(m.hr_entrada),
          dtSaida: dataDeISO(m.dt_saida), saida: Number(m.hr_saida),
        });
        minutosTotal += minuto(decorrido);
        saidasComTempo++;
      }
    }
    const porForma = {};
    const pagtosPorMov = {};
    for (const p of pagtos) {
      const k = descForma[p.forma_pagamento] || p.forma_pagamento;
      porForma[k] = (porForma[k] || 0) + Number(p.valor || 0);
      (pagtosPorMov[p.movimento_id] ||= []).push(k);
    }
    const porTipoCancelado = {};
    for (const m of cancelados || []) {
      porTipoCancelado[m.tipo_mens] = (porTipoCancelado[m.tipo_mens] || 0) + 1;
    }
    const mensalidades = (mensPagtos || []).map((p) => ({
      id: p.id, dt_pagamento: p.dt_pagamento, proximo_pagamento: p.proximo_pagamento,
      mensalista: p.mensalistas?.razao || '—', valor: Number(p.valor_pago || 0),
      forma: descForma[p.forma_pagamento] || p.forma_pagamento,
    }));
    const mensalidadesTotal = mensalidades.reduce((s, p) => s + p.valor, 0);
    for (const p of mensPagtos || []) {
      somaOperador(p.recebido_por, Number(p.valor_pago || 0));
      somaDia(p.dt_pagamento, { faturado: Number(p.valor_pago || 0) });
    }

    const produtosVendidos = (vendasProdutos || []).map((v) => ({
      id: v.id, criado_em: v.criado_em,
      produto: v.produtos ? `${v.produtos.codigo} — ${v.produtos.descricao}` : '—',
      quantidade: Number(v.quantidade || 0), valor: Number(v.valor_total || 0),
      forma: descForma[v.forma_pagamento] || v.forma_pagamento,
      // Estoque ATUAL do produto (não o de quando a venda foi feita) — é o
      // saldo pra decidir se precisa repor, não um retrato histórico.
      estoque: v.produtos ? Number(v.produtos.quantidade_estoque || 0) : null,
    }));
    const produtosTotal = produtosVendidos.reduce((s, v) => s + v.valor, 0);
    for (const v of vendasProdutos || []) {
      somaOperador(v.operador_id, Number(v.valor_total || 0));
      somaDia((v.criado_em || '').slice(0, 10), { faturado: Number(v.valor_total || 0) });
    }

    // Resumo por dia, em lista ordenada — pedido pra período longo (ex.: um
    // mês inteiro): recebido = faturado menos o que não veio em dinheiro
    // agora (convênio, cobrado do convênio depois — e bônus, que não é
    // dinheiro nenhum), mesma conta que "Faturado" já faz pro período inteiro.
    const resumoDiario = Object.entries(porDia)
      .map(([dia, v]) => ({ dia, ...v, recebido: v.faturado - v.desconto - v.bonus }))
      .sort((a, b) => a.dia.localeCompare(b.dia));

    // Recebido por forma de pagamento, somando saídas (avulso+convênio+
    // serviço, via movimento_pagamentos), mensalidades e vendas de produto
    // juntos — é o mesmo "soma tudo" do KPI Faturado, só que quebrado por forma.
    const recebidoPorForma = { ...porForma };
    for (const p of mensalidades) recebidoPorForma[p.forma] = (recebidoPorForma[p.forma] || 0) + p.valor;
    for (const v of produtosVendidos) recebidoPorForma[v.forma] = (recebidoPorForma[v.forma] || 0) + v.valor;

    // "Convênio" é o quanto o convênio tirou do valor cheio da
    // tabela — usa a coluna valor_convenio (gravada pelo motor na saída,
    // ver Patio.jsx/confirmarSaida), não "valor_proporcional - valor": essa
    // diferença também inclui antecipado e bônus fidelidade (que não são
    // desconto de convênio nenhum — ver comAntecipado/comBonus em
    // Patio.jsx), senão um carro sem convênio nenhum mas com antecipado
    // aparecia com "desconto de convênio" — foi exatamente o bug relatado.
    const descontos = valorConvenioTotal;

    // Por tipo de lavagem/serviço: quantidade de vezes usado + valor total.
    // Serviço "Pede valor" (valor informado ao marcar) usa esse valor exato;
    // o cobrado pela tabela usa o valor_servico fixo dela (ver
    // valorServicoDoMovimento acima) — nunca mais uma fatia igual pra todos.
    const porServico = {};
    for (const itens of Object.values(porMovimento)) {
      for (const i of itens) {
        const chave = i.servicos?.descricao || i.servico_id;
        const e = (porServico[chave] ||= { quantidade: 0, valor: 0 });
        e.quantidade++;
        e.valor += i.valor != null ? Number(i.valor) : (valorServicoPorTipo[i.servicos?.tabela_tipo] || 0);
      }
    }

    setDados({
      totalVeic: movs.length, valorAvulso,
      // Soma explícita de tudo que abate do valor cheio (convênio,
      // antecipado, bônus) de volta — cada parcela é um KPI visível na
      // tela, então o Faturado sempre bate com a soma das colunas que dá
      // pra conferir a olho (era esse o problema antes: antecipado/bônus
      // entravam na conta sem aparecer em lugar nenhum).
      faturado: valorAvulso + valorServicos + valorConvenioTotal + antecipadoTotal + bonusTotal + mensalidadesTotal + produtosTotal,
      recebidoSaidas, descontos, valorServicos, antecipados: antecipadoTotal, bonus: bonusTotal,
      porTipo, porTipoCancelado, recebidoPorForma, porServico,
      tempoMedio: saidasComTempo ? minutosParaHHMM(Math.round(minutosTotal / saidasComTempo)) : 0,
      mensalidades, mensalidadesTotal,
      produtosVendidos, produtosTotal,
      porOperador, resumoDiario,
    });

    const detalheNormal = movs.map((m) => ({
      id: m.id, placa: m.placa, modelo: m.modelo, tipo_veic: tabelaEfetiva(m),
      dt_entrada: m.dt_entrada, hr_entrada: m.hr_entrada, dt_saida: m.dt_saida, hr_saida: m.hr_saida,
      valor: Number(m.valor || 0),
      // Desconto de convênio desta saída — vem direto de valor_convenio
      // (gravado pelo motor na saída), não de "proporcional - valor": essa
      // diferença também pega antecipado/bônus fidelidade, que não são
      // desconto de convênio nenhum.
      descontoConvenio: Number(m.valor_convenio || 0),
      // Null quando o valor cobrado é o que o motor calculou; preenchido com o
      // valor original quando o operador alterou na saída (vira "*" na lista).
      valorCalculado: m.valor_calculado != null ? Number(m.valor_calculado) : null,
      tempo: (m.hr_saida != null && m.hr_entrada != null) ? horas({
        dtEntrada: dataDeISO(m.dt_entrada), entrada: Number(m.hr_entrada),
        dtSaida: dataDeISO(m.dt_saida), saida: Number(m.hr_saida),
      }) : null,
      pagamento: pagtosPorMov[m.id]?.join(' + ') || (MENSALISTA.has(m.tipo_mens) ? 'Mensalista/hóspede' : '—'),
      // Valor do serviço (mesmo valor cobrado — serviço substitui a tabela
      // do veículo inteira, nunca soma às duas, ver Patio.jsx) — null pros
      // avulsos normais, só pra distinguir um do outro na lista.
      servico: movsComServico.has(m.id) ? Number(m.valor || 0) : null,
      cancelado: false,
      _quando: dataHoraDe(m.dt_saida, Number(m.hr_saida)).getTime(),
    }));
    const detalheCancelados = (cancelados || []).map((m) => ({
      id: m.id, placa: m.placa, modelo: m.modelo, tipo_veic: m.tipo_veic,
      dt_entrada: m.dt_entrada, hr_entrada: m.hr_entrada, dt_saida: null, hr_saida: null,
      valor: 0, tempo: null, pagamento: 'Cancelado', servico: null,
      cancelado: true,
      _quando: new Date(m.excluido_em).getTime(),
    }));
    const detalhe = [...detalheNormal, ...detalheCancelados].sort((a, b) => b._quando - a._quando);
    setVeiculos(detalhe);
  }, [de, ate]);

  useEffect(() => { carregar(); const t = setInterval(carregar, 30000); return () => clearInterval(t); }, [carregar]);

  return (
    <>
      <div className="card">
        <h2>Painel / BI</h2>
        <div className="linha-form" style={{ marginBottom: 10 }}>
          <div className="campo"><label>De</label><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
          <div className="campo"><label>Até</label><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
          <label className="campo-check"><input type="checkbox" checked={verVeiculos} onChange={(e) => setVerVeiculos(e.target.checked)} /> Ver veículos</label>
          <button className="btn-ghost" onClick={carregar}>Atualizar</button>
          <button className="btn-ghost" disabled={!dados}
            onClick={() => window.open(linkWhatsAppRelatorio(textoRelatorio(dados, de, ate, filial)), '_blank')}>
            WhatsApp
          </button>
          <button className="btn-ghost" disabled={!dados}
            onClick={() => { window.location.href = linkEmailRelatorio(textoRelatorio(dados, de, ate, filial), de, ate); }}>
            Email
          </button>
          <button className="btn-primary" disabled={!dados}
            onClick={() => imprimirRelatorio(dados, de, ate, filial, verVeiculos ? veiculos : null)}>
            Imprimir
          </button>
        </div>
        <p className="suave">Indicadores em tempo real (atualiza a cada 30s).</p>
        {erro && <div className="aviso">{erro}</div>}
      </div>

      {dados && (
        <>
          <div className="kpis">
            <Kpi rotulo="Saídas" valor={dados.totalVeic} />
            <Kpi rotulo="Avulso" valor={fmtBRL(dados.valorAvulso)} moeda />
            <Kpi rotulo="Serviços" valor={fmtBRL(dados.valorServicos)} moeda />
            <Kpi rotulo="Convênio" valor={fmtBRL(dados.descontos)} moeda />
            <Kpi rotulo="Antecipados" valor={fmtBRL(dados.antecipados)} moeda />
            <Kpi rotulo="Bônus fidelidade" valor={fmtBRL(dados.bonus)} moeda />
            <Kpi rotulo="Tempo médio" valor={fmtHora(dados.tempoMedio)} />
            <Kpi rotulo="Mensalidades" valor={fmtBRL(dados.mensalidadesTotal)} moeda />
            <Kpi rotulo="Venda de produtos" valor={fmtBRL(dados.produtosTotal)} moeda />
            <Kpi rotulo="Faturado" valor={fmtBRL(dados.faturado)} destaque moeda />
          </div>
          <p className="suave" style={{ marginTop: -4 }}>
            Faturado = Avulso + Serviços + Convênio + Antecipados + Bônus fidelidade +
            Mensalidades + Venda de produtos — o valor cheio, antes de qualquer desconto/abatimento.
          </p>

          {dados.resumoDiario.length > 1 && (
            <div className="card">
              <h2>Resumo por dia ({dados.resumoDiario.length})</h2>
              <p className="suave">
                Recebido = Faturado − Descontos (convênio) − Bônus fidelidade — o que realmente
                entrou em dinheiro/forma de pagamento naquele dia (convênio é cobrado dele depois).
              </p>
              <GraficoLinha
                pontos={dados.resumoDiario.map((d) => ({ rotulo: fmtDataBR(d.dia), valor: d.faturado }))}
                formatarValor={fmtBRL}
              />
              <div className="tabela-scroll">
                <table>
                  <thead><tr><th>Data</th><th style={{ textAlign: 'right' }}>Faturado</th><th style={{ textAlign: 'right' }}>Desconto</th><th style={{ textAlign: 'right' }}>Bônus</th><th style={{ textAlign: 'right' }}>Recebido</th></tr></thead>
                  <tbody>
                    {dados.resumoDiario.map((d) => (
                      <tr key={d.dia}>
                        <td className="mono">{fmtDataBR(d.dia)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtBRL(d.faturado)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtBRL(d.desconto)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtBRL(d.bonus)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtBRL(d.recebido)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td><strong>Total</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmtBRL(dados.resumoDiario.reduce((s, d) => s + d.faturado, 0))}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmtBRL(dados.resumoDiario.reduce((s, d) => s + d.desconto, 0))}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmtBRL(dados.resumoDiario.reduce((s, d) => s + d.bonus, 0))}</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmtBRL(dados.resumoDiario.reduce((s, d) => s + d.recebido, 0))}</strong></td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <h2>Por operador ({Object.keys(dados.porOperador).length})</h2>
            <p className="suave">Saídas + mensalidades recebidas + vendas de produto, por quem processou cada uma.</p>
            <GraficoBarras
              itens={Object.entries(dados.porOperador)
                .sort(([, a], [, b]) => b.faturado - a.faturado)
                .map(([nome, v]) => ({ rotulo: nome, valor: v.faturado }))}
              formatarValor={fmtBRL}
            />
            <table>
              <thead><tr><th>Operador</th><th style={{ textAlign: 'right' }}>Qtde</th><th style={{ textAlign: 'right' }}>Faturado</th></tr></thead>
              <tbody>
                {Object.entries(dados.porOperador)
                  .sort(([, a], [, b]) => b.faturado - a.faturado)
                  .map(([nome, v]) => (
                    <tr key={nome}><td>{nome}</td><td style={{ textAlign: 'right' }}>{v.qtd}</td><td style={{ textAlign: 'right' }}>{fmtBRL(v.faturado)}</td></tr>
                  ))}
                {Object.keys(dados.porOperador).length === 0 && <tr><td colSpan={3} className="suave">Sem movimentação no período.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Por tipo</h2>
            <table><tbody>
              {Object.entries(dados.porTipo).map(([k, v]) => (
                <tr key={k}><td>{rotuloTipo(k)}</td><td style={{ textAlign: 'right' }}>{v}</td></tr>
              ))}
            </tbody></table>
          </div>

          <div className="card">
            <h2>Cancelados por tipo</h2>
            <table><tbody>
              {Object.entries(dados.porTipoCancelado).map(([k, v]) => (
                <tr key={k}><td>{rotuloTipo(k)}</td><td style={{ textAlign: 'right' }}>{v}</td></tr>
              ))}
              {Object.keys(dados.porTipoCancelado).length === 0 && <tr><td className="suave">Nenhum cancelamento no período.</td></tr>}
            </tbody></table>
          </div>

          <div className="card">
            <h2>Por tipo de lavagem</h2>
            <p className="suave">
              Quando mais de um serviço sem valor fixo é marcado no mesmo veículo, o valor é
              dividido em partes iguais entre eles (não dá pra saber a parte exata de cada um).
            </p>
            <table>
              <thead><tr><th>Serviço</th><th style={{ textAlign: 'right' }}>Quantidade</th><th style={{ textAlign: 'right' }}>Valor total</th></tr></thead>
              <tbody>
                {Object.entries(dados.porServico)
                  .sort(([, a], [, b]) => b.valor - a.valor)
                  .map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td style={{ textAlign: 'right' }}>{v.quantidade}</td><td style={{ textAlign: 'right' }}>{fmtBRL(v.valor)}</td></tr>
                  ))}
                {Object.keys(dados.porServico).length === 0 && <tr><td colSpan={3} className="suave">Nenhum serviço no período.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Recebido por forma de pagamento</h2>
            <p className="suave">Saídas (avulso, convênio, serviços) + mensalidades, somados por forma.</p>
            <GraficoBarras
              itens={Object.entries(dados.recebidoPorForma)
                .sort(([, a], [, b]) => b - a)
                .map(([forma, valor]) => ({ rotulo: forma, valor }))}
              formatarValor={fmtBRL}
            />
            <table><tbody>
              {Object.entries(dados.recebidoPorForma).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td style={{ textAlign: 'right' }}>{fmtBRL(v)}</td></tr>
              ))}
              {Object.keys(dados.recebidoPorForma).length === 0 && <tr><td className="suave">Sem pagamentos no período.</td></tr>}
            </tbody></table>
          </div>

          <div className="card">
            <h2>Mensalidades recebidas ({dados.mensalidades.length})</h2>
            <p className="suave">Recebimentos lançados no cadastro do mensalista (botão Receber).</p>
            <div className="tabela-scroll">
              <table>
                <thead><tr><th>Pagamento</th><th>Mensalista</th><th>Forma</th><th>Próximo pagamento</th><th>Valor</th></tr></thead>
                <tbody>
                  {dados.mensalidades.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{fmtDataBR(p.dt_pagamento)}</td>
                      <td>{p.mensalista}</td>
                      <td>{p.forma}</td>
                      <td className="mono">{fmtDataBR(p.proximo_pagamento)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(p.valor)}</td>
                    </tr>
                  ))}
                  {dados.mensalidades.length === 0 && <tr><td colSpan={5} className="suave">Nenhuma mensalidade recebida no período.</td></tr>}
                </tbody>
                {dados.mensalidades.length > 0 && (
                  <tfoot><tr>
                    <td colSpan={4}><strong>Total</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmtBRL(dados.mensalidadesTotal)}</strong></td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Vendas de produtos ({dados.produtosVendidos.length})</h2>
            <p className="suave">Venda avulsa de balcão (ver Pátio → ⋮ → Venda Produtos) — nunca gera RPS/NFS-e.</p>
            <div className="tabela-scroll">
              <table>
                <thead><tr><th>Data</th><th>Produto</th><th>Qtde</th><th>Forma</th><th>Valor</th><th>Estoque atual</th></tr></thead>
                <tbody>
                  {dados.produtosVendidos.map((v) => (
                    <tr key={v.id}>
                      <td className="mono">{new Date(v.criado_em).toLocaleString('pt-BR')}</td>
                      <td>{v.produto}</td>
                      <td style={{ textAlign: 'right' }}>{v.quantidade}</td>
                      <td>{v.forma}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(v.valor)}</td>
                      <td style={{ textAlign: 'right' }}>{v.estoque ?? '—'}</td>
                    </tr>
                  ))}
                  {dados.produtosVendidos.length === 0 && <tr><td colSpan={6} className="suave">Nenhuma venda de produto no período.</td></tr>}
                </tbody>
                {dados.produtosVendidos.length > 0 && (
                  <tfoot><tr>
                    <td colSpan={4}><strong>Total</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>{fmtBRL(dados.produtosTotal)}</strong></td>
                    <td></td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </div>

          {verVeiculos && (
            <div className="card">
              <h2>Veículos ({veiculos.length})</h2>
              <div className="tabela-scroll">
                <table>
                  <thead><tr>
                    <th>Placa</th><th>Carro</th><th>Tabela</th><th>Entrada</th><th>Saída</th>
                    <th>Tempo</th><th>Pagamento</th><th>Valor</th><th>Convênio</th><th>Serviço</th>
                  </tr></thead>
                  <tbody>
                    {veiculos.map((v) => (
                      <tr key={v.id}>
                        <td><span className="placa mono">{v.placa}</span></td>
                        <td>{v.modelo || '—'}</td>
                        <td className="mono">{v.tipo_veic}</td>
                        <td className="mono">{v.dt_entrada.split('-').reverse().join('/')} {fmtHora(Number(v.hr_entrada))}</td>
                        <td className="mono">{v.cancelado ? '—' : `${v.dt_saida.split('-').reverse().join('/')} ${fmtHora(Number(v.hr_saida))}`}</td>
                        <td className="mono">{v.tempo != null ? fmtHora(v.tempo) : '—'}</td>
                        {/* Pagamento é onde as anomalias (cancelamento, por ora) aparecem —
                            fundo destacado pra chamar atenção, em vez de uma coluna à parte
                            só pra isso (ver conversa: Status virou Serviço). */}
                        <td className={v.cancelado ? 'cel-anomalia' : undefined}>
                          {v.cancelado ? <span className="status status-cancelada">Cancelado</span> : v.pagamento}
                        </td>
                        <td>
                          {v.cancelado ? '—' : (
                            <>
                              {fmtBRL(v.valor)}
                              {v.valorCalculado != null && (
                                <span title={`Valor alterado na saída — o cálculo dava ${fmtBRL(v.valorCalculado)}`}> *</span>
                              )}
                            </>
                          )}
                        </td>
                        <td>{v.cancelado || !v.descontoConvenio ? '—' : fmtBRL(v.descontoConvenio)}</td>
                        <td>{v.servico != null ? fmtBRL(v.servico) : '—'}</td>
                      </tr>
                    ))}
                    {veiculos.length === 0 && <tr><td colSpan={10} className="suave">Nenhum veículo no período.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * `moeda`: tira o "R$" do valor (fica só o número) e mostra "(R$)" junto do
 * rótulo — com valor grande, "R$ 9.994,00" não cabia na largura do cartão;
 * o número sozinho cabe bem mais.
 */
function Kpi({ rotulo, valor, destaque, moeda }) {
  const texto = moeda ? String(valor).replace('R$', '').trim() : valor;
  return (
    <div className={'kpi' + (destaque ? ' destaque' : '')}>
      <div className="kpi-rotulo">{rotulo}{moeda ? ' (R$)' : ''}</div>
      <div className="kpi-valor">{texto}</div>
    </div>
  );
}
function rotuloTipo(t) {
  return { E: 'Avulso', I: 'Mensalista', P: 'Pacote', H: 'Hóspede', C: 'Convênio' }[t] || t || '—';
}
