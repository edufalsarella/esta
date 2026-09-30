// Endereço pelo CEP (dado público): ViaCEP, com a BrasilAPI de reserva. Os
// dois já trazem o código IBGE da cidade — não precisa casar pelo nome.
// Só pré-preenche formulário; quem usa confere e completa o número.

function montar({ endereco, bairro, cidade, uf, cod_ibge }) {
  if (!cidade || !/^\d{7}$/.test(String(cod_ibge || ''))) return null;
  return { endereco: endereco || '', bairro: bairro || '', cidade, uf: uf || '', cod_ibge: String(cod_ibge) };
}

async function viaCep(cep) {
  const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!resp.ok) throw new Error(`ViaCEP ${resp.status}`);
  const d = await resp.json();
  if (d.erro) return null;
  return montar({ endereco: d.logradouro, bairro: d.bairro, cidade: d.localidade, uf: d.uf, cod_ibge: d.ibge });
}

async function brasilApi(cep) {
  const resp = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`BrasilAPI ${resp.status}`);
  const d = await resp.json();
  return montar({ endereco: d.street, bairro: d.neighborhood, cidade: d.city, uf: d.state, cod_ibge: d.ibge?.city });
}

/**
 * { endereco, bairro, cidade, uf, cod_ibge } do CEP, `{ erro }` se não achou
 * ou não conseguiu consultar. CEP geral de cidade pequena vem sem logradouro
 * e bairro (só a cidade) — quem chama não deve apagar o que já foi digitado.
 */
export async function buscarCep(valor) {
  const cep = String(valor || '').replace(/\D/g, '');
  if (cep.length !== 8) return { erro: 'CEP deve ter 8 dígitos.' };
  for (const consulta of [viaCep, brasilApi]) {
    try {
      const r = await consulta(cep);
      if (r) return r;
      return { erro: 'CEP não encontrado.' };
    } catch {
      // serviço fora do ar: tenta o próximo
    }
  }
  return { erro: 'Não consegui consultar o CEP agora — preencha o endereço à mão.' };
}
