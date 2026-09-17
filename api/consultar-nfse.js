// Vercel Function (Node.js) — consulta o resultado de um lote ABRASF já
// enviado (RecepcionarLoteRps é assíncrono: o envio só devolve um protocolo,
// a nota ou o erro só saem aqui, via ConsultarLoteRps). Mesmo certificado
// (mTLS) do envio; ver api/gerar-nfse.js.
import { createClient } from '@supabase/supabase-js';
import { gerarXmlAbrasfConsulta, parseAbrasfConsultaResposta } from '../src/lib/fiscal.js';
import { extrairChaveECertificado, enviarAbrasf, assinarConsultaAbrasf, carregarCertificadoDaFilial } from '../src/servidor/nfse.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Método não suportado.' }); return; }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ erro: 'Faça login no app.' }); return; }

  const { notaId } = req.body || {};
  if (!notaId) { res.status(400).json({ erro: 'notaId é obrigatório.' }); return; }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { res.status(500).json({ erro: 'Falta SUPABASE_SERVICE_ROLE_KEY nas Environment Variables do Vercel.' }); return; }

  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  const { data: nota, error: errNota } = await supabase.from('notas_fiscais').select('*').eq('id', notaId).maybeSingle();
  if (errNota) { res.status(500).json({ erro: errNota.message }); return; }
  if (!nota) { res.status(404).json({ erro: 'Nota não encontrada (ou fora da sua filial).' }); return; }
  if (nota.status !== 'enviada' || !nota.lote) {
    res.status(400).json({ erro: `Nota está "${nota.status}" — só é possível consultar quem está "enviada" com um protocolo (lote).` });
    return;
  }

  const { data: filial, error: errFilial } = await supabase.from('filiais').select('*').eq('id', nota.filial_id).maybeSingle();
  if (errFilial || !filial) { res.status(500).json({ erro: errFilial?.message || 'Filial não encontrada.' }); return; }

  const ambiente = filial.config?.nfse?.ambiente === 'producao' ? 'producao' : 'homologacao';

  const admin = createClient(process.env.VITE_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let pfxBuffer, senha;
  try {
    ({ pfxBuffer, senha } = await carregarCertificadoDaFilial(admin, filial.id));
  } catch (e) {
    res.status(500).json({ erro: String(e?.message || e) });
    return;
  }

  try {
    const { chavePem, certPem } = extrairChaveECertificado(pfxBuffer, senha);
    // Assina o XML solto (com URI="" — ver assinarConsultaAbrasf) e deixa o
    // envelope SOAP pro enviarAbrasf, como no envio.
    const xmlConsulta = gerarXmlAbrasfConsulta({ filial, protocolo: nota.lote });
    const xmlAssinado = assinarConsultaAbrasf(xmlConsulta, { chavePem, certPem });
    const resposta = await enviarAbrasf({ metodo: 'ConsultarLoteRps', xmlNegocio: xmlAssinado, ambiente, pfxBuffer, senha });
    const ehFalhaTransporte = resposta.status < 200 || resposta.status >= 300 || resposta.corpo.includes('<soap:Fault>');
    const parsed = parseAbrasfConsultaResposta(resposta.corpo);

    if (parsed.situacao === 4 && parsed.numeroNfse) {
      await supabase.from('notas_fiscais').update({
        status: 'autorizada', numero_nfse: parsed.numeroNfse, retorno: resposta.corpo,
      }).eq('id', nota.id);
      res.status(200).json({ ok: true, status: 'autorizada', numeroNfse: parsed.numeroNfse, codigoVerificacao: parsed.codigoVerificacao, ambiente });
    } else if (parsed.situacao === 3 && parsed.jaInformado) {
      // "já informado anteriormente" (L999): esse RPS já virou NFS-e num
      // protocolo anterior — não é erro, é duplicidade. Marca com "IA"
      // (Informado Anteriormente) no lugar do número da nota, já que o
      // número real saiu no protocolo antigo e a prefeitura não devolve aqui.
      await supabase.from('notas_fiscais').update({
        status: 'autorizada', numero_nfse: 'IA', retorno: resposta.corpo,
      }).eq('id', nota.id);
      res.status(200).json({ ok: true, status: 'autorizada', numeroNfse: 'IA', jaInformado: true, ambiente });
    } else if (parsed.situacao === 3) {
      // Rejeição de verdade do governo (o lote foi processado e recusado) —
      // aí sim vira "erro" definitivo, com o retorno gravado.
      await supabase.from('notas_fiscais').update({ status: 'erro', retorno: resposta.corpo }).eq('id', nota.id);
      res.status(200).json({ ok: false, status: 'erro', retorno: resposta.corpo, mensagens: parsed.mensagens, ambiente });
    } else if (ehFalhaTransporte) {
      // Falha só na PRÓPRIA chamada de consulta (soap:Fault) — não é um
      // veredito do governo sobre o lote, então NÃO muda o status da nota
      // (ficaria "erro", trocando o botão "Consultar" por "Reenviar" — o
      // operador reenviaria o mesmo RPS de novo por engano, achando que
      // ainda estava consultando). Fica "enviada", só mostra o erro pra
      // tentar consultar de novo depois.
      await supabase.from('notas_fiscais').update({ retorno: resposta.corpo }).eq('id', nota.id);
      res.status(200).json({ ok: false, status: 'falha_consulta', erro: 'A prefeitura recusou a consulta (veja o retorno) — tente de novo daqui a pouco.', retorno: resposta.corpo, ambiente });
    } else {
      // 1 (não recebido) ou 2 (não processado) — ainda processando, tenta de novo depois.
      await supabase.from('notas_fiscais').update({ retorno: resposta.corpo }).eq('id', nota.id);
      res.status(200).json({ ok: true, status: 'enviada', situacao: parsed.situacao, ambiente });
    }
  } catch (e) {
    // Exceção local (rede, assinatura, etc.) — diferente de "ainda
    // processando" (situação 1/2) ou "rejeitada" (situação 3). Antes isso
    // caía silenciosamente no "ainda processando" do front, escondendo o
    // erro real e sem nem gravar no banco (por isso o retorno ficava com o
    // conteúdo antigo do envio).
    const mensagem = String(e?.message || e);
    await supabase.from('notas_fiscais').update({ retorno: `Falha ao consultar: ${mensagem}` }).eq('id', nota.id);
    res.status(200).json({ ok: false, status: 'falha_consulta', erro: mensagem, ambiente });
  }
}
