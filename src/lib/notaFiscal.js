import { gerarXmlDPS, gerarXmlAbrasfLoteRps, proximoNumeroRps, aliquotaIssConfigurada } from './fiscal.js';

/**
 * Cria e grava uma nota fiscal (DPS ou RPS/DPS ABRASF), no padrão configurado
 * pra filial (`filial.config.nfse.padrao`). Compartilhado entre a saída do
 * pátio (Patio.jsx) e o recebimento de mensalidade (ReceberMensalidade.jsx) —
 * a única diferença entre os dois pontos de chamada é o `tomador` (e
 * `movimentoId`, null quando a origem é mensalidade, já que a coluna é
 * nullable).
 */
export async function criarNotaFiscal(supabase, { filialId, movimentoId = null, competencia, valor, descricao, tomador }) {
  const { data: filial, error: errFilial } = await supabase.from('filiais').select('*').eq('id', filialId).maybeSingle();
  if (errFilial || !filial) return { error: errFilial?.message || 'Filial não encontrada para gerar a nota fiscal.' };

  const cfg = filial.config?.nfse || {};
  const padrao = cfg.padrao || 'padrao_nacional_campinas';
  const serie = padrao === 'abrasf' ? (cfg.abrasf?.serie || '1') : (cfg.serie || '1');
  const percIss = aliquotaIssConfigurada(filial);
  const numero = await proximoNumeroRps(supabase, filialId, serie);

  const nota = {
    filial_id: filialId, movimento_id: movimentoId, numero_rps: numero, serie,
    competencia, descricao: descricao || 'Estacionamento de veículo',
    valor: Number(valor), aliquota_iss: percIss,
    valor_iss: Number((Number(valor) * percIss / 100).toFixed(2)),
    tomador, status: 'gerada',
  };
  nota.xml = padrao === 'abrasf' ? gerarXmlAbrasfLoteRps({ nota, filial }) : gerarXmlDPS({ nota, filial });

  // Devolve a nota gravada para o chamador poder imprimir o RPS na hora.
  const { data: gravada, error } = await supabase.from('notas_fiscais').insert(nota).select().single();
  return { error: error?.message || null, nota: gravada || null, filial };
}

/**
 * Corrige uma nota já gerada (ex.: CEP errado do tomador que fez a prefeitura
 * recusar) e devolve ela pro começo do fluxo: regenera o XML com os dados
 * novos, limpa protocolo/número da NFS-e/retorno e volta pra "gerada", pronta
 * pra reenviar. O número do RPS é mantido de propósito — no ABRASF, reenviar
 * o mesmo número é justamente como se retifica um RPS já enviado (manual
 * 2.03, §2.2).
 *
 * Só faz sentido pra nota que ainda não virou NFS-e: uma "autorizada" já é
 * documento fiscal válido e teria que ser cancelada/substituída no lugar.
 */
export async function atualizarNotaFiscal(supabase, notaId, { competencia, valor, descricao, tomador }) {
  const { data: atual, error: errNota } = await supabase.from('notas_fiscais').select('*').eq('id', notaId).maybeSingle();
  if (errNota || !atual) return { error: errNota?.message || 'Nota não encontrada.' };
  if (atual.status === 'autorizada') return { error: 'Esta nota já virou NFS-e — não dá pra alterar, só cancelar/substituir.' };

  const { data: filial, error: errFilial } = await supabase.from('filiais').select('*').eq('id', atual.filial_id).maybeSingle();
  if (errFilial || !filial) return { error: errFilial?.message || 'Filial não encontrada.' };

  const padrao = filial.config?.nfse?.padrao || 'padrao_nacional_campinas';
  const percIss = Number(atual.aliquota_iss || 0);
  const nota = {
    ...atual,
    competencia, descricao, tomador,
    valor: Number(valor),
    valor_iss: Number((Number(valor) * percIss / 100).toFixed(2)),
  };
  nota.xml = padrao === 'abrasf' ? gerarXmlAbrasfLoteRps({ nota, filial }) : gerarXmlDPS({ nota, filial });

  const { error } = await supabase.from('notas_fiscais').update({
    competencia: nota.competencia, descricao: nota.descricao, tomador: nota.tomador,
    valor: nota.valor, valor_iss: nota.valor_iss, xml: nota.xml,
    status: 'gerada', lote: null, numero_nfse: null, retorno: null,
  }).eq('id', notaId);
  return { error: error?.message || null };
}
