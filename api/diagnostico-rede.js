// Diagnóstico de rede da Vercel Function: em que região roda, com que IP sai
// pra internet e se consegue abrir conexão TCP com os webservices fiscais.
// Alvos fixos (nada vem da requisição) e nenhum segredo é lido — só serve pra
// saber se um timeout no envio é bloqueio de rede do lado do governo.
import net from 'node:net';
import dns from 'node:dns/promises';

const ALVOS = [
  'sefin.producaorestrita.nfse.gov.br',
  'sefin.nfse.gov.br',
  'preprod-nfse.ima.sp.gov.br',
  'novanfse.campinas.sp.gov.br',
];

function testarTcp(host, porta = 443, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const socket = net.connect({ host, port: porta });
    const fim = (resultado) => { socket.destroy(); resolve({ ...resultado, ms: Date.now() - inicio }); };
    socket.setTimeout(timeoutMs, () => fim({ ok: false, erro: 'timeout' }));
    socket.once('connect', () => fim({ ok: true }));
    socket.once('error', (e) => fim({ ok: false, erro: e.code || e.message }));
  });
}

export default async function handler(req, res) {
  let ipSaida = null;
  try {
    ipSaida = (await (await fetch('https://api.ipify.org?format=json')).json()).ip;
  } catch (e) {
    ipSaida = `erro: ${e.message}`;
  }

  const conexoes = await Promise.all(ALVOS.map(async (host) => {
    let ips = [];
    try { ips = await dns.resolve4(host); } catch (e) { ips = [`erro: ${e.code}`]; }
    return { host, ips, ...(await testarTcp(host)) };
  }));

  // Com relay configurado (ver scripts/relay-nfse/relay.mjs), mostra também
  // se o servidor do relay alcança o Serpro — é por ele que o Padrão Nacional sai.
  let relay = null;
  if (process.env.NFSE_RELAY_URL) {
    try {
      const resp = await fetch(`${process.env.NFSE_RELAY_URL.replace(/\/+$/, '')}/saude`, {
        headers: { Authorization: `Bearer ${process.env.NFSE_RELAY_TOKEN || ''}` },
        signal: AbortSignal.timeout(20000),
      });
      relay = resp.ok ? await resp.json() : { ok: false, erro: `HTTP ${resp.status}` };
    } catch (e) {
      relay = { ok: false, erro: e.message };
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ regiao: process.env.VERCEL_REGION || null, ipSaida, conexoes, relay });
}
