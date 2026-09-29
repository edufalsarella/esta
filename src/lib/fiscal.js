// Geração de RPS/NFS-e no Padrão Nacional (Sistema Nacional NFS-e / ADN).
// A ASSINATURA (XMLDSig) e o ENVIO (mTLS) ficam em api/gerar-nfse.js (Node,
// no Vercel — precisa do certificado, que não roda no navegador). Aqui só
// montamos o XML; o status fica 'gerada' até o envio.

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad(v, len) {
  return String(v ?? '').replace(/\D/g, '').padStart(len, '0').slice(-len);
}

/**
 * Id do `infDPS` (45 caracteres: "DPS" + município IBGE(7) + tipo de
 * inscrição federal (1 dígito — "1"=CPF, "2"=CNPJ; invertido do padrão
 * NFe, que usa 1=CNPJ) + CNPJ(14) + série(5) + número(15)) — é o que a
 * assinatura XMLDSig referencia, por isso precisa estar certo.
 */
export function idInfDps({ filial, nota }) {
  const municipio = pad(filial.cod_ibge, 7);
  const cnpj = pad(filial.cnpj, 14);
  const serie = pad(nota.serie, 5);
  const numero = pad(nota.numero_rps, 15);
  return `DPS${municipio}2${cnpj}${serie}${numero}`;
}

