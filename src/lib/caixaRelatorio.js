import { supabase } from './supabase.js';
import { fmtBRL, dataHoraDe } from './tempo.js';

const MENSALISTA = new Set(['I', 'P', 'H']);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Carrega todos os dados de UM caixa (turno) — usado tanto pro relatório na
 * hora do fechamento quanto pra reimprimir um caixa já fechado há tempo (ver
 * histórico em Caixa.jsx). Cada consulta usa o `caixa_id` gravado na hora
 * certa (saída, antecipado, mensalidade, venda de produto, sangria — mesmo
 * esquema que Caixa.jsx já usa pro resumo ao vivo), então funciona igual pra
 * um turno de anos atrás.
 */
export async function carregarRelatorioCaixa(caixa) {
  const inicio = caixa.aberto_em;
  const fim = caixa.fechado_em || new Date().toISOString();

  const [
    { data: movs }, { data: sangrias }, { data: formas }, { data: mensPagtos },
    { data: antecipadosEntrada }, { data: antecipadosReserva }, { data: vendasProdutos },
    { data: operadorRow }, { data: convenios }, { data: tabelasPreco },
  ] = await Promise.all([
    supabase.from('movimentos').select('*').eq('caixa_id', caixa.id).not('dt_saida', 'is', null),
    supabase.from('sangrias').select('*').eq('caixa_id', caixa.id).order('created_at'),
    supabase.from('formas_pagamento').select('codigo,descricao,eh_dinheiro'),
    supabase.from('mensalista_pagamentos').select('*, mensalistas(razao)').eq('caixa_id', caixa.id).order('dt_pagamento'),
    supabase.from('movimento_pagamentos').select('*, movimentos(placa)').eq('caixa_id', caixa.id),
    supabase.from('reservas').select('id, valor_antecipado, forma_antecipado, placa, nome, created_at').eq('caixa_id_antecipado', caixa.id),
    supabase.from('vendas_produtos').select('*, produtos(codigo,descricao)').eq('caixa_id', caixa.id).order('criado_em'),
    supabase.from('perfis').select('nome').eq('id', caixa.operador_id).maybeSingle(),
    supabase.from('convenios').select('codigo, razao'),
    supabase.from('tabelas_preco').select('tipo, descricao').order('vigencia_inicio', { ascending: false }),
  ]);

  const ids = (movs || []).map((m) => m.id);
  // Só pagamento de saída (caixa_id null) — o de antecipado já tem o próprio
  // caixa_id e entra à parte (`antecipadosEntrada` acima), senão contaria o
  // mesmo dinheiro duas vezes quando entrada e saída caem no mesmo turno.
  const { data: pagtosSaida } = ids.length
    ? await supabase.from('movimento_pagamentos').select('*').in('movimento_id', ids).is('caixa_id', null)
    : { data: [] };

  // Veículos ainda no pátio que ENTRARAM durante o turno — busca candidatos
  // pelo dia (dt_entrada) e refina pela hora exata (dt_entrada+hr_entrada
  // combinados num Date real), já que movimentos guarda isso em dois campos
  // separados, sem um timestamp único pra comparar direto com aberto_em/fechado_em.
  const diaIni = inicio.slice(0, 10);
  const diaFim = fim.slice(0, 10);
  const { data: candidatosAbertos } = await supabase.from('movimentos').select('dt_entrada, hr_entrada')
    .is('dt_saida', null).is('excluido_em', null)
    .gte('dt_entrada', diaIni).lte('dt_entrada', diaFim);
  const inicioDt = new Date(inicio);
  const fimDt = new Date(fim);
  const qtdSemSaida = (candidatosAbertos || []).filter((m) => {
    const dt = dataHoraDe(m.dt_entrada, Number(m.hr_entrada));
    return dt >= inicioDt && dt <= fimDt;
  }).length;

  // Veículos cancelados no turno — exclusão já tem timestamp próprio (excluido_em).
  const { count: qtdCancelados } = await supabase.from('movimentos')
    .select('id', { count: 'exact', head: true })
    .gte('excluido_em', inicio).lte('excluido_em', fim);

  const dinheiroCods = new Set((formas || []).filter((f) => f.eh_dinheiro).map((f) => f.codigo));
  const descForma = Object.fromEntries((formas || []).map((f) => [f.codigo, f.descricao]));
  const descConvenio = Object.fromEntries((convenios || []).map((c) => [c.codigo, c.razao]));
  const descTabela = {};
  for (const t of tabelasPreco || []) if (!descTabela[t.tipo]) descTabela[t.tipo] = t.descricao;

  let recebidoSaidas = 0, valorProporcionalTotal = 0, valorConvenioTotal = 0;
  const porTipo = { avulso: 0, mensalista: 0 };
  const porConvenio = {};
  const porTabela = {};
  for (const m of movs || []) {
    // Dívida de uma estadia anterior cobrada nesta saída (valor_dev — ver
    // dividaAnterior em Patio.jsx/tarifacao.ts) já virou "recebido"/Faturado
    // quando foi GERADA, na saída anterior — sem subtrair aqui, a mesma
    // estadia conta duas vezes (uma como dívida, outra como parte do valor
    // desta saída), inflando o Faturado do turno.
    const dividaAnterior = Number(m.valor_dev || 0);
    recebidoSaidas += Number(m.valor || 0) - dividaAnterior;
    valorProporcionalTotal += Number(m.valor_proporcional || 0);
    valorConvenioTotal += Number(m.valor_convenio || 0);
    if (MENSALISTA.has(m.tipo_mens)) porTipo.mensalista++; else porTipo.avulso++;
    if (m.convenio_codigo) {
      const e = (porConvenio[m.convenio_codigo] ||= { qtd: 0, desconto: 0 });
      e.qtd++;
      // Vem de valor_convenio (gravado pelo motor na saída), não de
      // "proporcional - valor": essa diferença também pega antecipado/bônus
      // fidelidade, que não são desconto de convênio nenhum (mesmo bug
      // corrigido no BI.jsx, ver o comentário lá).
      e.desconto += Number(m.valor_convenio || 0);
    }
    const et = (porTabela[m.tipo_veic] ||= { qtd: 0, valor: 0 });
    et.qtd++;
    et.valor += Number(m.valor || 0) - dividaAnterior;
  }
  const descontos = valorConvenioTotal;
  // "Valor faturado" é o valor CHEIO gerado pelas saídas (o que o cliente
  // pagou + o que o convênio vai pagar depois) — recebidoSaidas por si só é
  // só a parte cobrada do cliente na hora (mesmo raciocínio do "Faturado" do
  // BI.jsx: sem somar valor_convenio de volta, o convênio desaparecia da
  // conta, como se aquela estadia não tivesse gerado receita nenhuma).
  const valorFaturado = recebidoSaidas + valorConvenioTotal;

  const mensalidades = (mensPagtos || []).map((p) => ({
    id: p.id, nome: p.mensalistas?.razao || '—', valor: Number(p.valor_pago || 0), forma: p.forma_pagamento,
  }));
  const mensalidadesTotal = mensalidades.reduce((s, p) => s + p.valor, 0);

  const produtos = (vendasProdutos || []).map((v) => ({
    id: v.id, nome: v.produtos ? `${v.produtos.codigo} — ${v.produtos.descricao}` : '—',
    quantidade: Number(v.quantidade || 0), valor: Number(v.valor_total || 0), forma: v.forma_pagamento,
  }));
  const produtosTotal = produtos.reduce((s, p) => s + p.valor, 0);

  const reservasAntecip = (antecipadosReserva || []).filter((r) => Number(r.valor_antecipado) > 0);
  const antecipados = [
    ...(antecipadosEntrada || []).map((p) => ({ id: p.id, ref: 'Entrada de veículo', valor: Number(p.valor || 0), forma: p.forma_pagamento })),
    ...reservasAntecip.map((r, i) => ({
      id: `reserva-${i}`, ref: `Reserva${r.placa ? ` ${r.placa}` : ''}${r.nome ? ` — ${r.nome}` : ''}`,
      valor: Number(r.valor_antecipado), forma: r.forma_antecipado,
    })),
  ];
  const antecipadosTotal = antecipados.reduce((s, a) => s + a.valor, 0);

  // Recebido por forma de pagamento — soma saída + mensalidade + antecipado + produto.
  const porForma = {};
  const somaForma = (forma, valor) => { porForma[forma] = (porForma[forma] || 0) + valor; };
  for (const p of pagtosSaida || []) somaForma(p.forma_pagamento, Number(p.valor || 0));
  for (const m of mensalidades) somaForma(m.forma, m.valor);
  for (const a of antecipados) somaForma(a.forma, a.valor);
  for (const p of produtos) somaForma(p.forma, p.valor);

  const dinheiro = (pagtosSaida || []).filter((p) => dinheiroCods.has(p.forma_pagamento)).reduce((s, p) => s + Number(p.valor || 0), 0)
    + mensalidades.filter((m) => dinheiroCods.has(m.forma)).reduce((s, m) => s + m.valor, 0)
    + antecipados.filter((a) => dinheiroCods.has(a.forma)).reduce((s, a) => s + a.valor, 0)
    + produtos.filter((p) => dinheiroCods.has(p.forma)).reduce((s, p) => s + p.valor, 0);

  const sangriasLista = (sangrias || []).map((s) => ({ id: s.id, valor: Number(s.valor || 0), motivo: s.motivo || '' }));
  const sangriasTotal = sangriasLista.reduce((s, x) => s + x.valor, 0);

  const totalRecebido = recebidoSaidas + mensalidadesTotal + antecipadosTotal + produtosTotal;
  const esperadoCaixa = Number(caixa.valor_abertura || 0) + dinheiro - sangriasTotal;
  const diferenca = caixa.valor_fechamento != null ? Number(caixa.valor_fechamento) - esperadoCaixa : null;

  // Extrato item a item (opcional no relatório — ver "Incluir lista de
  // movimentações" em RelatorioCaixaModal/imprimirRelatorioCaixa) — mesmo
  // formato do extrato ao vivo do caixa aberto (Caixa.jsx), mais recente
  // primeiro. Saída junta as formas com " + " quando veio dividida (split).
  const formasPorMovimento = {};
  for (const p of pagtosSaida || []) (formasPorMovimento[p.movimento_id] ||= []).push(descForma[p.forma_pagamento] || p.forma_pagamento);
  const itens = [
    ...(movs || []).map((m) => ({
      id: `saida-${m.id}`, quando: dataHoraDe(m.dt_saida, Number(m.hr_saida)), tipo: 'Saída',
      descricao: `${m.placa}${m.modelo ? ` — ${m.modelo}` : ''}`,
      forma: (formasPorMovimento[m.id] || []).join(' + ') || null, valor: Number(m.valor || 0),
    })),
    ...(mensPagtos || []).map((p) => ({
      id: `mens-${p.id}`, quando: new Date(p.created_at), tipo: 'Mensalidade',
      descricao: p.mensalistas?.razao || '—', forma: descForma[p.forma_pagamento] || p.forma_pagamento,
      valor: Number(p.valor_pago || 0),
    })),
    ...(antecipadosEntrada || []).map((p) => ({
      id: `ant-${p.id}`, quando: new Date(p.created_at), tipo: 'Antecipado',
      descricao: p.movimentos?.placa ? `Entrada ${p.movimentos.placa}` : 'Entrada de veículo',
      forma: descForma[p.forma_pagamento] || p.forma_pagamento, valor: Number(p.valor || 0),
    })),
    ...reservasAntecip.map((r) => ({
      id: `res-${r.id}`, quando: new Date(r.created_at), tipo: 'Antecipado',
      descricao: `Reserva${r.placa ? ` ${r.placa}` : ''}${r.nome ? ` — ${r.nome}` : ''}`,
      forma: descForma[r.forma_antecipado] || r.forma_antecipado, valor: Number(r.valor_antecipado || 0),
    })),
    ...(vendasProdutos || []).map((v) => ({
      id: `prod-${v.id}`, quando: new Date(v.criado_em), tipo: 'Produto',
      descricao: `${v.produtos?.descricao || '—'} (${Number(v.quantidade)}x)`,
      forma: descForma[v.forma_pagamento] || v.forma_pagamento, valor: Number(v.valor_total || 0),
    })),
    ...(sangrias || []).map((s) => ({
      id: `sang-${s.id}`, quando: new Date(s.created_at), tipo: 'Sangria',
      descricao: s.motivo || '—', forma: null, valor: -Number(s.valor || 0),
    })),
  ].sort((a, b) => b.quando - a.quando);

  return {
    caixa, operador: operadorRow?.nome || '—',
    porTipo, porConvenio, porTabela, descConvenio, descTabela, descForma,
    valorFaturado, valorProporcionalTotal, descontos,
    mensalidades, mensalidadesTotal, produtos, produtosTotal, antecipados, antecipadosTotal,
    porForma, dinheiro, sangrias: sangriasLista, sangriasTotal,
    totalRecebido, esperadoCaixa, diferenca, itens,
    qtdSaidas: (movs || []).length, qtdCancelados: qtdCancelados || 0, qtdSemSaida,
  };
}

