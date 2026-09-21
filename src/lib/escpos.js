// Converte um modelo de ticket (mesmo motor de src/lib/modeloTicket.js) em
// comandos ESC/POS crus — usado pra imprimir via Bluetooth direto do celular
// (ver src/lib/bluetoothPrinter.js), sem passar pelo diálogo de impressão do
// navegador. É mais um "consumidor" do renderizarModelo(), no mesmo espírito
// de modeloParaTexto (WhatsApp) e modeloParaHtml (Ticket.jsx) — o motor de
// tokens continua sendo o único lugar que interpreta @TOKEN@/@SE(...)@/etc.
import { renderizarModelo } from './modeloTicket.js';
import { CP850_ALTA } from '../../packages/dbf/dbf.ts';

const ESC = 0x1b, GS = 0x1d, LF = 0x0a, INTERROGACAO = 0x3f;

// Inverte a tabela de decodificação do leitor de DBF (que já é a fonte da
// verdade pra CP850 neste projeto) — evita transcrever os ~130 acentos à mão
// e arriscar um byte errado, que só apareceria como um acento trocado no
// papel impresso.
const CP850_BYTE_POR_CODEPOINT = new Map();
CP850_ALTA.forEach((codepoint, i) => {
  if (!CP850_BYTE_POR_CODEPOINT.has(codepoint)) CP850_BYTE_POR_CODEPOINT.set(codepoint, 0x80 + i);
});

function codificarTexto(texto) {
  const bytes = [];
  for (const ch of String(texto ?? '')) {
    const cp = ch.codePointAt(0);
    bytes.push(cp < 0x80 ? cp : (CP850_BYTE_POR_CODEPOINT.get(cp) ?? INTERROGACAO));
  }
  return bytes;
}

/**
 * Comandos pra sair do conjunto de estilos `antes` e entrar em `depois` —
 * só liga/desliga o que realmente mudou. 'pequeno'/'italico'/'usuario' não
 * têm comando ESC/POS mapeado (a maioria das impressoras baratas não separa
 * itálico) — o trecho sai em tamanho normal, sem erro.
 */
function comandosDeTransicao(antes, depois) {
  const bytes = [];
  const tinha = (s) => antes.includes(s);
  const tem = (s) => depois.includes(s);
  if (tem('negrito') !== tinha('negrito')) bytes.push(ESC, 0x45, tem('negrito') ? 1 : 0);
  if (tem('sublinhado') !== tinha('sublinhado')) bytes.push(ESC, 0x2d, tem('sublinhado') ? 1 : 0);
  if (tem('grande') !== tinha('grande')) bytes.push(GS, 0x21, tem('grande') ? 0x11 : 0x00); // largura x2 + altura x2
  return bytes;
}

/**
 * Modelo + dados -> bytes ESC/POS prontos pra mandar pra impressora (ver
 * bluetoothPrinter.js). Sem comando de corte — a maioria das térmicas
 * portáteis Bluetooth não tem guilhotina; só alimenta um pouco no fim pra
 * facilitar destacar na mão.
 */
export function modeloParaEscPos(conteudo, dados) {
  const bytes = [ESC, 0x40, ESC, 0x74, 2]; // ESC @ (inicializa) + ESC t 2 (codepage 850)
  let estiloAtual = [];
  for (const trechos of renderizarModelo(conteudo, dados)) {
    if (!trechos.length) { bytes.push(LF); continue; }
    for (const t of trechos) {
      // Logo (@LOGO@ — ver modeloTicket.js): bitmap já pronto (GS v 0,
      // convertido no upload em Configurações, ver logoTicket.js), não passa
      // por codificarTexto nem por comando de estilo nenhum.
      if (t.imagemEscPos) { bytes.push(...t.imagemEscPos); continue; }
      bytes.push(...comandosDeTransicao(estiloAtual, t.estilos));
      estiloAtual = t.estilos;
      bytes.push(...codificarTexto(t.texto));
    }
    bytes.push(...comandosDeTransicao(estiloAtual, []));
    estiloAtual = [];
    bytes.push(LF);
  }
  bytes.push(LF, LF, LF, LF);
  return new Uint8Array(bytes);
}
