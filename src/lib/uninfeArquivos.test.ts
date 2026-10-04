import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enviarPeloUninfe, verificarRetorno, nomeArquivoUninfe } from './uninfeArquivos.js';

/**
 * Pasta de mentira com a mesma API do File System Access usada pelo app.
 * `semMove`: simula navegador sem FileSystemHandle.move (cai no plano B).
 * `datas`: data de alteração por arquivo (padrão: agora).
 */
function pasta(nome, filhos = {}, { semMove = false } = {}) {
  const arquivos = new Map();
  const datas = new Map();
  const dir = {
    kind: 'directory', name: nome, arquivos, datas, filhos,
    async *entries() { for (const [n, h] of Object.entries(filhos)) yield [n, h]; },
    async getDirectoryHandle(n, opts) {
      if (!filhos[n]) {
        if (!opts?.create) throw new Error('NotFound');
        filhos[n] = pasta(n, {}, { semMove });
      }
      return filhos[n];
    },
    async getFileHandle(n, opts) {
      if (!arquivos.has(n) && !opts?.create) throw new Error('NotFound');
      if (!arquivos.has(n)) arquivos.set(n, '');
      const handle = {
        getFile: async () => ({
          text: async () => arquivos.get(n), size: arquivos.get(n).length, lastModified: datas.get(n) ?? Date.now(),
        }),
        createWritable: async () => { let buf = ''; return { write: async (t) => { buf += t; }, close: async () => { arquivos.set(n, buf); } }; },
      };
      if (!semMove) {
        handle.move = async (destino, novoNome) => {
          destino.arquivos.set(novoNome || n, arquivos.get(n));
          arquivos.delete(n);
        };
      }
      return handle;
    },
    async removeEntry(n) { if (!arquivos.delete(n)) throw new Error('NotFound'); },
  };
  return dir;
}

function cenario({ semMove = false } = {}) {
  const envio = pasta('Envio', {}, { semMove }); const retorno = pasta('Retorno'); const erro = pasta('Erro');
  const raiz = pasta('sisparkweb', { Envio: envio, Retorno: retorno, Erro: erro }, { semMove });
  const updates = [];
  const db = { from: () => ({ update: (dados) => ({ eq: async () => { updates.push(dados); return { error: null }; } }) }) };
  return { raiz, envio, retorno, erro, db, updates };
}

const filial = {
  cnpj: '47826100000135', inscricao_mun: '008172390', cod_ibge: '3509502', cep: '13011170',
  config: { nfse: { padrao: 'padrao_nacional_campinas', ambiente: 'homologacao', opSimpNac: '3', codTribNacional: '110101', codTribMunicipal: '001', codNBS: '106043000', perc_iss: 5 } },
};
const nota = { id: 'n1', numero_rps: 2, serie: '10001', competencia: '2026-10-04', valor: 21, aliquota_iss: 2, tomador: {} };

test('nomeArquivoUninfe: R_ + número com 8 dígitos (padrão do sistema antigo)', () => {
  assert.equal(nomeArquivoUninfe(2), 'R_00000002');
});

test('enviarPeloUninfe: grava DPS sem assinatura em Envio, limpa retorno antigo e marca a nota', async () => {
  const c = cenario();
  c.retorno.arquivos.set('R_00000002-ret-loterps.xml', 'retorno velho');
  const r = await enviarPeloUninfe({ raiz: c.raiz, nota, filial, db: c.db });
  assert.equal(r.ok, true);
  const xml = c.envio.arquivos.get('R_00000002-env-loterps.xml');
  assert.match(xml, /^<\?xml[\s\S]*<DPS versao="1\.01"/);
  assert.doesNotMatch(xml, /<Signature/);
  assert.match(xml, /<pAliq>5\.00<\/pAliq>/, 'alíquota da configuração atual');
  assert.equal(c.retorno.arquivos.has('R_00000002-ret-loterps.xml'), false, 'retorno da tentativa anterior apagado');
  assert.equal(c.updates.at(-1).status, 'enviada');
  assert.equal(c.updates.at(-1).lote, 'UNINFE:R_00000002');
});

test('enviarPeloUninfe: configuração incompleta não grava arquivo', async () => {
  const c = cenario();
  const semNbs = { ...filial, config: { nfse: { ...filial.config.nfse, codNBS: '' } } };
  const r = await enviarPeloUninfe({ raiz: c.raiz, nota, filial: semNbs, db: c.db });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Código NBS/);
  assert.equal(c.envio.arquivos.size, 0);
});

