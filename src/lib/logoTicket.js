// Processa a imagem do logo (Configurações) uma única vez no upload — nunca
// na hora de imprimir — e deixa pronta nas duas formas que o ticket precisa:
//   dataUrl    -> pro <img> da impressão em navegador/prévia (cor, qualidade cheia)
//   escposB64  -> bytes do comando GS v 0 (bitmap 1-bit), já em base64, pra
//                 impressora térmica Bluetooth (ver src/lib/escpos.js)
// Fazer a conversão pra ESC/POS aqui (e não em tempo de impressão) evita
// decodificar imagem de novo bytes esperando o operador na cabine.
//
// Tamanho pensado pro tempo de envio Bluetooth: TAMANHO_BLOCO=20 bytes a
// cada 30ms (ver bluetoothPrinter.js) — um bitmap grande demais deixaria o
// logo sozinho levando vários segundos pra sair.
const LARGURA_MAX_ESCPOS = 200;
const ALTURA_MAX_ESCPOS = 100;
const LARGURA_MAX_DISPLAY = 320;
const ALTURA_MAX_DISPLAY = 160;

function lerComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    leitor.readAsDataURL(file);
  });
}

function carregarImagem(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem — confira se o arquivo não está corrompido.'));
    img.src = dataUrl;
  });
}

/** Desenha `img` redimensionada (nunca amplia) num canvas novo, fundo branco (imagem com transparência não vira preto). */
function desenharEmCanvas(img, larguraMax, alturaMax) {
  const escala = Math.min(1, larguraMax / img.width, alturaMax / img.height);
  const largura = Math.max(1, Math.round(img.width * escala));
  const altura = Math.max(1, Math.round(img.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = largura; canvas.height = altura;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, largura, altura);
  ctx.drawImage(img, 0, 0, largura, altura);
  return canvas;
}

/**
 * Canvas -> comando ESC/POS "GS v 0" (bitmap 1-bit, ver folha de comando de
 * qualquer impressora térmica): cada pixel vira 1 bit (preto = imprime),
 * limiar simples de luminância — logo costuma ser alto-contraste, não
 * precisa de dithering.
 */
function canvasParaEscPos(canvas) {
  const { width: largura, height: altura } = canvas;
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, largura, altura);
  const largBytes = Math.ceil(largura / 8);
  const bitmap = new Uint8Array(largBytes * altura);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4;
      const luminancia = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luminancia < 160) bitmap[y * largBytes + (x >> 3)] |= 0x80 >> (x % 8);
    }
  }
  const comando = new Uint8Array(8 + bitmap.length);
  comando.set([0x1d, 0x76, 0x30, 0x00, largBytes & 0xff, (largBytes >> 8) & 0xff, altura & 0xff, (altura >> 8) & 0xff], 0);
  comando.set(bitmap, 8);
  return comando;
}

function bytesParaBase64(bytes) {
  let binario = '';
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

/** `file` (input[type=file]) -> { dataUrl, escposB64, largura, altura } pronto pra salvar em filiais.config.logo. */
export async function converterLogo(file) {
  const dataUrlOriginal = await lerComoDataUrl(file);
  const img = await carregarImagem(dataUrlOriginal);

  const canvasDisplay = desenharEmCanvas(img, LARGURA_MAX_DISPLAY, ALTURA_MAX_DISPLAY);
  const canvasEscPos = desenharEmCanvas(img, LARGURA_MAX_ESCPOS, ALTURA_MAX_ESCPOS);
  const comandoEscPos = canvasParaEscPos(canvasEscPos);

  return {
    dataUrl: canvasDisplay.toDataURL('image/png'),
    escposB64: bytesParaBase64(comandoEscPos),
    largura: canvasEscPos.width,
    altura: canvasEscPos.height,
  };
}

/** `escposB64` salvo -> bytes prontos pra concatenar no fluxo ESC/POS (ver src/lib/escpos.js). */
export function base64ParaBytes(b64) {
  const binario = atob(b64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