// Data/hora local de Brasília em ISO com offset explícito. O Brasil não usa
// mais horário de verão, então -03:00 fixo é seguro por ora.
function agoraISOComFuso() {
  const local = new Date(Date.now() - 3 * 3600000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** Monta o XML do DPS (Declaração de Prestação de Serviço), Padrão Nacional v1.01. */
export function gerarXmlDPS({ nota, filial }) {
  const cfg = filial.config?.nfse || {};
  const tomador = nota.tomador || {};
  const doc = (tomador.cpf_cnpj || '').replace(/\D/g, '');
  const tagDoc = doc.length > 11 ? 'CNPJ' : 'CPF';
  const municipio = pad(filial.cod_ibge, 7);
  const tpAmb = cfg.ambiente === 'producao' ? '1' : '2'; // 1=produção, 2=homologação
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DPS versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse">',
    `  <infDPS Id="${esc(idInfDps({ filial, nota }))}">`,
    `    <tpAmb>${tpAmb}</tpAmb>`,
    `    <dhEmi>${esc(agoraISOComFuso())}</dhEmi>`,
    '    <verAplic>esta-1.0</verAplic>',
    `    <serie>${esc(nota.serie || cfg.serie || '1')}</serie>`,
    `    <nDPS>${esc(nota.numero_rps || '')}</nDPS>`,
    `    <dCompet>${esc(nota.competencia || '')}</dCompet>`,
    '    <tpEmit>1</tpEmit>',
    `    <cLocEmi>${esc(municipio)}</cLocEmi>`,
    '    <prest>',
    `      <CNPJ>${esc((filial.cnpj || '').replace(/\D/g, ''))}</CNPJ>`,
    `      <IM>${esc((filial.inscricao_mun || '').replace(/\D/g, ''))}</IM>`,
    `      <xNome>${esc(filial.razao_social)}</xNome>`,
    '      <end>',
    '        <endNac>',
    // TCEnderNac do XSD v1.01 só tem cMun + CEP — UF aqui é recusado (L9999).
    `          <cMun>${esc(municipio)}</cMun>`,
    `          <CEP>${esc(pad(filial.cep, 8))}</CEP>`,
    '        </endNac>',
    `        <xLgr>${esc(filial.endereco || '')}</xLgr>`,
    `        <nro>${esc(filial.numero || '')}</nro>`,
    `        <xBairro>${esc(filial.bairro || '')}</xBairro>`,
    '      </end>',
    '      <regTrib>',
    `        <opSimpNac>${esc(cfg.opSimpNac || '1')}</opSimpNac>`,
    '        <regEspTrib>0</regEspTrib>',
    '      </regTrib>',
    '    </prest>',
    '    <toma>',
    // Identificação é uma escolha obrigatória: CNPJ | CPF | NIF | cNaoNIF.
    // Sem documento (cliente avulso, comum em estacionamento) usa cNaoNIF=2
    // ("não exigibilidade do NIF") em vez de mandar CPF/CNPJ vazio.
    ...(doc ? [`      <${tagDoc}>${esc(doc)}</${tagDoc}>`] : ['      <cNaoNIF>2</cNaoNIF>']),
    `      <xNome>${esc(tomador.nome || 'CONSUMIDOR')}</xNome>`,
    '    </toma>',
    '    <serv>',
    '      <locPrest>',
    `        <cLocPrestacao>${esc(municipio)}</cLocPrestacao>`,
    '      </locPrest>',
    '      <cServ>',
    `        <cTribNac>${esc(cfg.codTribNacional || '')}</cTribNac>`,
    ...(cfg.codTribMunicipal ? [`        <cTribMun>${esc(cfg.codTribMunicipal)}</cTribMun>`] : []),
    `        <xDescServ>${esc(nota.descricao || 'Estacionamento de veículo')}</xDescServ>`,
    '      </cServ>',
    '    </serv>',
    '    <valores>',
    '      <vServPrest>',
    `        <vServ>${Number(nota.valor || 0).toFixed(2)}</vServ>`,
    '      </vServPrest>',
    '      <trib>',
    '        <tribMun>',
    '          <tribISSQN>1</tribISSQN>', // 1 = operação tributável (sem exportação/imunidade/exigibilidade suspensa)
    '          <tpRetISSQN>1</tpRetISSQN>', // 1 = não retido (o próprio prestador recolhe)
    // tribMun termina em pAliq — nem vBC nem vISSQN pertencem aqui (ambos
    // rejeitados). A ADN provavelmente calcula o ISS a partir da base ×
    // alíquota; se precisar declarar o valor, deve estar noutro lugar do
    // esquema (fora de tribMun) — a confirmar no próximo teste.
    `          <pAliq>${Number(nota.aliquota_iss || cfg.perc_iss || 0).toFixed(2)}</pAliq>`,
    '        </tribMun>',
    '        <tribFed/>', // sem retenção federal — mas o bloco precisa existir mesmo vazio
    '        <totTrib>',
    '          <pTotTrib>',
    // Federal/Estadual/Municipal — aproximado da Lei da Transparência (12.741/2012), a confirmar.
    '            <pTotTribFed>0.00</pTotTribFed>',
    '            <pTotTribEst>0.00</pTotTribEst>',
    '            <pTotTribMun>0.00</pTotTribMun>',
    '          </pTotTrib>',
    '        </totTrib>',
    '      </trib>',
    '    </valores>',
    '  </infDPS>',
    '</DPS>',
  ].join('\n');
}

/** Próximo número de RPS por (filial, série) — read-modify-write (1 operador). */
export async function proximoNumeroRps(supabase, filialId, serie) {
  const { data } = await supabase.from('fiscal_sequencias')
    .select('proximo').eq('filial_id', filialId).eq('serie', serie).maybeSingle();
  if (!data) {
    await supabase.from('fiscal_sequencias').insert({ filial_id: filialId, serie, proximo: 2 });
    return 1;
  }
  const n = data.proximo;
  await supabase.from('fiscal_sequencias').update({ proximo: n + 1 }).eq('filial_id', filialId).eq('serie', serie);
  return n;
}

// ---------------------------------------------------------------------------
// ABRASF 2.03 (Campinas) — é o que está de fato em produção na prefeitura
// hoje (o Padrão Nacional acima ainda não entrou em operação lá). Formato
// abaixo foi construído a partir de XMLs reais gerados pelo sistema legado
// (não do schema genérico ABRASF) — reproduz exatamente o que a prefeitura já
// aceita: sem namespace nas tags de negócio, CNAE de 9 dígitos próprio de
// Campinas (não é o CNAE do IBGE), CodigoTributacaoMunicipio omitido.

/**
 * "1234,56" — moeda com vírgula decimal, usado só no texto da Discriminação.
 * Trunca (não arredonda) — confirmado comparando com XMLs reais: 80×18.07% =
 * 14,456 vira "14,45" (não "14,46" que toFixed daria).
 */
function moedaVirgula(v) {
  return (Math.floor(Number(v || 0) * 100) / 100).toFixed(2).replace('.', ',');
}

/** Texto padrão da Lei 12.741/2012 (Discriminação), no formato que a prefeitura já recebe. */
function discriminacaoAbrasf(descricao, valorServicos, percTributos) {
  const valorTributos = Number(valorServicos || 0) * Number(percTributos || 0) / 100;
  return `${descricao},OBS.:Valor aproximado dos tributos R$ ${moedaVirgula(valorTributos)}(${Number(percTributos || 0).toFixed(2)}%)-Fonte IBTI Lei 12741/2012`;
}

/**
 * Monta o XML de negócio do `EnviarLoteRpsEnvio` (1 RPS por lote — é o que os
 * exemplos reais sempre usam). Ainda não assinado; a assinatura (dupla: RPS e
 * depois lote) é feita em `src/servidor/nfse.js`, que só roda no servidor.
 * `nota.tomador` sem `cpf_cnpj`/endereço vira o mesmo "tomador vazio" que a
 * prefeitura já aceita pra cliente avulso (ao contrário do DPS, que usa
 * `cNaoNIF`, o ABRASF aqui manda o grupo `<Tomador>` com campos em branco).
 */
export function gerarXmlAbrasfLoteRps({ nota, filial }) {
  const cfg = filial.config?.nfse?.abrasf || {};
  const municipio = pad(filial.cod_ibge, 7);
  const cnpjPrestador = (filial.cnpj || '').replace(/\D/g, '');
  const im = (filial.inscricao_mun || '').replace(/\D/g, '');
  const numero = nota.numero_rps;
  const serie = nota.serie || cfg.serie || '99';
  const tomador = nota.tomador || {};
  const docTomador = (tomador.cpf_cnpj || '').replace(/\D/g, '');
  const tagTomador = docTomador.length > 11 ? 'Cnpj' : 'Cpf';
  // Município do endereço do TOMADOR — prefere o dele (cadastro do
  // mensalista, ver Mensalistas.jsx); sem isso, o XML mandava sempre o
  // município da filial pro tomador também, mesmo quando ele é de outra
  // cidade (bug real: rejeição silenciosa/dado fiscal errado na prefeitura).
  const municipioTomador = pad(tomador.cod_ibge || filial.cod_ibge, 7);
  const valorServicos = Number(nota.valor || 0);
  // Prefere o que já veio calculado em `nota` (mesma fonte que grava em
  // notas_fiscais, pra XML e banco nunca divergirem); cfg é só fallback.
  const percIss = Number(nota.aliquota_iss ?? cfg.percIss ?? filial.config?.nfse?.perc_iss ?? 0);
  const valorIss = Number(nota.valor_iss ?? (valorServicos * percIss / 100).toFixed(2));
  const percTrib = Number(cfg.percTributosLei12741 || 0);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    // xmlns="" é necessário: o envelope SOAP (nfse.js) declara xmlns
    // padrão "http://nfse.abrasf.org.br" no elemento pai (o método SOAP),
    // que cascateia pros filhos sem prefixo — mas EnviarLoteRpsEnvio é
    // elementFormDefault="unqualified" no schema (sem namespace nenhum), daí
    // precisa "zerar" o namespace herdado explicitamente. Sem isso a IMA
    // rejeita com "Unmarshalling Error: unexpected element (uri:
    // "http://nfse.abrasf.org.br", local:"EnviarLoteRpsEnvio")".
    `<EnviarLoteRpsEnvio xmlns=""><LoteRps Id="${esc('LOTE_' + numero)}" versao="2.03">`,
    `<NumeroLote>${numero}</NumeroLote>`,
    `<CpfCnpj><Cnpj>${esc(cnpjPrestador)}</Cnpj></CpfCnpj>`,
    `<InscricaoMunicipal>${esc(im)}</InscricaoMunicipal>`,
    '<QuantidadeRps>1</QuantidadeRps>',
    '<ListaRps><Rps>',
    `<InfDeclaracaoPrestacaoServico Id="${esc('RPS' + numero)}">`,
    '<Rps>',
    `<IdentificacaoRps><Numero>${numero}</Numero><Serie>${esc(serie)}</Serie><Tipo>1</Tipo></IdentificacaoRps>`,
    `<DataEmissao>${esc(nota.competencia)}</DataEmissao>`,
    '<Status>1</Status>',
    '</Rps>',
    `<Competencia>${esc(nota.competencia)}</Competencia>`,
    '<Servico>',
    `<Valores><ValorServicos>${valorServicos.toFixed(2)}</ValorServicos><ValorIss>${valorIss.toFixed(2)}</ValorIss><Aliquota>${percIss.toFixed(2)}</Aliquota></Valores>`,
    // Retenção de ISS é do TOMADOR (obrigação dele, por lei municipal — não
    // dá pra saber de antemão, só descobre quando a prefeitura rejeita o RPS
    // dizendo que este tomador retém), não uma preferência fixa da filial.
    // `tomador.issRetido` (editável na correção da nota, ver Fiscal.jsx)
    // sobrepõe o padrão da filial quando setado.
    `<IssRetido>${esc(tomador.issRetido || cfg.issRetido || '2')}</IssRetido>`,
    `<ItemListaServico>${esc(cfg.itemListaServico || '11.01')}</ItemListaServico>`,
    `<CodigoCnae>${esc(cfg.codigoCnae || '')}</CodigoCnae>`,
    `<Discriminacao>${esc(discriminacaoAbrasf(nota.descricao, valorServicos, percTrib))}</Discriminacao>`,
    `<CodigoMunicipio>${esc(municipio)}</CodigoMunicipio>`,
    '<ExigibilidadeISS>1</ExigibilidadeISS>',
    `<MunicipioIncidencia>${esc(municipio)}</MunicipioIncidencia>`,
    '</Servico>',
    `<Prestador><CpfCnpj><Cnpj>${esc(cnpjPrestador)}</Cnpj></CpfCnpj><InscricaoMunicipal>${esc(im)}</InscricaoMunicipal></Prestador>`,
    '<Tomador>',
    `<IdentificacaoTomador><CpfCnpj><${tagTomador}>${esc(docTomador)}</${tagTomador}></CpfCnpj></IdentificacaoTomador>`,
    `<RazaoSocial>${esc(tomador.nome || '')}</RazaoSocial>`,
    '<Endereco>',
    `<Endereco>${esc(tomador.endereco || '')}</Endereco>`,
    `<Numero>${esc(tomador.numero || '')}</Numero>`,
    `<Bairro>${esc(tomador.bairro || '')}</Bairro>`,
    `<CodigoMunicipio>${esc(municipioTomador)}</CodigoMunicipio>`,
    `<Uf>${esc(tomador.uf || filial.uf || '')}</Uf>`,
    `<Cep>${esc(pad(tomador.cep, 8))}</Cep>`,
    '</Endereco>',
    `<Contato><Telefone>${esc(tomador.telefone || '')}</Telefone><Email>${esc(tomador.email || '')}</Email></Contato>`,
    '</Tomador>',
    `<OptanteSimplesNacional>${esc(cfg.optanteSimplesNacional || '1')}</OptanteSimplesNacional>`,
    `<IncentivoFiscal>${esc(cfg.incentivoFiscal || '2')}</IncentivoFiscal>`,
    '</InfDeclaracaoPrestacaoServico>',
    '</Rps></ListaRps></LoteRps></EnviarLoteRpsEnvio>',
  ].join('\n');
}

