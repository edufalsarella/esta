import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buscarCep } from './cep.js';

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

function respostas(porUrl) {
  globalThis.fetch = async (url) => {
    const r = Object.entries(porUrl).find(([parte]) => url.includes(parte))?.[1];
    if (r instanceof Error) throw r;
    return { ok: (r?.status ?? 200) < 400, status: r?.status ?? 200, json: async () => r?.corpo };
  };
}

test('buscarCep: ViaCEP traz endereço e código IBGE', async () => {
  respostas({ viacep: { corpo: { logradouro: 'Avenida Anchieta', bairro: 'Centro', localidade: 'Campinas', uf: 'SP', ibge: '3509502' } } });
  assert.deepEqual(await buscarCep('13015-904'),
    { endereco: 'Avenida Anchieta', bairro: 'Centro', cidade: 'Campinas', uf: 'SP', cod_ibge: '3509502' });
});

test('buscarCep: CEP inexistente não cai na reserva', async () => {
  respostas({ viacep: { corpo: { erro: 'true' } }, brasilapi: { corpo: { city: 'Não devia usar', ibge: { city: '3509502' } } } });
  assert.deepEqual(await buscarCep('99999999'), { erro: 'CEP não encontrado.' });
});

test('buscarCep: ViaCEP fora do ar usa a BrasilAPI', async () => {
  respostas({
    viacep: new Error('rede'),
    brasilapi: { corpo: { street: 'Rua X', neighborhood: 'Centro', city: 'Campinas', state: 'SP', ibge: { city: '3509502' } } },
  });
  assert.deepEqual(await buscarCep('13015904'),
    { endereco: 'Rua X', bairro: 'Centro', cidade: 'Campinas', uf: 'SP', cod_ibge: '3509502' });
});

test('buscarCep: menos de 8 dígitos nem consulta', async () => {
  respostas({});
  assert.deepEqual(await buscarCep('1301'), { erro: 'CEP deve ter 8 dígitos.' });
});
