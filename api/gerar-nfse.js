// Vercel Function (Node.js) — assina o DPS e envia pra ADN (Sistema Nacional
// NFS-e). Só existe aqui porque precisa do certificado digital (mTLS) e de
// assinatura XMLDSig — nada disso pode rodar no navegador.
//
// Variáveis de ambiente exigidas (Vercel -> Project Settings -> Environment
// Variables; nunca comitar, nunca colar num chat):
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY   (já configuradas pro app)
//   SUPABASE_SERVICE_ROLE_KEY                    (pra ler fiscal_certificados — ver certificado-fiscal.js)
import { createClient } from '@supabase/supabase-js';
import { gerarXmlDPS, gerarXmlAbrasfLoteRps, parseAbrasfEnvioResposta, aliquotaIssConfigurada, faltasEnderecoTomador, faltasConfigDps } from '../src/lib/fiscal.js';
import { extrairChaveECertificado, assinarXmlDps, enviarDps, numeroNfseDoRetorno, assinarLoteAbrasf, enviarAbrasf, autoverificarAssinatura, carregarCertificadoDaFilial } from '../src/servidor/nfse.js';
import { validarXmlDps } from '../src/servidor/validarDps.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Método não suportado.' }); return; }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ erro: 'Faça login no app.' }); return; }

  const { notaId } = req.body || {};
  if (!notaId) { res.status(400).json({ erro: 'notaId é obrigatório.' }); return; }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { res.status(500).json({ erro: 'Falta SUPABASE_SERVICE_ROLE_KEY nas Environment Variables do Vercel.' }); return; }

  // createClient com o token do usuário: as consultas abaixo respeitam a
  // mesma RLS por filial de sempre — a function não usa chave de serviço
  // pra nada além de buscar o certificado (fiscal_certificados não tem RLS
  // pra authenticated de propósito, ver 0054_fiscal_certificado.sql).
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  const { data: nota, error: errNota } = await supabase.from('notas_fiscais').select('*').eq('id', notaId).maybeSingle();
  if (errNota) { res.status(500).json({ erro: errNota.message }); return; }
  if (!nota) { res.status(404).json({ erro: 'Nota não encontrada (ou fora da sua filial).' }); return; }
  if (!['gerada', 'erro'].includes(nota.status)) {
    res.status(400).json({ erro: `Nota está "${nota.status}" — só é possível enviar quem está "gerada" (ou reenviar quem deu "erro").` });
    return;
  }

  const { data: filial, error: errFilial } = await supabase.from('filiais').select('*').eq('id', nota.filial_id).maybeSingle();
  if (errFilial || !filial) { res.status(500).json({ erro: errFilial?.message || 'Filial não encontrada.' }); return; }

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

  const ambiente = filial.config?.nfse?.ambiente === 'producao' ? 'producao' : 'homologacao';
  const padrao = filial.config?.nfse?.padrao || 'padrao_nacional_campinas';

  // Alíquota da configuração ATUAL, não a de quando a nota foi gerada: se a
  // prefeitura recusou por alíquota errada, o cliente corrige em
  // Configurações → Fiscal e o reenvio já sai certo.
  const aliquotaIss = aliquotaIssConfigurada(filial);
  if (Number(nota.aliquota_iss) !== aliquotaIss) {
    nota.aliquota_iss = aliquotaIss;
    nota.valor_iss = Number((Number(nota.valor) * aliquotaIss / 100).toFixed(2));
    await supabase.from('notas_fiscais').update({ aliquota_iss: nota.aliquota_iss, valor_iss: nota.valor_iss }).eq('id', nota.id);
  }

  try {
    const { chavePem, certPem } = extrairChaveECertificado(pfxBuffer, senha);

    if (padrao === 'abrasf') {
      // Assíncrono: este envio só entrega o protocolo do lote. A nota (ou o
      // erro) só sai depois, via ConsultarLoteRps (api/consultar-nfse.js).
      const xml = gerarXmlAbrasfLoteRps({ nota, filial });
      const xmlAssinado = assinarLoteAbrasf(xml, { chavePem, certPem });

      // Diagnóstico: confere a própria assinatura antes de gastar uma
      // chamada real pra IMA — se isso falhar, o bug é daqui (não do
      // validador deles). Ver comentário de autoverificarAssinatura.
      const autoverificacao = autoverificarAssinatura(xmlAssinado);
      if (!autoverificacao.valido) {
        await supabase.from('notas_fiscais').update({
          status: 'erro', xml: xmlAssinado,
          retorno: `Autoverificação da assinatura falhou (bug local, não chegou a mandar pra prefeitura): ${autoverificacao.erro || 'checkSignature retornou false'}`,
        }).eq('id', nota.id);
        res.status(200).json({ ok: false, status: 'erro', erro: 'Autoverificação da assinatura falhou — veja o retorno.', ambiente });
        return;
      }

      const resposta = await enviarAbrasf({ metodo: 'RecepcionarLoteRps', xmlNegocio: xmlAssinado, ambiente, pfxBuffer, senha });
      const parsed = parseAbrasfEnvioResposta(resposta.corpo);

      if (resposta.status >= 200 && resposta.status < 300 && parsed.protocolo) {
        await supabase.from('notas_fiscais').update({
          status: 'enviada', xml: xmlAssinado, lote: parsed.protocolo, retorno: resposta.corpo,
        }).eq('id', nota.id);
        res.status(200).json({ ok: true, status: 'enviada', protocolo: parsed.protocolo, ambiente });
      } else {
        await supabase.from('notas_fiscais').update({ status: 'erro', xml: xmlAssinado, retorno: resposta.corpo }).eq('id', nota.id);
        res.status(200).json({ ok: false, status: 'erro', retorno: resposta.corpo, ambiente });
      }
      return;
    }

    const faltasConfig = faltasConfigDps(filial);
    if (faltasConfig.length) {
      const mensagem = `Configuração fiscal incompleta — falta: ${faltasConfig.join(', ')}. `
        + 'Preencha em Configurações → Fiscal e reenvie. Não foi enviado à prefeitura.';
      await supabase.from('notas_fiscais').update({ status: 'erro', retorno: mensagem }).eq('id', nota.id);
      res.status(200).json({ ok: false, status: 'erro', erro: mensagem, ambiente });
      return;
    }

    // Tomador identificado sem endereço completo: Campinas recusa com CPF ou
    // CNPJ ("Estado deve ser informado"); a regra nacional exige com CNPJ.
    // Barra antes, dizendo o que falta, em vez do L9999.
    const docTomador = String(nota.tomador?.cpf_cnpj || '').replace(/\D/g, '');
    const faltas = faltasEnderecoTomador(nota.tomador || {});
    if (docTomador && faltas.length && (padrao !== 'padrao_nacional' || docTomador.length === 14)) {
      const mensagem = `Tomador com ${docTomador.length === 14 ? 'CNPJ' : 'CPF'} sem endereço completo — falta: ${faltas.join(', ')}. `
        + 'Complete em Fiscal → Alterar (na linha desta nota) e reenvie. Não foi enviado à prefeitura.';
      await supabase.from('notas_fiscais').update({ status: 'erro', retorno: mensagem }).eq('id', nota.id);
      res.status(200).json({ ok: false, status: 'erro', erro: mensagem, ambiente });
      return;
    }

    // Gera de novo (não reaproveita nota.xml) pra sempre refletir a config
    // fiscal atual e um dhEmi fresco, mesmo que a nota já tivesse um XML antigo.
    const xml = gerarXmlDPS({ nota, filial });
    const xmlAssinado = assinarXmlDps(xml, { chavePem, certPem });

    // A prefeitura valida pelo XSD oficial e só devolve um L9999 genérico —
    // valida aqui antes, com o campo exato e onde corrigir, sem gastar envio.
    // Se o próprio validador falhar (ex.: schema não empacotado), não trava o
    // envio — a prefeitura continua validando do lado dela.
    let validacao = { valido: true, erros: [] };
    try {
      validacao = await validarXmlDps(xmlAssinado);
    } catch (e) {
      console.error('validarXmlDps falhou, enviando sem validação prévia:', e);
    }
    if (!validacao.valido) {
      await supabase.from('notas_fiscais').update({
        status: 'erro', xml: xmlAssinado,
        retorno: `XML fora do schema oficial (NFS-e Nacional v1.01) — NÃO foi enviado à prefeitura. Corrija e reenvie:\n${validacao.erros.join('\n')}`,
      }).eq('id', nota.id);
      res.status(200).json({ ok: false, status: 'erro', erro: `XML fora do schema oficial, não foi enviado: ${validacao.erros[0] || ''} (veja o retorno na linha da nota).`, ambiente });
      return;
    }

    const resposta = await enviarDps({ xmlAssinado, ambiente, pfxBuffer, senha, padrao });
    let corpo;
    try { corpo = JSON.parse(resposta.corpo); } catch { corpo = { bruto: resposta.corpo }; }

    if (resposta.status >= 200 && resposta.status < 300 && corpo.nfseXmlGZipB64) {
      // A chave de acesso continua no retorno (JSON inteiro); o número
      // (nNFSe) só existe dentro do XML autorizado.
      const numeroNfse = numeroNfseDoRetorno(corpo);
      await supabase.from('notas_fiscais').update({
        status: 'autorizada', xml: xmlAssinado,
        numero_nfse: numeroNfse || corpo.chaveAcesso || null,
        retorno: JSON.stringify(corpo),
      }).eq('id', nota.id);
      res.status(200).json({ ok: true, status: 'autorizada', numeroNfse, chaveAcesso: corpo.chaveAcesso, ambiente });
    } else {
      // Fora do Simples o grupo IBS/CBS já é obrigatório em 2026 e o app ainda
      // não gera (Simples: só em 2027) — provável causa da recusa, fica anotado.
      const obsIbsCbs = filial.config?.nfse?.opSimpNac === '1'
        ? '\n\nObs.: empresa fora do Simples Nacional — o grupo IBS/CBS (Reforma Tributária), obrigatório para não optantes, ainda não é gerado pelo esta; a recusa pode ser por isso.'
        : '';
      await supabase.from('notas_fiscais').update({
        status: 'erro', xml: xmlAssinado, retorno: JSON.stringify(corpo) + obsIbsCbs,
      }).eq('id', nota.id);
      res.status(200).json({ ok: false, status: 'erro', retorno: corpo, ambiente });
    }
  } catch (e) {
    const mensagem = String(e?.message || e);
    await supabase.from('notas_fiscais').update({ status: 'erro', retorno: mensagem }).eq('id', nota.id);
    res.status(200).json({ ok: false, status: 'erro', erro: mensagem, ambiente });
  }
}
