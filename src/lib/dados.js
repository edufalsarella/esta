// Carrega dados do Supabase e mapeia para os tipos do motor de tarifação.
import { supabase } from './supabase.js';

/**
 * Carrega as tabelas de preço vigentes + faixas e devolve no formato que o
 * motor de tarifação espera: Record<tipo, TabelaPreco>.
 */
export async function carregarTabelasPreco() {
  const { data: tabelas, error: e1 } = await supabase
    .from('tabelas_preco')
    .select('*')
    .is('vigencia_fim', null)
    .eq('ativo', true)
    // A RLS já limita à filial, e o normal é ter uma tabela vigente por tipo.
    // Se por engano houver duas, o mapa abaixo faz a última vencer — e sem
    // ordenar "a última" seria o que o banco devolvesse, com o preço cobrado
    // podendo mudar entre dois carregamentos. Ordenando, vence a mais recente.
    .order('vigencia_inicio', { ascending: true })
    .order('created_at', { ascending: true });
  if (e1) throw e1;

  const { data: faixas, error: e2 } = await supabase
    .from('tabela_preco_faixas')
    .select('*');
  if (e2) throw e2;

  const mapa = {};
  for (const t of tabelas) {
    mapa[t.tipo] = {
      tipo: t.tipo,
      qtePontos: Number(t.qte_pontos),
      valorAntes: Number(t.valor_antes || 0),
      valorServico: Number(t.valor_servico || 0),
      faixas: faixas
        .filter((f) => f.tabela_preco_id === t.id)
        .sort((a, b) => a.ordem - b.ordem)
        .map((f) => ({
          ate: Number(f.ate),
          hor: Number(f.valor_hora),
          con: Number(f.valor_convenio),
          tipoCobranca: f.tipo_cobranca,
          periodo: Number(f.periodo ?? 1),
        })),
    };
  }
  return mapa;
}

/** Movimentos abertos (veículos no pátio). RLS já filtra pela filial. */
export async function carregarPatio() {
  const { data, error } = await supabase
    .from('movimentos')
    .select('*')
    .is('dt_saida', null)
    .is('excluido_em', null)
    .order('dt_entrada', { ascending: false })
    .order('hr_entrada', { ascending: false });
  if (error) throw error;
  return data;
}

/** Catálogo de modelos de veículo (para a busca na Entrada). */
export async function carregarModelosVeiculo() {
  const { data, error } = await supabase
    .from('modelos_veiculo')
    .select('id, codigo, nome, tabela_tipo')
    .eq('ativo', true);
  if (error) throw error;
  return data;
}

/**
 * Layout dos comprovantes da filial: `{ tipo: conteudo }`.
 * Erro aqui não é fatal — sem modelo (ou sem a tabela, se a migration 0017
 * ainda não rodou) o ticket sai no layout fixo de sempre.
 */
export async function carregarModelosTicket() {
  const { data, error } = await supabase.from('modelos_ticket').select('tipo, conteudo');
  if (error) return {};
  return Object.fromEntries((data || []).map((m) => [m.tipo, m.conteudo]));
}

/** Tabelas liberadas para seleção manual (carro fora do catálogo). */
export async function carregarTabelasManuais() {
  const { data, error } = await supabase
    .from('tabelas_preco')
    .select('tipo, descricao')
    .eq('selecao_manual', true)
    .is('vigencia_fim', null)
    .eq('ativo', true)
    .order('tipo');
  if (error) throw error;
  return data;
}
