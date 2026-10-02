// Vercel Function (Node.js) — chama o método Autoriza do Sem Parar na
// ENTRADA do veículo, pra saber se a placa pode pagar por Sem Parar neste
// estacionamento. Fica no servidor porque a x-api-key (chave da
// integradora, compartilhada por todas as filiais) nunca pode ir pro
// navegador — ver docs/SEMPARAR.md.
//
// Chamada em best-effort a partir de Patio.jsx/registrarEntrada — falha
// aqui não pode travar a entrada do veículo, só deixa o movimento sem
// marcação de Sem Parar (o operador cobra normal na saída).
//
// Variáveis de ambiente exigidas (Vercel -> Project Settings -> Environment
// Variables; nunca comitar, nunca colar num chat):
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  (já configuradas pro app)
//   SEMPARAR_API_KEY                            (chave da integradora, dada pelo Sem Parar)
//   SEMPARAR_BASE_URL                           (opcional — default é o ambiente de
//                                                 homologação; troca pra produção quando o
//                                                 Sem Parar liberar a URL, após a homologação)
import { createClient } from '@supabase/supabase-js';
import { erroSemParar, codigoRetorno } from '../src/servidor/semparar.js';

const BASE_PADRAO = 'https://homolog.apisemparar.com.br';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Método não suportado.' }); return; }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ erro: 'Faça login no app.' }); return; }

  const { movimentoId } = req.body || {};
  if (!movimentoId) { res.status(400).json({ erro: 'movimentoId é obrigatório.' }); return; }

  const apiKey = process.env.SEMPARAR_API_KEY;
  if (!apiKey) { res.status(200).json({ ok: false, motivo: 'sem_api_key', erro: 'Sem Parar ligado na filial, mas falta SEMPARAR_API_KEY nas Environment Variables do Vercel.' }); return; }
  const baseUrl = process.env.SEMPARAR_BASE_URL || BASE_PADRAO;

  // Client com o token de quem chamou — a RLS por filial já garante que só
  // enxerga/edita o movimento da própria filial, sem precisar de service_role
  // (mesmo padrão de api/gerar-nfse.js).
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  const { data: mov, error: errMov } = await supabase.from('movimentos')
    .select('id, placa, filial_id').eq('id', movimentoId).maybeSingle();
  if (errMov) { res.status(500).json({ erro: errMov.message }); return; }
  if (!mov) { res.status(404).json({ erro: 'Movimento não encontrado (ou fora da sua filial).' }); return; }

  const { data: filial, error: errFilial } = await supabase.from('filiais')
    .select('config').eq('id', mov.filial_id).maybeSingle();
  if (errFilial || !filial) { res.status(500).json({ erro: errFilial?.message || 'Filial não encontrada.' }); return; }

  const cfg = filial.config?.semparar || {};
  if (!cfg.ativo) {
    // Sem Parar desligado nesta filial — não é erro.
    res.status(200).json({ ok: false, motivo: 'desligado' });
    return;
  }
  if (!cfg.codigoEstabelecimento || !cfg.hash) {
    const falta = [!cfg.codigoEstabelecimento && 'código do estabelecimento', !cfg.hash && 'hash'].filter(Boolean).join(' e ');
    res.status(200).json({ ok: false, motivo: 'incompleto', erro: `Sem Parar ligado, mas falta ${falta} em Configurações — a placa não foi autorizada.` });
    return;
  }

  try {
    const resp = await fetch(`${baseUrl}/aucloud/v1/estacione/informatizado/autoriza`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        codigoEstabelecimento: cfg.codigoEstabelecimento,
        hash: cfg.hash,
      },
      body: JSON.stringify({ placaVeiculo: mov.placa }),
    });
    const corpo = await resp.json().catch(() => ({}));
    const dados = corpo?.dados || {};
    // Resposta fora do formato (sem dados.resultadoAnalise — ex.: chave
    // x-api-key recusada) é ERRO, não "negado": a placa não foi avaliada.
    if (!resp.ok || dados.resultadoAnalise == null) {
      await supabase.from('movimentos').update({ semparar_status: 'erro' }).eq('id', mov.id);
      res.status(200).json({ ok: false, erro: erroSemParar(resp.status, corpo) });
      return;
    }
    const autorizado = Number(dados.resultadoAnalise) === 1;
    await supabase.from('movimentos').update({
      semparar_status: autorizado ? 'autorizado' : 'negado',
      semparar_token: dados.token || null,
      semparar_sticker: dados.sticker || null,
    }).eq('id', mov.id);
    res.status(200).json({ ok: true, autorizado, codigoRetorno: codigoRetorno(corpo) });
  } catch (e) {
    await supabase.from('movimentos').update({ semparar_status: 'erro' }).eq('id', movimentoId);
    res.status(200).json({ ok: false, erro: `Falha de comunicação com o Sem Parar: ${String(e?.message || e)}` });
  }
}
