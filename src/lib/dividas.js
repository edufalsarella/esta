import { supabase } from './supabase.js';

/** Saldo devedor atual de uma placa (ver clientes.saldo_devedor, Patio.jsx atualizarSaldoDevedor). */
export async function buscarDividaDaPlaca(placa, filialId) {
  const { data, error } = await supabase.from('clientes')
    .select('id, saldo_devedor').eq('filial_id', filialId).eq('placa', placa).maybeSingle();
  if (error) return { error: error.message };
  return { error: null, clienteId: data?.id || null, saldo: Number(data?.saldo_devedor || 0) };
}

/**
 * Quita (total ou parcialmente) o saldo devedor de uma placa — mesmo
 * espírito de venderProduto/receberMensalidade: liga ao caixa aberto do
 * momento (sem caixa aberto funciona igual, só fica fora do fechamento — ver
 * Caixa.jsx). `valor` nunca passa do saldo atual (não dá pra "pagar a mais"
 * uma dívida). NUNCA gera RPS/NFS-e — essa receita já foi faturada na saída
 * que gerou a dívida (ver 0056_divida_pagamentos.sql).
 */
export async function receberDivida({ perfil, clienteId, placa, saldoAtual, valor, forma }) {
  const valorPago = Math.min(Math.round(Number(valor) * 100) / 100, Number(saldoAtual));
  if (!(valorPago > 0)) return { error: 'Valor precisa ser maior que zero.' };

  const { data: cx } = await supabase.from('caixas').select('id')
    .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
  const { data: pagamento, error } = await supabase.from('divida_pagamentos').insert({
    filial_id: perfil.filial_id, placa, valor: valorPago,
    forma_pagamento: forma, caixa_id: cx?.id ?? null, operador_id: perfil.id,
  }).select().single();
  if (error) return { error: error.message };

  const novoSaldo = Math.max(0, Math.round((Number(saldoAtual) - valorPago) * 100) / 100);
  const { error: errCliente } = await supabase.from('clientes').update({ saldo_devedor: novoSaldo }).eq('id', clienteId);
  if (errCliente) return { error: `Pagamento gravado, mas o saldo não foi atualizado: ${errCliente.message}`, pagamento };

  return { error: null, pagamento, valorPago, novoSaldo };
}