/**
 * Uma linha "Rótulo: valor" — texto corrido (não colunas com layout flex
 * lado a lado). Era um flex "rótulo .......... valor" antes, mas isso
 * cortava o último dígito na impressora real (o valor, de largura fixa,
 * espremia até estourar a bobina) — texto corrido é o mesmo formato que já
 * funciona comprovadamente no ticket normal (ver Ticket.jsx): sem espaço
 * sobrando, ele só quebra linha, nunca corta.
 */
function linha(rotulo, valor, opts = '') {
  return `<p class="linha ${opts}"><strong>${escapeHtml(rotulo)}:</strong> ${escapeHtml(valor)}</p>`;
}
function secao(titulo) {
  return `<div class="secao">${escapeHtml(titulo)}</div>`;
}

/**
 * Mesmo relatório de `imprimirRelatorioCaixa`, em texto puro — usado pro
 * "Enviar por WhatsApp"/"Enviar por e-mail" da prévia na tela (ver
 * RelatorioCaixaModal em Caixa.jsx). Mesma regra do `reimpressao` (omite
 * "Sem saída" numa reimpressão de dias depois) e do `incluirMovimentacoes`
 * (extrato item a item, opcional).
 */
export function textoRelatorioCaixa(dados, filial, reimpressao = false, incluirMovimentacoes = false) {
  const { caixa } = dados;
  const linhas = [];
  if (filial?.nome_fantasia) linhas.push(filial.nome_fantasia);
  if (filial?.cnpj) linhas.push(`CNPJ: ${filial.cnpj}`);
  linhas.push('', `FECHAMENTO DE CAIXA Nº ${caixa.numero}`,
    `De: ${new Date(caixa.aberto_em).toLocaleString('pt-BR')}`,
    `Até: ${caixa.fechado_em ? new Date(caixa.fechado_em).toLocaleString('pt-BR') : 'em aberto'}`);

  linhas.push('', 'VEÍCULOS',
    `Saídas no turno: ${dados.qtdSaidas}`,
    `  Avulso: ${dados.porTipo.avulso}`,
    `  Mensalista: ${dados.porTipo.mensalista}`,
    `Cancelados: ${dados.qtdCancelados}`);
  if (!reimpressao) linhas.push(`Sem saída (no pátio): ${dados.qtdSemSaida}`);

  linhas.push('', 'FATURAMENTO',
    `Valor faturado: ${fmtBRL(dados.valorFaturado)}`,
    `Convênio: ${fmtBRL(dados.descontos)}`,
    `Mensalidades: ${fmtBRL(dados.mensalidadesTotal)}`,
    `Antecipados: ${fmtBRL(dados.antecipadosTotal)}`,
    `Venda de produtos: ${fmtBRL(dados.produtosTotal)}`,
    `Total recebido: ${fmtBRL(dados.totalRecebido)}`);

  linhas.push('', 'CAIXA', `Troco de abertura: ${fmtBRL(Number(caixa.valor_abertura || 0))}`,
    `Sangrias: ${fmtBRL(dados.sangriasTotal)}`);
  for (const s of dados.sangrias) linhas.push(`  ${s.motivo || 'Sangria'}: -${fmtBRL(s.valor)}`);
  linhas.push(`Dinheiro recebido: ${fmtBRL(dados.dinheiro)}`, `Esperado no caixa: ${fmtBRL(dados.esperadoCaixa)}`);
  if (caixa.valor_fechamento != null) linhas.push(`Dinheiro contado: ${fmtBRL(Number(caixa.valor_fechamento))}`);
  if (dados.diferenca != null) linhas.push(`Diferença: ${dados.diferenca >= 0 ? '+' : ''}${fmtBRL(dados.diferenca)}`);

  linhas.push('', 'FORMAS DE PAGAMENTO');
  const formasEntries = Object.entries(dados.porForma);
  if (formasEntries.length) for (const [k, v] of formasEntries) linhas.push(`${dados.descForma[k] || k}: ${fmtBRL(v)}`);
  else linhas.push('Sem recebimentos: —');

  if (Object.keys(dados.porConvenio).length) {
    linhas.push('', 'CONVÊNIOS');
    for (const [k, v] of Object.entries(dados.porConvenio)) linhas.push(`${dados.descConvenio[k] || k} (${v.qtd}): ${fmtBRL(v.desconto)}`);
  }
  if (Object.keys(dados.porTabela).length) {
    linhas.push('', 'TABELAS DE PREÇO');
    for (const [k, v] of Object.entries(dados.porTabela)) linhas.push(`${dados.descTabela[k] || k} (${v.qtd}): ${fmtBRL(v.valor)}`);
  }
  if (dados.mensalidades.length) {
    linhas.push('', `MENSALIDADES RECEBIDAS (${dados.mensalidades.length})`);
    for (const m of dados.mensalidades) linhas.push(`${m.nome}: ${fmtBRL(m.valor)}`);
  }
  if (dados.produtos.length) {
    linhas.push('', `VENDAS DE PRODUTOS (${dados.produtos.length})`);
    for (const p of dados.produtos) linhas.push(`${p.nome} (${p.quantidade}x): ${fmtBRL(p.valor)}`);
  }
  if (dados.antecipados.length) {
    linhas.push('', `ANTECIPADOS (${dados.antecipados.length})`);
    for (const a of dados.antecipados) linhas.push(`${a.ref}: ${fmtBRL(a.valor)}`);
  }

  if (incluirMovimentacoes && dados.itens?.length) {
    linhas.push('', `MOVIMENTAÇÕES (${dados.itens.length})`);
    for (const it of dados.itens) {
      const hora = it.quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      linhas.push(`${hora} ${it.tipo} — ${it.descricao}${it.forma ? ` (${it.forma})` : ''}: ${fmtBRL(it.valor)}`);
    }
  }

  linhas.push('', `Operador: ${dados.operador}`);
  return linhas.join('\n');
}

