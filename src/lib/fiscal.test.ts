import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAbrasfConsultaResposta, parseAbrasfEnvioResposta, gerarXmlAbrasfLoteRps, codTribMunicipalXml, aliquotaIssConfigurada } from './fiscal.js';

// Respostas reais da IMA/Campinas (homologação), capturadas durante a
// integração — servem de referência do formato que a prefeitura devolve.

test('parseAbrasfEnvioResposta: extrai protocolo do retorno do envio', () => {
  const xml = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns4:RecepcionarLoteRpsResponse xmlns:ns4="http://nfse.abrasf.org.br"><EnviarLoteRpsResposta><NumeroLote>7</NumeroLote><DataRecebimento>2026-08-06T14:01:08</DataRecebimento><Protocolo>056485329</Protocolo><ListaMensagemRetorno/></EnviarLoteRpsResposta></ns4:RecepcionarLoteRpsResponse></soap:Body></soap:Envelope>`;
  const r = parseAbrasfEnvioResposta(xml);
  assert.equal(r.protocolo, '056485329');
  assert.equal(r.numeroLote, '7');
  assert.deepEqual(r.mensagens, []);
});

test('parseAbrasfConsultaResposta: nota autorizada (situação 4)', () => {
  const xml = `<ConsultarLoteRpsResposta><Situacao>4</Situacao><ListaNfse><CompNfse><Nfse><InfNfse Id="596225152"><Numero>716</Numero><CodigoVerificacao>n2DmRiVCF</CodigoVerificacao><DataEmissao>2026-08-06T08:41:27</DataEmissao></InfNfse></Nfse></CompNfse></ListaNfse><ListaMensagemRetorno /></ConsultarLoteRpsResposta>`;
  const r = parseAbrasfConsultaResposta(xml);
  assert.equal(r.situacao, 4);
  assert.equal(r.numeroNfse, '716');
  assert.equal(r.codigoVerificacao, 'n2DmRiVCF');
  assert.equal(r.jaInformado, false);
});

test('parseAbrasfConsultaResposta: RPS já convertido antes (L999) não é erro comum', () => {
  const xml = `<ConsultarLoteRpsResposta><Situacao>3</Situacao><ListaMensagemRetorno><MensagemRetorno><Codigo>L999</Codigo><Mensagem>Tipo: 1 Série: 01 Número: 7 já informado anteriormente</Mensagem><Correcao></Correcao></MensagemRetorno></ListaMensagemRetorno></ConsultarLoteRpsResposta>`;
  const r = parseAbrasfConsultaResposta(xml);
  assert.equal(r.situacao, 3);
  assert.equal(r.jaInformado, true);
  assert.equal(r.mensagens[0].codigo, 'L999');
});

test('parseAbrasfConsultaResposta: rejeição comum continua sendo erro', () => {
  const xml = `<ConsultarLoteRpsResposta><Situacao>3</Situacao><ListaMensagemRetorno><MensagemRetorno><Codigo>E123</Codigo><Mensagem>CNPJ do prestador inválido</Mensagem></MensagemRetorno></ListaMensagemRetorno></ConsultarLoteRpsResposta>`;
  const r = parseAbrasfConsultaResposta(xml);
  assert.equal(r.situacao, 3);
  assert.equal(r.jaInformado, false);
});

test('parseAbrasfConsultaResposta: ainda processando (situação 1/2)', () => {
  const xml = '<ConsultarLoteRpsResposta><Situacao>2</Situacao><ListaMensagemRetorno /></ConsultarLoteRpsResposta>';
  const r = parseAbrasfConsultaResposta(xml);
  assert.equal(r.situacao, 2);
  assert.equal(r.numeroNfse, null);
  assert.equal(r.jaInformado, false);
});

// Regressão: o endereço do tomador usava sempre o município da FILIAL,
// mesmo quando o tomador (mensalista) tinha o dele próprio cadastrado —
// só a competência/valor do serviço (que é sobre onde o estabelecimento
// presta serviço) deve usar o município da filial; o endereço de quem
// está sendo cobrado é dele mesmo.
test('gerarXmlAbrasfLoteRps: endereço do tomador usa o cod_ibge do tomador, não o da filial', () => {
  const filial = { cod_ibge: '3509502', cnpj: '11222333000181', inscricao_mun: '123', config: {} };
  const nota = {
    numero_rps: 7, competencia: '2026-08-15', valor: 50,
    tomador: { cpf_cnpj: '12345678900', nome: 'Fulano', cod_ibge: '3550308', uf: 'SP' },
  };
  const xml = gerarXmlAbrasfLoteRps({ nota, filial });
  // Serviço continua no município da filial (Campinas).
  assert.match(xml, /<MunicipioIncidencia>3509502<\/MunicipioIncidencia>/);
  // Endereço do tomador (logo depois do Bairro, único ponto onde aparece)
  // usa o dele (São Paulo), não o da filial.
  assert.match(xml, /<Bairro>[^<]*<\/Bairro>\s*<CodigoMunicipio>3550308<\/CodigoMunicipio>/);
});

test('gerarXmlAbrasfLoteRps: sem cod_ibge do tomador, cai no da filial (comportamento de sempre)', () => {
  const filial = { cod_ibge: '3509502', cnpj: '11222333000181', inscricao_mun: '123', config: {} };
  const nota = { numero_rps: 7, competencia: '2026-08-15', valor: 50, tomador: { cpf_cnpj: '12345678900', nome: 'Fulano' } };
  const xml = gerarXmlAbrasfLoteRps({ nota, filial });
  assert.match(xml, /<Bairro>[^<]*<\/Bairro>\s*<CodigoMunicipio>3509502<\/CodigoMunicipio>/);
});

// Regressão: retenção de ISS é obrigação do TOMADOR (varia por CNPJ/lei
// municipal, só se descobre quando a prefeitura rejeita um RPS dizendo que
// aquele tomador retém) — antes era só uma preferência fixa da filial
// (config.nfse.abrasf.issRetido), então corrigir pra "retido" numa nota
// specific mudava o padrão pra TODAS as notas da filial.
test('gerarXmlAbrasfLoteRps: issRetido do tomador sobrepõe o padrão da filial', () => {
  const filial = { cod_ibge: '3509502', cnpj: '11222333000181', inscricao_mun: '123', config: { nfse: { abrasf: { issRetido: '2' } } } };
  const nota = {
    numero_rps: 7, competencia: '2026-08-15', valor: 50,
    tomador: { cpf_cnpj: '11222333000199', nome: 'Empresa Tomadora', issRetido: '1' },
  };
  const xml = gerarXmlAbrasfLoteRps({ nota, filial });
  assert.match(xml, /<IssRetido>1<\/IssRetido>/);
});

test('gerarXmlAbrasfLoteRps: sem issRetido no tomador, usa o padrão da filial (comportamento de sempre)', () => {
  const filial = { cod_ibge: '3509502', cnpj: '11222333000181', inscricao_mun: '123', config: { nfse: { abrasf: { issRetido: '1' } } } };
  const nota = { numero_rps: 7, competencia: '2026-08-15', valor: 50, tomador: { cpf_cnpj: '12345678900', nome: 'Fulano' } };
  const xml = gerarXmlAbrasfLoteRps({ nota, filial });
  assert.match(xml, /<IssRetido>1<\/IssRetido>/);
});

test('codTribMunicipalXml: 9 dígitos de Campinas (nacional + municipal) viram os 3 finais', () => {
  assert.equal(codTribMunicipalXml({ codTribMunicipal: '110101001' }), '001');
  assert.equal(codTribMunicipalXml({ codTribMunicipal: '001' }), '001');
  assert.equal(codTribMunicipalXml({ codTribMunicipal: '' }), '');
  assert.equal(codTribMunicipalXml({}), '');
});

test('aliquotaIssConfigurada: ABRASF usa o campo próprio; os padrões nacionais usam perc_iss', () => {
  assert.equal(aliquotaIssConfigurada({ config: { nfse: { perc_iss: '5' } } }), 5);
  assert.equal(aliquotaIssConfigurada({ config: { nfse: { padrao: 'padrao_nacional', perc_iss: 2 } } }), 2);
  assert.equal(aliquotaIssConfigurada({ config: { nfse: { padrao: 'abrasf', perc_iss: 2, abrasf: { percIss: 3 } } } }), 3);
  assert.equal(aliquotaIssConfigurada({ config: { nfse: { padrao: 'abrasf', perc_iss: 2 } } }), 2);
  assert.equal(aliquotaIssConfigurada({}), 0);
});

test('faltasConfigDps: NBS e regime tributário são obrigatórios no DPS', async () => {
  const { faltasConfigDps } = await import('./fiscal.js');
  assert.deepEqual(faltasConfigDps({ config: { nfse: { codNBS: '1.0604.30.00', opSimpNac: '3' } } }), []);
  assert.deepEqual(faltasConfigDps({ config: { nfse: { opSimpNac: '3' } } }), ['Código NBS']);
  assert.deepEqual(faltasConfigDps({}), ['Código NBS', 'Regime tributário (Simples Nacional)']);
});
