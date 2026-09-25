import { supabase } from './supabase.js';
import { fmtDataBR, fmtBRL } from './tempo.js';
import { carregarModelosTicket } from './dados.js';
import { dadosFilial, dadosMensalista, dadosMensalidade } from './dadosTicket.js';

/**
 * Dívidas de avulso pendentes atribuídas a este mensalista (ver Pátio →
 * saída → Devedor → "Mensalista" e 0057_mensalista_extras.sql) — somadas no
 * valor sugerido do próximo pagamento (ver ReceberMensalidade.jsx).
 */
export async function buscarExtrasPendentes(mensalistaId) {
  const { data, error } = await supabase.from('mensalista_extras')
    .select('id, placa, valor, criado_em').eq('mensalista_id', mensalistaId).is('cobrado_em', null)
    .order('criado_em');
  if (error) return { error: error.message, extras: [], total: 0 };
  const extras = data || [];
  return { error: null, extras, total: extras.reduce((s, e) => s + Number(e.valor || 0), 0) };
}

// Grava o evento de recebimento (mensalista_pagamentos), liga ao caixa aberto
// do operador (se houver, pra entrar no fechamento) e avança o próximo
// pagamento no cadastro do mensalista. Compartilhado entre a tela de
// Mensalistas e o recebimento rápido do Pátio.
//
// `extrasIds`/`valorExtra` (opcionais): dívidas de avulso pendentes (ver
// buscarExtrasPendentes) que este pagamento está cobrando junto — gravadas
// em valor_pago normalmente (o mensalista realmente pagou esse tanto a
// mais), mas separadas em valor_extra pra não contar como Faturado novo
// (essa receita já foi contabilizada na saída avulsa que gerou a dívida —
// ver Caixa.jsx "Dívida (turno)", mesmo raciocínio de movimentos.valor_dev).
export async function receberMensalidade({ perfil, mensalista, dtPagamento, valor, forma, proximo, observacao, extrasIds = [], valorExtra = 0 }) {
  const { data: cx } = await supabase.from('caixas').select('id')
    .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
  const { data: pagamento, error: errPag } = await supabase.from('mensalista_pagamentos').insert({
    filial_id: perfil.filial_id, mensalista_id: mensalista.id,
    dt_pagamento: dtPagamento, valor_pago: Number(valor), forma_pagamento: forma,
    proximo_pagamento: proximo, proximo_anterior: mensalista.proximo_pagamento || null,
    observacao: observacao?.trim() || null, recebido_por: perfil.id,
    caixa_id: cx?.id ?? null, valor_extra: Number(valorExtra || 0),
  }).select().single();
  if (errPag) return { error: errPag.message };

  const { error: errCad } = await supabase.from('mensalistas')
    .update({ proximo_pagamento: proximo }).eq('id', mensalista.id);
  if (errCad) return { error: `Pagamento gravado, mas o cadastro não foi atualizado: ${errCad.message}`, pagamento };

  if (extrasIds.length) {
    // Best-effort: o pagamento já está gravado: uma falha aqui deixaria a
    // dívida marcada como pendente de novo (não desaparece, só fica pra
    // conferir na mão — não é motivo pra reverter o recebimento).
    await supabase.from('mensalista_extras')
      .update({ cobrado_em: new Date().toISOString(), mensalidade_pagamento_id: pagamento.id })
      .in('id', extrasIds);
  }

  return { error: null, pagamento };
}

export function descricaoForma(formas, codigo) {
  return formas.find((f) => f.codigo === codigo)?.descricao || codigo;
}

export function ticketRecebimento({ mensalista, dtPagamento, valor, proximo, formaDescricao, operador, reimpressao }) {
  return {
    titulo: reimpressao ? 'Recibo de mensalidade (reimpressão)' : 'Recibo de mensalidade',
    linhas: [
      ['Mensalista', mensalista.razao],
      ['Data do pagamento', fmtDataBR(dtPagamento)],
      ['Valor pago', fmtBRL(Number(valor))],
      ['Forma de pagamento', formaDescricao],
      ['Próximo pagamento', fmtDataBR(proximo)],
      [reimpressao ? 'Reimpresso por' : 'Operador', operador],
    ],
  };
}

/**
 * Mesmo recibo, já com o layout que a filial cadastrou em Modelos de ticket
 * (tipo `mensalidade`). É async porque precisa buscar filial, veículos e o
 * modelo; qualquer problema aí só faz o recibo sair no layout fixo de sempre.
 *
 * `dados`+`tipo` sempre são anexados, mesmo sem modelo próprio cadastrado —
 * é o que permite imprimir esse recibo por Bluetooth/ESC-POS (que usa o
 * modelo padrão de fábrica como último recurso, ver src/lib/escpos.js).
 */
export async function ticketRecebimentoComModelo(args) {
  const base = ticketRecebimento(args);
  try {
    const { mensalista, dtPagamento, valor, proximo, formaDescricao, operador, recibo } = args;
    const [modelos, fl, vc] = await Promise.all([
      carregarModelosTicket(),
      supabase.from('filiais').select('*').eq('id', mensalista.filial_id).maybeSingle(),
      supabase.from('mensalista_veiculos').select('placa, modelo').eq('mensalista_id', mensalista.id),
    ]);
    return {
      ...base,
      tipo: 'mensalidade',
      ...(modelos.mensalidade ? { modelo: modelos.mensalidade } : {}),
      dados: {
        ...dadosFilial(fl.data || {}),
        ...dadosMensalista({ mensalista, veiculos: vc.data || [] }),
        ...dadosMensalidade({
          dtPagamento, proximo, valor, formaDescricao,
          valorMensalidade: mensalista.valor_mensalidade,
        }),
        'C#': recibo ? String(recibo).slice(0, 8).toUpperCase() : '',
        US: operador || '',
      },
    };
  } catch {
    return base;
  }
}