/**
 * Relatório de fechamento de caixa, impresso na bobina de 58mm (mesmo padrão
 * de Ticket.jsx — ver comentário lá sobre @page/58mm) — é um comprovante,
 * não um relatório A4 como BI/Reservas.
 *
 * `reimpressao`: true quando vem da lista "Caixas fechados" (reimprimir um
 * turno de qualquer data) — nesse caso omite "Sem saída (no pátio)", porque
 * esse número só faz sentido na hora exata do fechamento (reimprimir dias
 * depois, os carros que apareciam "sem saída" naquela hora já saíram há
 * muito — o número ficaria só enganando).
 *
 * `incluirMovimentacoes`: acrescenta o extrato item a item (dados.itens) no
 * fim — opcional porque um turno com muito movimento deixa a bobina bem
 * mais longa; o resumo por seção acima já é suficiente na maioria das vezes.
 */
export function imprimirRelatorioCaixa(dados, filial, reimpressao = false, incluirMovimentacoes = false) {
  const { caixa } = dados;
  const cabecalho = filial && (filial.nome_fantasia || filial.cnpj) ? `
    ${filial.nome_fantasia ? `<div class="nome">${escapeHtml(filial.nome_fantasia)}</div>` : ''}
    ${filial.cnpj ? `<div class="linha-end">CNPJ: ${escapeHtml(filial.cnpj)}</div>` : ''}
    <hr>` : '';

  const veiculos = secao('Veículos')
    + linha('Saídas no turno', String(dados.qtdSaidas))
    + linha('  Avulso', String(dados.porTipo.avulso))
    + linha('  Mensalista', String(dados.porTipo.mensalista))
    + linha('Cancelados', String(dados.qtdCancelados))
    + (reimpressao ? '' : linha('Sem saída (no pátio)', String(dados.qtdSemSaida)));

  const faturamento = secao('Faturamento')
    + linha('Valor faturado', fmtBRL(dados.valorFaturado))
    + linha('Convênio', fmtBRL(dados.descontos))
    + linha('Mensalidades', fmtBRL(dados.mensalidadesTotal))
    + linha('Antecipados', fmtBRL(dados.antecipadosTotal))
    + linha('Venda de produtos', fmtBRL(dados.produtosTotal))
    + linha('Total recebido', fmtBRL(dados.totalRecebido), 'total');

  const caixaSecao = secao('Caixa')
    + linha('Troco de abertura', fmtBRL(Number(caixa.valor_abertura || 0)))
    + linha('Sangrias', fmtBRL(dados.sangriasTotal))
    + (dados.sangrias.length
      ? dados.sangrias.map((s) => linha(`  ${s.motivo || 'Sangria'}`, `-${fmtBRL(s.valor)}`)).join('')
      : '')
    + linha('Dinheiro recebido', fmtBRL(dados.dinheiro))
    + linha('Esperado no caixa', fmtBRL(dados.esperadoCaixa), 'total')
    + (caixa.valor_fechamento != null ? linha('Dinheiro contado', fmtBRL(Number(caixa.valor_fechamento))) : '')
    + (dados.diferenca != null
      ? linha('Diferença', `${dados.diferenca >= 0 ? '+' : ''}${fmtBRL(dados.diferenca)}`, Math.abs(dados.diferenca) < 0.005 ? '' : 'destaque')
      : '');

  const formasHtml = secao('Formas de pagamento')
    + (Object.entries(dados.porForma).length
      ? Object.entries(dados.porForma).map(([k, v]) => linha(dados.descForma[k] || k, fmtBRL(v))).join('')
      : linha('Sem recebimentos', '—'));

  const conveniosHtml = Object.keys(dados.porConvenio).length ? (
    secao('Convênios')
    + Object.entries(dados.porConvenio)
      .map(([k, v]) => linha(`${dados.descConvenio[k] || k} (${v.qtd})`, fmtBRL(v.desconto)))
      .join('')
  ) : '';

  const tabelasHtml = Object.keys(dados.porTabela).length ? (
    secao('Tabelas de preço')
    + Object.entries(dados.porTabela)
      .map(([k, v]) => linha(`${dados.descTabela[k] || k} (${v.qtd})`, fmtBRL(v.valor)))
      .join('')
  ) : '';

  const mensalidadesHtml = dados.mensalidades.length ? (
    secao(`Mensalidades recebidas (${dados.mensalidades.length})`)
    + dados.mensalidades.map((m) => linha(m.nome, fmtBRL(m.valor))).join('')
  ) : '';

  const produtosHtml = dados.produtos.length ? (
    secao(`Vendas de produtos (${dados.produtos.length})`)
    + dados.produtos.map((p) => linha(`${p.nome} (${p.quantidade}x)`, fmtBRL(p.valor))).join('')
  ) : '';

  const antecipadosHtml = dados.antecipados.length ? (
    secao(`Antecipados (${dados.antecipados.length})`)
    + dados.antecipados.map((a) => linha(a.ref, fmtBRL(a.valor))).join('')
  ) : '';

  const fmtHoraCurta = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const movimentacoesHtml = (incluirMovimentacoes && dados.itens?.length) ? (
    secao(`Movimentações (${dados.itens.length})`)
    + dados.itens.map((it) => linha(
        `${fmtHoraCurta(it.quando)} ${it.tipo}`,
        `${it.descricao}${it.forma ? ` (${it.forma})` : ''} — ${fmtBRL(it.valor)}`,
      )).join('')
  ) : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fechamento de caixa Nº ${escapeHtml(caixa.numero)}</title>
    <style>
      @page { size: 58mm auto; margin: 0; }
      body { font-family: system-ui, Arial, sans-serif; color: #000; margin: 0; padding: 2mm 3mm; box-sizing: border-box; }
      .nome { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
      .linha-end { font-size: 11px; color: #333; margin-bottom: 2px; }
      hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
      h1 { font-size: 14px; margin: 0 0 2px; text-align: center; }
      .numero { font-size: 16px; font-weight: 800; text-align: center; margin: 4px 0; }
      .periodo { font-size: 11px; text-align: center; color: #333; margin-bottom: 6px; }
      .secao { font-size: 11px; font-weight: 800; text-transform: uppercase; margin: 10px 0 3px; border-bottom: 1px dashed #999; padding-bottom: 2px; }
      .linha { font-size: 12px; margin: 3px 0; line-height: 1.3; }
      .linha.total { font-weight: 800; border-top: 1px dashed #999; padding-top: 4px; margin-top: 5px; }
      .linha.destaque { color: #b30000; font-weight: 800; }
      .rodape { font-size: 11px; color: #333; margin-top: 10px; }
    </style></head><body>
      ${cabecalho}
      <h1>Fechamento de Caixa</h1>
      <div class="numero">Nº ${escapeHtml(caixa.numero)}</div>
      <div class="periodo">
        De: ${new Date(caixa.aberto_em).toLocaleString('pt-BR')}<br>
        Até: ${caixa.fechado_em ? new Date(caixa.fechado_em).toLocaleString('pt-BR') : 'em aberto'}
      </div>
      ${veiculos}
      ${faturamento}
      ${caixaSecao}
      ${formasHtml}
      ${conveniosHtml}
      ${tabelasHtml}
      ${mensalidadesHtml}
      ${produtosHtml}
      ${antecipadosHtml}
      ${movimentacoesHtml}
      <div class="rodape">
        Operador: ${escapeHtml(dados.operador)}<br>
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
