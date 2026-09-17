// Assinatura (XMLDSig) e transmissão (mTLS) do DPS pro Sistema Nacional NFS-e
// (ADN). SÓ roda em Node (Vercel Function, api/gerar-nfse.js) — nunca é
// importado por telas/componentes, então nunca entra no bundle do navegador.
// O certificado (.pfx) e a senha vêm de fiscal_certificados (um por filial —
// ver carregarCertificadoDaFilial e 0054_fiscal_certificado.sql), nunca do
// código nem de variável de ambiente.
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import { gzipSync } from 'node:zlib';
import https from 'node:https';

/**
 * Busca o certificado (.pfx em base64 + senha) da filial, usando o client de
 * `service_role` (fiscal_certificados não tem NENHUMA policy de RLS pra
 * `authenticated` — ver 0054_fiscal_certificado.sql). Quem chama precisa ter
 * confirmado ANTES, com o client normal (com RLS), que `filialId` é mesmo a
 * filial de quem fez a requisição — este client de serviço bypassa RLS
 * inteira, então a checagem de "é dessa filial mesmo?" tem que vir de fora.
 */
export async function carregarCertificadoDaFilial(admin, filialId) {
  const { data, error } = await admin.from('fiscal_certificados')
    .select('pfx_b64, senha').eq('filial_id', filialId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Certificado fiscal não configurado pra esta filial (Configurações → Fiscal, só o fornecedor).');
  return { pfxBuffer: Buffer.from(data.pfx_b64, 'base64'), senha: data.senha };
}

/**
 * Extrai a chave privada (PEM) e o certificado (PEM) de um .pfx (PKCS#12).
 * Certificados A1 de verdade costumam trazer a cadeia inteira (o certificado
 * do titular + o(s) certificado(s) da AC emissora) dentro do mesmo .pfx — por
 * isso não basta pegar "o certificado que apareceu no arquivo": tem que ser
 * o que corresponde à chave privada extraída (mesmo módulo RSA).
 */
export function extrairChaveECertificado(pfxBuffer, senha) {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);

  let chave = null;
  const certificados = [];
  for (const safeContents of p12.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag || safeBag.type === forge.pki.oids.keyBag) {
        chave = safeBag.key;
      } else if (safeBag.type === forge.pki.oids.certBag) {
        certificados.push(safeBag.cert);
      }
    }
  }
  if (!chave || certificados.length === 0) throw new Error('Não achei chave privada e certificado no .pfx (senha errada ou arquivo inválido).');

  const certificado = certificados.length === 1
    ? certificados[0]
    : certificados.find((c) => c.publicKey.n.equals(chave.n)) || certificados[0];
  // O padrão de assinatura das notas fiscais brasileiras é "EndCertOnly":
  // só o certificado do titular vai na assinatura, nunca a cadeia da AC
  // (tentei incluir a cadeia inteira antes — no ABRASF isso faz o envio ser
  // rejeitado na hora, então vale pros dois padrões).

  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certPem: forge.pki.certificateToPem(certificado),
  };
}

/**
 * Assina, com XMLDSig, o elemento identificado por `localName` (casado pelo
 * atributo Id dele): assinatura enveloped, canonicalização C14N padrão,
 * RSA-SHA1/SHA1 — é o que a documentação do padrão de assinatura das notas
 * fiscais brasileiras descreve (junto com EndCertOnly, ver
 * extrairChaveECertificado). Testei RSA-SHA256 antes por suposição; voltando
 * ao documentado. Genérico o bastante pra assinar `infDPS` (Padrão
 * Nacional), `LoteRps`/`ConsultarLoteRpsEnvio` (ABRASF).
 *
 * `action`: 'after' (padrão) insere a assinatura como irmã, logo depois do
 * elemento assinado — certo quando ele tem um elemento pai (ex.: `LoteRps`
 * dentro de `EnviarLoteRpsEnvio`). 'append' insere como último FILHO —
 * obrigatório quando o elemento assinado é a raiz do documento (ex.:
 * `ConsultarLoteRpsEnvio`), já que XML só pode ter uma raiz — tentar 'after'
 * nesse caso dá "Hierarchy request error: Only one element can be added and
 * only after doctype" (descobri testando de verdade contra a IMA).
 */
