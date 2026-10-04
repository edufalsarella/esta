import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarXmlDPS, faltasEnderecoTomador } from './fiscal.js';
import { validarXmlDps } from '../servidor/validarDps.js';

// Assinatura de mentira: o XSD só confere a estrutura do <Signature>, não a criptografia.
const ASSINATURA = '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>'
  + '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>'
  + '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>'
  + '<Reference URI="#x"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms>'
  + '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue></Reference>'
  + '</SignedInfo><SignatureValue>AAAA</SignatureValue></Signature>';

const ENDERECO = { cep: '13015-904', cod_ibge: '3509502', endereco: 'Av. Francisco Glicério', numero: '1269', bairro: 'Centro' };

function dps({ cfg = {}, tomador = {}, serie = '1' } = {}) {
  const filial = {
    cnpj: '47.826.100/0001-35', inscricao_mun: '008172390', cod_ibge: '3509502', cep: '13011-170',
    config: { nfse: { ambiente: 'homologacao', opSimpNac: '3', codTribNacional: '110101', codTribMunicipal: '110101001', codNBS: '1.0604.30.00', perc_iss: 5, ...cfg } },
  };
  const nota = { serie, numero_rps: 7, competencia: '2026-09-30', valor: 21, aliquota_iss: 5, tomador };
  return gerarXmlDPS({ filial, nota }).replace('</DPS>', `${ASSINATURA}</DPS>`);
}

for (const padrao of ['padrao_nacional_campinas', 'padrao_nacional']) {
  for (const [caso, tomador] of Object.entries({
    'sem documento': {},
    CPF: { cpf_cnpj: '123.456.789-09', nome: 'Fulano' },
    CNPJ: { cpf_cnpj: '11.222.333/0001-81', nome: 'Empresa X' },
    'CPF com endereço': { cpf_cnpj: '123.456.789-09', nome: 'Fulano', ...ENDERECO },
    'CNPJ com endereço': { cpf_cnpj: '11.222.333/0001-81', nome: 'Empresa X', ...ENDERECO },
  })) {
    test(`gerarXmlDPS passa no XSD oficial v1.01 (${padrao}, tomador ${caso})`, async () => {
      const r = await validarXmlDps(dps({ cfg: { padrao }, tomador }));
      assert.deepEqual(r.erros, []);
      assert.equal(r.valido, true);
    });
  }
}

test('validarXmlDps: série com 5 dígitos passa (o pattern ^...$ do XSD vale como âncora)', async () => {
  assert.equal((await validarXmlDps(dps({ serie: '10001' }))).valido, true);
});

test('validarXmlDps: erro de configuração diz o campo e onde corrigir', async () => {
  const r = await validarXmlDps(dps({ cfg: { codNBS: '1.0604.30.0' } }));
  assert.equal(r.valido, false);
  assert.match(r.erros.join('\n'), /cNBS.*Código NBS \(Configurações → Fiscal\)/);
});

test('gerarXmlDPS: endereço completo do tomador vai no <end>; incompleto não vai', () => {
  const completo = dps({ tomador: { cpf_cnpj: '12345678909', nome: 'Fulano', ...ENDERECO } });
  assert.match(completo, /<toma>[\s\S]*<end>[\s\S]*<cMun>3509502<\/cMun>[\s\S]*<CEP>13015904<\/CEP>[\s\S]*<\/toma>/);
  const semBairro = dps({ tomador: { cpf_cnpj: '12345678909', nome: 'Fulano', ...ENDERECO, bairro: ' ' } });
  assert.doesNotMatch(semBairro, /<end>/);
});

test('faltasEnderecoTomador: lista o que falta', () => {
  assert.deepEqual(faltasEnderecoTomador({ ...ENDERECO }), []);
  assert.deepEqual(faltasEnderecoTomador({ cpf_cnpj: '12345678909' }), ['CEP', 'cidade', 'logradouro', 'número', 'bairro']);
  assert.deepEqual(faltasEnderecoTomador({ ...ENDERECO, cep: '', numero: '  ' }), ['CEP', 'número']);
});

test('IM do prestador: vai no Padrão Nacional Campinas; no federal só com imNoDps', async () => {
  const campinas = dps({ cfg: { padrao: 'padrao_nacional_campinas' } });
  const federal = dps({ cfg: { padrao: 'padrao_nacional' } });
  const federalComIm = dps({ cfg: { padrao: 'padrao_nacional', imNoDps: true } });
  assert.match(campinas, /<IM>008172390<\/IM>/);
  assert.doesNotMatch(federal, /<IM>/);
  assert.match(federalComIm, /<IM>008172390<\/IM>/);
  assert.equal((await validarXmlDps(federal)).valido, true, 'sem IM continua válido no XSD');
});

test('regApTribSN: vai pra ME/EPP (padrão 1, ou o configurado) na ordem do XSD; não vai pra MEI/não optante', async () => {
  const meEpp = dps({ cfg: { opSimpNac: '3' } });
  assert.match(meEpp, /<opSimpNac>3<\/opSimpNac>\s*<regApTribSN>1<\/regApTribSN>\s*<regEspTrib>/);
  assert.match(dps({ cfg: { opSimpNac: '3', regApTribSN: '2' } }), /<regApTribSN>2<\/regApTribSN>/);
  assert.doesNotMatch(dps({ cfg: { opSimpNac: '2' } }), /<regApTribSN>/);
  assert.doesNotMatch(dps({ cfg: { opSimpNac: '1' } }), /<regApTribSN>/);
  assert.equal((await validarXmlDps(meEpp)).valido, true);
});
