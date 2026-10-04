import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { interpretarRetornoUninfe, errosDoRetorno } from './uninfeRetorno.js';

// Retorno real do UniNFe (C:\hesta\rps\R_00000002-ret-loterps.xml).
const RECUSADA = '<temp><tipoAmbiente>2</tipoAmbiente><versaoAplicativo>SefinNacional_1.6.0</versaoAplicativo>'
  + '<dataHoraProcessamento>2026-07-02T09:53:06.3546265-03:00</dataHoraProcessamento>'
  + '<idDPS>DPS350950213996911600017900001000000000000002</idDPS>'
  + '<erros><Codigo>E0207</Codigo><Descricao>CPF do tomador não encontrado no cadastro CPF.</Descricao></erros></temp>';

test('interpretarRetornoUninfe: recusa do governo vira erro com código e descrição', async () => {
  const r = await interpretarRetornoUninfe(RECUSADA, 'X-ret-loterps.xml');
  assert.equal(r.status, 'erro');
  assert.equal(r.resumo, 'Recusada: E0207 — CPF do tomador não encontrado no cadastro CPF.');
});

test('interpretarRetornoUninfe: autorizada tira o número de dentro do XML compactado', async () => {
  const nfse = '<NFSe><infNFSe Id="NFS35095021247826100000135000000000008126093572001745"><nNFSe>81</nNFSe></infNFSe></NFSe>';
  const xml = `<temp><chaveAcesso>NFS35095021247826100000135000000000008126093572001745</chaveAcesso><nfseXmlGZipB64>${gzipSync(nfse).toString('base64')}</nfseXmlGZipB64></temp>`;
  const r = await interpretarRetornoUninfe(xml, 'X-ret-loterps.xml');
  assert.equal(r.status, 'autorizada');
  assert.equal(r.numeroNfse, '81');
  assert.equal(r.chaveAcesso, 'NFS35095021247826100000135000000000008126093572001745');
});

test('interpretarRetornoUninfe: autorizada com <nNFSe> direto no retorno', async () => {
  const r = await interpretarRetornoUninfe('<temp><infNFSe Id="NFS35095021247826100000135000000000008126093572001745"><nNFSe>90</nNFSe></infNFSe></temp>', 'X-ret-loterps.xml');
  assert.equal(r.status, 'autorizada');
  assert.equal(r.numeroNfse, '90');
});

test('interpretarRetornoUninfe: .err do UniNFe é erro com o texto', async () => {
  const r = await interpretarRetornoUninfe('Certificado digital não encontrado.', 'X-ret-loterps.err');
  assert.equal(r.status, 'erro');
  assert.match(r.resumo, /^Erro no UniNFe: Certificado digital não encontrado\./);
});

test('interpretarRetornoUninfe: sem erro e sem chave fica indefinido', async () => {
  assert.equal((await interpretarRetornoUninfe('<temp><tipoAmbiente>2</tipoAmbiente></temp>', 'X-ret-loterps.xml')).status, 'indefinido');
});

test('errosDoRetorno: vários erros', () => {
  const xml = '<temp><erros><Codigo>E1</Codigo><Descricao>A</Descricao></erros><erros><Codigo>E2</Codigo><Descricao>B</Descricao></erros></temp>';
  assert.deepEqual(errosDoRetorno(xml), ['E1 — A', 'E2 — B']);
});

test('interpretarRetornoUninfe: .err real do UniNFe destaca só a linha Message', async () => {
  const err = 'Versão UniNFe|5.1.0.154 - 18/06/2026 - 11:30:20\nErrorCode|0000000000\n'
    + 'Message|A tag para assinatura Rps não existe no XML. (Código do Erro: 5)\nStackTrace|   em Unimake.Business...';
  const r = await interpretarRetornoUninfe(err, 'R_00000009-ret-loterps.err');
  assert.equal(r.status, 'erro');
  assert.equal(r.resumo, 'Erro no UniNFe: A tag para assinatura Rps não existe no XML. (Código do Erro: 5)');
});