function assinarElementoPorLocalName(xml, { localName, chavePem, certPem, action = 'after' }) {
  const xpath = `//*[local-name(.)='${localName}']`;
  const sig = new SignedXml({
    privateKey: chavePem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xml, { location: { reference: xpath, action } });
  return sig.getSignedXml();
}

export function assinarXmlDps(xml, { chavePem, certPem }) {
  return assinarElementoPorLocalName(xml, { localName: 'infDPS', chavePem, certPem });
}

/**
 * O manual ABRASF 2.03 genérico (§3.2.3) descreve assinatura em dois passos
 * (RPS isolado, depois o lote) — mas a IMA rejeitou isso em teste real
 * ("Arquivo enviado com erro na assinatura"), e a thread do grupo
 * wsnfsecampinas é específica sobre Campinas: pra envio em lote
 * (`RecepcionarLoteRps`), assina-se só `LoteRps` — não
 * `InfDeclaracaoPrestacaoServico` isoladamente (isso seria só pro envio de
 * RPS único, método `GerarNfse`, que este app não usa).
 *
 * Testei a cadeia completa no KeyInfo (`certPemCadeia`) — piorou: o envio,
 * que já ia com sucesso só com o certificado do titular, passou a ser
 * rejeitado na hora. EndCertOnly (`certPem`) é o certo aqui também, igual
 * ao Padrão Nacional.
 */
export function assinarLoteAbrasf(xmlLote, { chavePem, certPem }) {
  return assinarElementoPorLocalName(xmlLote, { localName: 'LoteRps', chavePem, certPem });
}

/**
 * Confere a própria assinatura de um XML já assinado — igual um verificador
 * de terceiros faria: reextrai o certificado do KeyInfo (não usa
 * `chavePem`/`certPem` do app), recalcula o digest de cada Reference e
 * confere a SignatureValue. Serve pra descobrir se um "erro na assinatura"
 * que o governo devolve é um bug real daqui (a autoverificação também
 * falharia) ou algo específico do validador deles (a autoverificação passa
 * mesmo assim).
 */
export function autoverificarAssinatura(xmlAssinado) {
  try {
    const doc = new DOMParser().parseFromString(xmlAssinado);
    // checkSignature não acha o <Signature> sozinho a partir só da string —
    // precisa localizar o nó primeiro (loadSignature) antes de conferir.
    const signatureNode = xpath.select1("//*[local-name(.)='Signature']", doc);
    if (!signatureNode) return { valido: false, erro: 'Nenhum <Signature> encontrado no XML.' };
    // getCertFromKeyInfo precisa ser habilitado explicitamente (não é o
    // padrão da lib, por segurança) pra extrair o certificado embutido no
    // KeyInfo em vez de exigir um publicCert já conhecido de antemão — é
    // assim que um verificador de terceiros faria, sem conhecer o
    // certificado previamente.
    const sig = new SignedXml({ getCertFromKeyInfo: SignedXml.getCertFromKeyInfo });
    sig.loadSignature(signatureNode);
    const valido = sig.checkSignature(xmlAssinado);
    return { valido };
  } catch (e) {
    return { valido: false, erro: String(e?.message || e) };
  }
}

/**
 * A consulta TAMBÉM precisa ser assinada — confirmado pelo suporte da
 * prefeitura ("sim, os métodos de consulta também devem ser assinados"),
 * apesar de o manual genérico (§4.5.6) não mostrar campo de Signature em
 * ConsultarLoteRpsEnvio.
 *
 * Duas diferenças em relação ao envio, as duas por causa do mesmo detalhe:
 * `ConsultarLoteRpsEnvio` NÃO tem atributo `Id` no schema (o `LoteRps` tem).
 *
 * 1. Referência `URI=""` (documento inteiro), não `#Id`. Sem forçar isso, o
 *    xml-crypto inventa um Id ("_0") e referencia "#_0" — atributo que o
 *    schema não permite e ID que o validador da prefeitura não reconhece.
 * 2. Assina o XML solto (não o envelope). Com `URI=""` o C14N cobre a raiz
 *    do documento, onde o `xmlns=""` é redundante e acaba descartado — que é
 *    exatamente a orientação do grupo wsnfsecampinas ("pra Consulta não se
 *    deve incluir o namespace na assinatura"), mantendo o `xmlns=""` no XML
 *    transmitido, que o unmarshalling exige.
 */
export function assinarConsultaAbrasf(xmlConsulta, { chavePem, certPem }) {
  const xpath = "//*[local-name(.)='ConsultarLoteRpsEnvio']";
  const sig = new SignedXml({
    privateKey: chavePem,
    publicCert: certPem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });
  sig.addReference({
    xpath,
    // URI="" (documento inteiro) em vez de "#Id": ConsultarLoteRpsEnvio não
    // tem atributo Id no schema (diferente de LoteRps, que tem). Sem passar
    // isso explicitamente, o xml-crypto INVENTA um Id ("_0") e referencia
    // "#_0" — atributo que o schema não permite e ID que o validador da
    // prefeitura não reconhece.
    uri: '',
    isEmptyUri: true,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });
  sig.computeSignature(xmlConsulta, { location: { reference: xpath, action: 'append' } });
  return sig.getSignedXml();
}

/** Gzip + base64 — formato exigido pela ADN pra tudo (envio e retorno). */
export function gzipBase64(texto) {
  return gzipSync(Buffer.from(texto, 'utf-8')).toString('base64');
}

// URLs do webservice próprio de Campinas (hospedado pela IMA), padrão
// "Padrão Nacional Campinas" — mesmo layout de XML/API do Sistema Nacional
// NFS-e, mas endpoint próprio da prefeitura (é o que o erro E0039 sinalizava
// quando se tentou o endpoint nacional compartilhado por engano). ABRASF e o
// endpoint nacional compartilhado (sefin.nfse.gov.br) ainda não têm URL
// confirmada pra Campinas — api/gerar-nfse.js bloqueia esses dois padrões
// antes de chegar aqui (ver `padrao` em filial.config.nfse).
//
// "notafiscal-ws" (era "notafiscal-adn-ws"): trecho da URL trocado pra
// conformidade com o layout nacional (aviso oficial recebido em 2026-08-31).
// Homologação ainda redireciona da URL antiga pra não quebrar quem estava
// configurado nela, mas produção pode não ter esse redirect — por isso as
// duas já saem atualizadas aqui.
const URL_POR_AMBIENTE = {
  homologacao: 'https://preprod-nfse.ima.sp.gov.br/notafiscal-ws/api/adn/dps',
  producao: 'https://novanfse.campinas.sp.gov.br/notafiscal-ws/api/adn/dps',
};

/**
 * Envia o DPS já assinado pra ADN via mTLS (o certificado autentica a própria
 * conexão HTTPS — não é um token). Resposta é síncrona: já vem com a NFS-e
 * autorizada, ou o erro/rejeição.
 */
export function enviarDps({ xmlAssinado, ambiente, pfxBuffer, senha }) {
  const url = URL_POR_AMBIENTE[ambiente] || URL_POR_AMBIENTE.homologacao;
  const agent = new https.Agent({ pfx: pfxBuffer, passphrase: senha });
  const corpo = JSON.stringify({ dpsXmlGZipB64: gzipBase64(xmlAssinado) });

  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', agent, headers: { 'Content-Type': 'application/json' } }, (resp) => {
      let dados = '';
      resp.on('data', (chunk) => { dados += chunk; });
      resp.on('end', () => {
        resolve({ status: resp.statusCode, corpo: dados });
      });
    });
    req.on('error', reject);
    req.write(corpo);
    req.end();
  });
}

