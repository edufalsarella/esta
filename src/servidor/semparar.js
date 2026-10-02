// Mensagens das chamadas ao Sem Parar (api/semparar-autoriza.js e
// api/semparar-saida.js) — o motivo em português pelo código de retorno do
// manual e, junto, o que a Sem Parar respondeu de fato (HTTP, código,
// mensagem), pra dar pra diagnosticar chave/estabelecimento errados.

// Códigos de retorno do manual (item 3) que pedem uma frase própria.
const MOTIVOS = {
  3: 'Estabelecimento inválido junto ao Sem Parar — confira o código em Configurações.',
  6: 'Erro genérico do Sem Parar.',
  12: 'Hash do estabelecimento inválido — confira em Configurações.',
  14: 'NSU inválido.',
  17: 'O cliente cancelou o pagamento pelo app Sem Parar — escolha outra forma de pagamento.',
  57: 'Não autorizado pelo Sem Parar (ou o cancelamento excedeu o prazo).',
  58: 'Transação não autorizada pelo Sem Parar.',
  59: 'Token inválido ou vencido — peça pro veículo reentrar no pátio pra gerar um novo.',
  62: 'Placa inválida junto ao Sem Parar.',
  63: 'NSU já utilizado — tente de novo.',
  82: 'Dados inválidos enviados ao Sem Parar.',
  93: 'Token já utilizado — este veículo já foi cobrado por Sem Parar antes.',
};

export const motivoDoCodigo = (c) => MOTIVOS[c] || `Sem Parar recusou (código ${c}).`;

/** Código de retorno da resposta, ou null se ela não trouxe (resposta fora do formato). */
export function codigoRetorno(corpo) {
  const c = corpo?.dados?.codigoRetorno;
  return c == null || c === '' || Number.isNaN(Number(c)) ? null : Number(c);
}

/** "HTTP 403 — código 12 — Hash inválido" com o que a Sem Parar mandou de volta. */
export function detalheSemParar(httpStatus, corpo) {
  const d = corpo?.dados || {};
  const textos = [d.mensagemRetorno, d.mensagem, d.descricao, corpo?.mensagem, corpo?.message, corpo?.erro, corpo?.error]
    .filter((t) => typeof t === 'string' && t.trim());
  const partes = [`HTTP ${httpStatus}`];
  if (codigoRetorno(corpo) != null) partes.push(`código ${codigoRetorno(corpo)}`);
  if (textos.length) partes.push([...new Set(textos)].join(' / '));
  else if (corpo && Object.keys(corpo).length) partes.push(JSON.stringify(corpo).slice(0, 300));
  else partes.push('resposta vazia');
  return partes.join(' — ');
}

/** Mensagem pro operador: motivo pelo código (ou "resposta inesperada") + o detalhe bruto. */
export function erroSemParar(httpStatus, corpo) {
  const codigo = codigoRetorno(corpo);
  const motivo = codigo != null ? motivoDoCodigo(codigo) : 'Resposta inesperada do Sem Parar (chave x-api-key, estabelecimento ou endereço da API?).';
  return `${motivo} [Sem Parar: ${detalheSemParar(httpStatus, corpo)}]`;
}
