// Relatório "Mensalistas em atraso": quem tem o próximo pagamento vencido na
// data de emissão (inclusive o que vence no próprio dia, com 0 dia de atraso).
// O vencimento em aberto é `mensalistas.proximo_pagamento` — o "Receber"
// avança essa data um mês (ver lib/mensalidade.js), então enquanto ela está no
// passado a mensalidade daquele vencimento não foi paga.

import { diferencaEmDias } from './tempo.js';

/**
 * @param mensalistas  linhas de `mensalistas` (id, codigo, razao, proximo_pagamento, ativo)
 * @param placasPorMensalista  { [mensalista_id]: ['ABC1D23', …] }
 * @param dataRef  'YYYY-MM-DD' — data de emissão do relatório
 * @returns [{ id, placas, razao, vencimento, dias }] do menor atraso pro maior
 *
 * Fica de fora: inativo e quem não tem próximo pagamento cadastrado (sem
 * controle de vencimento — o pátio também não bloqueia esses, ver
 * dentroDoVencimento em tempo.js). Sem veículo cadastrado, a placa é o código
 * do mensalista (na importação do legado o código é a placa).
 */
export function mensalistasEmAtraso(mensalistas, placasPorMensalista, dataRef) {
  return (mensalistas || [])
    .filter((m) => m.ativo !== false && m.proximo_pagamento && m.proximo_pagamento <= dataRef)
    .map((m) => {
      const placas = placasPorMensalista?.[m.id]?.length ? [...placasPorMensalista[m.id]].sort() : [m.codigo];
      return {
        id: m.id,
        placas,
        razao: m.razao || '',
        vencimento: m.proximo_pagamento,
        dias: diferencaEmDias(m.proximo_pagamento, dataRef),
      };
    })
    .sort((a, b) => a.dias - b.dias || a.razao.localeCompare(b.razao, 'pt-BR', { sensitivity: 'base' }));
}