test('verificarRetorno: sem retorno ainda → não pronto, nada gravado', async () => {
  const c = cenario();
  const r = await verificarRetorno({ raiz: c.raiz, nota: { ...nota, lote: 'UNINFE:R_00000002' }, db: c.db });
  assert.equal(r.pronto, false);
  assert.equal(c.updates.length, 0);
});

test('verificarRetorno: recusa (retorno real do UniNFe) vira erro com o motivo', async () => {
  const c = cenario();
  c.retorno.arquivos.set('R_00000002-ret-loterps.xml',
    '<temp><idDPS>DPS1</idDPS><erros><Codigo>E0207</Codigo><Descricao>CPF do tomador não encontrado no cadastro CPF.</Descricao></erros></temp>');
  const r = await verificarRetorno({ raiz: c.raiz, nota: { ...nota, lote: 'UNINFE:R_00000002' }, db: c.db });
  assert.equal(r.status, 'erro');
  assert.equal(c.updates[0].status, 'erro');
  assert.match(c.updates[0].retorno, /^Recusada: E0207/);
});

test('verificarRetorno: autorizada grava o número da NFS-e', async () => {
  const c = cenario();
  c.retorno.arquivos.set('R_00000002-ret-loterps.xml', '<temp><infNFSe Id="NFS35095021247826100000135000000000008126093572001745"><nNFSe>82</nNFSe></infNFSe></temp>');
  const r = await verificarRetorno({ raiz: c.raiz, nota: { ...nota, lote: 'UNINFE:R_00000002' }, db: c.db });
  assert.equal(r.status, 'autorizada');
  assert.equal(c.updates[0].status, 'autorizada');
  assert.equal(c.updates[0].numero_nfse, '82');
});

test('verificarRetorno: UniNFe moveu o envio pra Erro sem retorno → erro', async () => {
  const c = cenario();
  c.erro.arquivos.set('R_00000002-env-loterps.xml', '<DPS/>');
  c.erro.datas.set('R_00000002-env-loterps.xml', Date.now() - 5 * 60_000);
  const r = await verificarRetorno({ raiz: c.raiz, nota: { ...nota, lote: 'UNINFE:R_00000002' }, db: c.db });
  assert.equal(r.status, 'erro');
  assert.match(c.updates[0].retorno, /pasta Erro/);
});

test('enviarPeloUninfe: avisa quando falta a subpasta', async () => {
  const c = cenario();
  const raizSemEnvio = pasta('sisparkweb', { Retorno: c.retorno, Erro: c.erro });
  await assert.rejects(enviarPeloUninfe({ raiz: raizSemEnvio, nota, filial, db: c.db }), /Pasta "Envio" não encontrada/);
});

test('enviarPeloUninfe: dhEmi vem da hora informada (servidor), não do relógio do PC', async () => {
  const c = cenario();
  const agora = Date.parse('2026-10-04T16:05:00Z'); // 13:05 em Brasília
  await enviarPeloUninfe({ raiz: c.raiz, nota, filial, db: c.db, agora });
  assert.match(c.envio.arquivos.get('R_00000002-env-loterps.xml'), /<dhEmi>2026-10-04T13:05:00-03:00<\/dhEmi>/);
});

test('enviarPeloUninfe: grava completo em Preparando e MOVE pra Envio (nada fica em Preparando)', async () => {
  const c = cenario();
  await enviarPeloUninfe({ raiz: c.raiz, nota, filial, db: c.db });
  assert.match(c.envio.arquivos.get('R_00000002-env-loterps.xml'), /<DPS/);
  assert.equal(c.raiz.filhos.Preparando.arquivos.size, 0);
});

test('enviarPeloUninfe: sem move no navegador, grava direto em Envio (plano B)', async () => {
  const c = cenario({ semMove: true });
  const r = await enviarPeloUninfe({ raiz: c.raiz, nota, filial, db: c.db });
  assert.equal(r.ok, true);
  assert.match(c.envio.arquivos.get('R_00000002-env-loterps.xml'), /<DPS/);
});

test('verificarRetorno: arquivo vazio ou recente em Erro não vira erro (retorno ainda a caminho)', async () => {
  const c = cenario();
  c.erro.arquivos.set('R_00000002-env-loterps.xml', ''); // vazio, como o que o navegador cria antes de escrever
  assert.equal((await verificarRetorno({ raiz: c.raiz, nota: { ...nota, lote: 'UNINFE:R_00000002' }, db: c.db })).pronto, false);
  c.erro.arquivos.set('R_00000002-env-loterps.xml', '<DPS/>'); // com conteúdo, mas recente
  assert.equal((await verificarRetorno({ raiz: c.raiz, nota: { ...nota, lote: 'UNINFE:R_00000002' }, db: c.db })).pronto, false);
  assert.equal(c.updates.length, 0);
});
