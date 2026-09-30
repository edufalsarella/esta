import { validarCpfCnpj, formatarCpfCnpj } from './documento.js';
import { buscarCnpj, municipioIbgeDe } from './cnpj.js';
import { faltasEnderecoTomador } from './fiscal.js';

const CAMPOS_ENDERECO = ['endereco', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'cod_ibge'];
const COLUNAS_CADASTRO = 'razao, endereco, numero, bairro, cidade, uf, cep, cod_ibge, email, telefone';

/**
 * Dados já conhecidos de um tomador pelo CPF/CNPJ, pra não redigitar: nota
 * fiscal anterior (a mais recente), mensalista, convênio e, só pra CNPJ, a
 * Receita (dado público). Nome sai da primeira fonte que tiver; o endereço
 * vai inteiro de uma fonte só (nunca CEP de um cadastro com rua de outro),
 * de preferência uma com endereço completo. `null` se não achou nada.
 */
export async function buscarTomadorCadastrado(supabase, documento) {
  const v = validarCpfCnpj(documento);
  if (v.vazio || !v.valido) return null;
  const digitos = String(documento).replace(/\D/g, '');
  const variantes = [digitos, formatarCpfCnpj(digitos)];

  const [notas, mensalistas, convenios] = await Promise.all([
    supabase.from('notas_fiscais').select('tomador').in('tomador->>cpf_cnpj', variantes)
      .order('created_at', { ascending: false }).limit(10),
    supabase.from('mensalistas').select(COLUNAS_CADASTRO).in('cpf_cnpj', variantes).limit(1),
    v.tipo === 'CNPJ'
      ? supabase.from('convenios').select(COLUNAS_CADASTRO).in('cnpj', variantes).limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  const deCadastro = (r, origem) => (r ? { ...r, nome: r.razao, origem } : null);
  const candidatos = [
    ...(notas.data || []).map((n) => ({ ...n.tomador, origem: 'nota fiscal anterior' })),
    deCadastro(mensalistas.data?.[0], 'cadastro de mensalista'),
    deCadastro(convenios.data?.[0], 'cadastro de convênio'),
  ].filter(Boolean);

  if (!candidatos.length && v.tipo === 'CNPJ') {
    const r = await buscarCnpj(digitos);
    if (!r.erro) candidatos.push({ ...r, origem: 'Receita Federal (CNPJ)' });
  }
  if (!candidatos.length) return null;

  const comNome = candidatos.find((c) => String(c.nome || '').trim());
  const comEndereco = candidatos.find((c) => !faltasEnderecoTomador(c).length)
    || candidatos.find((c) => String(c.endereco || '').trim());

  const resultado = { nome: comNome?.nome || '', origem: (comEndereco || comNome).origem };
  if (comEndereco) {
    for (const campo of CAMPOS_ENDERECO) resultado[campo] = comEndereco[campo] || '';
    if (!resultado.cod_ibge && resultado.cidade) {
      const mun = await municipioIbgeDe(resultado.cidade, resultado.uf);
      if (mun) Object.assign(resultado, { cidade: mun.nome, uf: mun.uf, cod_ibge: mun.codigo });
    }
  }
  const comContato = candidatos.find((c) => c.email || c.telefone);
  if (comContato) Object.assign(resultado, { email: comContato.email || '', telefone: comContato.telefone || '' });
  return resultado;
}

/** "Rua X, 12 — Centro — Campinas/SP" pra mostrar o endereço achado numa linha. */
export function resumoEndereco(t = {}) {
  const rua = [t.endereco, t.numero].filter((x) => String(x || '').trim()).join(', ');
  const cidade = [t.cidade, t.uf].filter(Boolean).join('/');
  return [rua, t.bairro, cidade].filter((x) => String(x || '').trim()).join(' — ');
}