// ABRASF 2.03 (Campinas) — webservice próprio da IMA (mesmo domínio do
// Padrão Nacional Campinas), mas protocolo SOAP 1.1, document/literal
// wrapped, confirmado pelo WSDL real (soapAction="" em todas as operações).
const URL_ABRASF_POR_AMBIENTE = {
  homologacao: 'https://homol-rps.ima.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap',
  producao: 'https://novanfse.campinas.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap',
};

/**
 * O corpo SOAP é `<Metodo xmlns="http://nfse.abrasf.org.br">{xmlNegocio}
 * </Metodo>` — sem prefixo de namespace nas tags de negócio (confirmado
 * pelos XMLs reais capturados do sistema legado, que não têm nenhum xmlns).
 * `xmlNegocio` já vem com a declaração `<?xml ...?>` de `gerarXmlAbrasf*`
 * (útil quando salvo/comparado isolado) — precisa sair daqui, porque só pode
 * existir uma no início do documento inteiro (o envelope SOAP).
 */
export function envelopeSoapAbrasf(metodo, xmlNegocio) {
  const semDeclaracao = xmlNegocio.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${metodo} xmlns="http://nfse.abrasf.org.br">${semDeclaracao}</${metodo}></soap:Body></soap:Envelope>`;
}

/**
 * Envia `xmlNegocio` (já assinado, quando o método exigir) pro webservice
 * ABRASF via SOAP + mTLS — mesmo certificado/mecanismo de `enviarDps` (o
 * manual ABRASF exige certificado digital tanto pra assinatura quanto pra
 * transmissão). `metodo`: "RecepcionarLoteRps" ou "ConsultarLoteRps".
 */
export function enviarAbrasf({ metodo, xmlNegocio, envelopePronto, ambiente, pfxBuffer, senha }) {
  const url = URL_ABRASF_POR_AMBIENTE[ambiente] || URL_ABRASF_POR_AMBIENTE.homologacao;
  const agent = new https.Agent({ pfx: pfxBuffer, passphrase: senha });
  // `envelopePronto` é pra quando a assinatura precisou ser feita já dentro do
  // envelope (consulta — ver assinarConsultaAbrasf): embrulhar de novo aqui
  // mudaria os bytes assinados.
  const corpo = envelopePronto || envelopeSoapAbrasf(metodo, xmlNegocio);

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST', agent,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    }, (resp) => {
      let dados = '';
      resp.on('data', (chunk) => { dados += chunk; });
      resp.on('end', () => resolve({ status: resp.statusCode, corpo: dados }));
    });
    req.on('error', reject);
    req.write(corpo);
    req.end();
  });
}