/** XML de negócio do `ConsultarLoteRpsEnvio` — consulta pelo protocolo devolvido no envio. */
export function gerarXmlAbrasfConsulta({ filial, protocolo }) {
  const cnpjPrestador = (filial.cnpj || '').replace(/\D/g, '');
  const im = (filial.inscricao_mun || '').replace(/\D/g, '');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    // xmlns="" pelo mesmo motivo do EnviarLoteRpsEnvio — ver comentário lá.
    // Sem Id/assinatura — a consulta não é assinada (ver comentário em
    // api/consultar-nfse.js).
    '<ConsultarLoteRpsEnvio xmlns="">',
    `<Prestador><CpfCnpj><Cnpj>${esc(cnpjPrestador)}</Cnpj></CpfCnpj><InscricaoMunicipal>${esc(im)}</InscricaoMunicipal></Prestador>`,
    `<Protocolo>${esc(protocolo)}</Protocolo>`,
    '</ConsultarLoteRpsEnvio>',
  ].join('\n');
}

function extrairTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

function extrairMensagensRetorno(xml) {
  const bloco = xml.match(/<ListaMensagemRetorno>([\s\S]*?)<\/ListaMensagemRetorno>/);
  if (!bloco || !bloco[1].trim()) return [];
  const mensagens = [];
  const re = /<MensagemRetorno>([\s\S]*?)<\/MensagemRetorno>/g;
  let m;
  while ((m = re.exec(bloco[1]))) {
    mensagens.push({ codigo: extrairTag(m[1], 'Codigo'), mensagem: extrairTag(m[1], 'Mensagem') });
  }
  return mensagens;
}

