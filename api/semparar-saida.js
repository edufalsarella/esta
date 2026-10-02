// Vercel Function (Node.js) — chama Recebe e depois Confirma do Sem Parar
// quando o operador escolhe "Sem Parar" nas formas de pagamento da saída
// (ver src/telas/Patio.jsx/confirmarSaida). NUNCA roda sozinho: só é
// chamada quando o operador aciona essa forma explicitamente. Escolhendo
// qualquer outra forma, o Sem Parar simplesmente não é usado — não existe
// endpoint pra "desistir" de uma mera autorização (Cancela só vale numa
// transação já confirmada, e dentro de 10 min — não implementado nesta fase).
//
// Variáveis de ambiente: mesmas de api/semparar-autoriza.js.
import { createClient } from '@supabase/supabase-js';
import { dataHoraLocalISO } from '../src/lib/tempo.js';
import { erroSemParar, codigoRetorno } from '../src/servidor/semparar.js';

const BASE_PADRAO = 'https://homolog.apisemparar.com.br';


export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Método não suportado.' }); return; }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ erro: 'Faça login no app.' }); return; }

  const { movimentoId, valor, dtSaida, hrSaida } = req.body || {};
  if (!movimentoId || !(Number(valor) > 0) || !dtSaida || hrSaida == null) {
    res.status(400).json({ erro: 'movimentoId, valor, dtSaida e hrSaida são obrigatórios.' });
    return;
  }

  const apiKey = process.env.SEMPARAR_API_KEY;
  if (!apiKey) { res.status(500).json({ erro: 'Sem Parar não configurado (falta SEMPARAR_API_KEY nas Environment Variables do Vercel).' }); return; }
  const baseUrl = process.env.SEMPARAR_BASE_URL || BASE_PADRAO;

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  const { data: mov, error: errMov } = await supabase.from('movimentos').select('*').eq('id', movimentoId).maybeSingle();
  if (errMov) { res.status(500).json({ erro: errMov.message }); return; }
  if (!mov) { res.status(404).json({ erro: 'Movimento não encontrado (ou fora da sua filial).' }); return; }

  const { data: filial, error: errFilial } = await supabase.from('filiais')
    .select('config').eq('id', mov.filial_id).maybeSingle();
  if (errFilial || !filial) { res.status(500).json({ erro: errFilial?.message || 'Filial não encontrada.' }); return; }
  const cfg = filial.config?.semparar || {};
  if (!cfg.ativo || !cfg.codigoEstabelecimento || !cfg.hash) {
    res.status(400).json({ erro: 'Sem Parar não está configurado/ligado nesta filial.' });
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    codigoEstabelecimento: cfg.codigoEstabelecimento,
    hash: cfg.hash,
  };

  try {
    // Retomando um "recebido" anterior (o Confirma tinha falhado numa
    // tentativa passada): pula direto pra Confirma, sem gerar NSU nem chamar
    // Recebe de novo — reenviar Recebe arriscaria "NSU já utilizado" (63).
    let transactionId = mov.semparar_status === 'recebido' ? mov.semparar_transaction_id : null;
    let nsu = mov.semparar_nsu;

    if (!transactionId) {
      if (mov.semparar_status !== 'autorizado') {
        // Explica o porquê — o Autoriza roda em segundo plano na entrada.
        const porque = {
          negado: 'o Sem Parar não autorizou esta placa na entrada (sem tag ativa ou não habilitada neste estacionamento)',
          erro: 'a consulta ao Sem Parar na entrada falhou (veja o aviso que apareceu na entrada)',
          confirmado: 'esta estadia já foi cobrada pelo Sem Parar',
        }[mov.semparar_status] || 'a placa não passou pela autorização do Sem Parar na entrada (Sem Parar desligado ou sem chave configurada naquele momento)';
        res.status(400).json({ ok: false, erro: `Sem Parar indisponível pra esta placa: ${porque}. Escolha outra forma de pagamento.` });
        return;
      }
      const { data: nsuGerado, error: errNsu } = await supabase.rpc('proximo_nsu_semparar', {
        p_filial: mov.filial_id, p_codigo_estabelecimento: cfg.codigoEstabelecimento,
      });
      if (errNsu) { res.status(500).json({ erro: errNsu.message }); return; }
      nsu = nsuGerado;

      const respRecebe = await fetch(`${baseUrl}/aucloud/v1/estacione/informatizado/recebe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          cdNSU: nsu,
          dataEntrada: dataHoraLocalISO(mov.dt_entrada, Number(mov.hr_entrada)),
          dataSaida: dataHoraLocalISO(dtSaida, Number(hrSaida)),
          token: mov.semparar_token,
          numeroTicket: mov.controle || 0,
          placaVeiculo: mov.placa,
          ...(mov.semparar_sticker ? { sticker: mov.semparar_sticker } : {}),
          valorTransacao: Number(valor),
          tipoTransacao: 'Estadia',
        }),
      });
      const corpoRecebe = await respRecebe.json().catch(() => ({}));
      const dadosRecebe = corpoRecebe?.dados || {};
      const codigoRecebe = codigoRetorno(corpoRecebe);

      if (codigoRecebe !== 0) {
        // Só uma recusa com código trava o Sem Parar nesta estadia. Resposta
        // fora do formato (chave errada, instabilidade) mantém "autorizado"
        // pra tentar de novo depois de corrigir — cada tentativa usa NSU novo.
        if (codigoRecebe != null) {
          await supabase.from('movimentos').update({
            semparar_status: codigoRecebe === 17 ? 'negado' : 'erro', semparar_nsu: nsu,
          }).eq('id', mov.id);
        }
        res.status(200).json({ ok: false, codigoRetorno: codigoRecebe, erro: erroSemParar(respRecebe.status, corpoRecebe) });
        return;
      }
      transactionId = dadosRecebe.transactionID;
      // Guarda o transactionID JÁ AQUI — se o Confirma falhar/der timeout
      // logo abaixo, uma nova tentativa retoma daqui, sem repetir o Recebe.
      await supabase.from('movimentos').update({
        semparar_status: 'recebido', semparar_transaction_id: transactionId, semparar_nsu: nsu, semparar_valor: Number(valor),
      }).eq('id', mov.id);
    }

    const respConfirma = await fetch(`${baseUrl}/aucloud/v1/estacione/informatizado/confirma`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transactionID: transactionId }),
    });
    const corpoConfirma = await respConfirma.json().catch(() => ({}));
    const codigoConfirma = codigoRetorno(corpoConfirma);

    // 94 = retransmissão (já confirmado antes) — trata como sucesso, é
    // exatamente o caso de retomar depois de um timeout no Confirma.
    if (codigoConfirma !== 0 && codigoConfirma !== 94) {
      res.status(200).json({
        ok: false, codigoRetorno: codigoConfirma,
        erro: `Recebido pelo Sem Parar mas a confirmação falhou — tente de novo, não cobra em dobro. ${erroSemParar(respConfirma.status, corpoConfirma)}`,
      });
      return;
    }

    await supabase.from('movimentos').update({
      semparar_status: 'confirmado', semparar_transaction_id: transactionId, semparar_nsu: nsu, semparar_valor: Number(valor),
    }).eq('id', mov.id);
    res.status(200).json({ ok: true, transactionId, nsu });
  } catch (e) {
    res.status(200).json({ ok: false, erro: `Falha de comunicação com o Sem Parar: ${String(e?.message || e)}` });
  }
}
