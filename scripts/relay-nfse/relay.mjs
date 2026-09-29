// Relay do envio de DPS pelo Padrão Nacional (sefin.*.nfse.gov.br).
//
// O Serpro não aceita conexão vinda da AWS, onde a Vercel roda. Este relay
// fica num servidor cujo IP o Serpro aceita: a Vercel abre um WebSocket até
// aqui e o relay liga esse túnel numa conexão TCP com o Serpro na porta 443.
// O TLS (com o certificado do cliente) é negociado pela Vercel por dentro do
// túnel — este processo só repassa bytes cifrados, nunca vê certificado nem
// conteúdo de nota.
//
// Uso (Node 18+, na pasta do repositório depois de `npm install`):
//   RELAY_TOKEN=<segredo longo> PORT=8787 node scripts/relay-nfse/relay.mjs
// O mesmo segredo vai na Vercel como NFSE_RELAY_TOKEN, e o endereço público
// deste servidor (ex.: https://relay.seudominio.com.br) como NFSE_RELAY_URL.
import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, createWebSocketStream } from 'ws';

const TOKEN = process.env.RELAY_TOKEN || '';
const PORTA = Number(process.env.PORT || 8787);
// Só estes destinos — sem isso o relay viraria um proxy aberto.
const HOSTS_PERMITIDOS = new Set(['sefin.producaorestrita.nfse.gov.br', 'sefin.nfse.gov.br']);

if (TOKEN.length < 24) {
  console.error('Defina RELAY_TOKEN com pelo menos 24 caracteres.');
  process.exit(1);
}

function autorizado(req) {
  const recebido = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
  const esperado = Buffer.from(TOKEN);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

function testarTcp(host, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const socket = net.connect({ host, port: 443 });
    const fim = (r) => { socket.destroy(); resolve({ host, ...r, ms: Date.now() - inicio }); };
    socket.setTimeout(timeoutMs, () => fim({ ok: false, erro: 'timeout' }));
    socket.once('connect', () => fim({ ok: true }));
    socket.once('error', (e) => fim({ ok: false, erro: e.code || e.message }));
  });
}

const servidor = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://relay');
  if (pathname !== '/saude') { res.writeHead(404).end(); return; }
  if (!autorizado(req)) { res.writeHead(401).end(); return; }
  const conexoes = await Promise.all([...HOSTS_PERMITIDOS].map((h) => testarTcp(h)));
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, conexoes }));
});

const wss = new WebSocketServer({ noServer: true });

servidor.on('upgrade', (req, socket, head) => {
  // Cliente que fecha a conexão no meio (ou depois do 403) gera ECONNRESET —
  // sem este handler, derruba o processo inteiro.
  socket.on('error', () => {});
  const url = new URL(req.url, 'http://relay');
  const host = url.searchParams.get('host');
  if (url.pathname !== '/tunel' || !autorizado(req) || !HOSTS_PERMITIDOS.has(host)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const tunel = createWebSocketStream(ws);
    const destino = net.connect({ host, port: 443 });
    const encerrar = () => { tunel.destroy(); destino.destroy(); };
    ws.on('error', encerrar);
    tunel.on('error', encerrar);
    destino.on('error', (e) => { console.error(`[${new Date().toISOString()}] ${host}: ${e.code || e.message}`); encerrar(); });
    destino.setTimeout(60000, encerrar);
    tunel.pipe(destino).pipe(tunel);
    console.log(`[${new Date().toISOString()}] túnel -> ${host}`);
  });
});

servidor.listen(PORTA, () => console.log(`Relay NFS-e ouvindo na porta ${PORTA}`));