/** Resposta do `RecepcionarLoteRps` — só devolve o protocolo, a nota ainda não saiu. */
export function parseAbrasfEnvioResposta(xml) {
  return {
    numeroLote: extrairTag(xml, 'NumeroLote'),
    protocolo: extrairTag(xml, 'Protocolo'),
    dataRecebimento: extrairTag(xml, 'DataRecebimento'),
    mensagens: extrairMensagensRetorno(xml),
  };
}

/**
 * Resposta do `ConsultarLoteRps`. `situacao`: 1=não recebido, 2=não
 * processado, 3=processado com erro, 4=processado com sucesso (nota saiu).
 *
 * `jaInformado` separa um caso específico de situação 3: o RPS já tinha sido
 * convertido em NFS-e num protocolo anterior ("Tipo: 1 Série: 01 Número: 7 já
 * informado anteriormente"). Não é erro de verdade — a nota existe, só saiu
 * por outro protocolo, e a prefeitura não devolve o número dela aqui.
 */
export function parseAbrasfConsultaResposta(xml) {
  const situacao = extrairTag(xml, 'Situacao');
  const infNfse = xml.match(/<InfNfse[^>]*>([\s\S]*?)<\/InfNfse>/);
  const corpo = infNfse ? infNfse[1] : xml;
  const mensagens = extrairMensagensRetorno(xml);
  return {
    situacao: situacao ? Number(situacao) : null,
    numeroNfse: extrairTag(corpo, 'Numero'),
    codigoVerificacao: extrairTag(corpo, 'CodigoVerificacao'),
    mensagens,
    jaInformado: mensagens.some((m) => /j[áa]\s+informad[oa]\s+anteriormente/i.test(m.mensagem || '')),
  };
}
