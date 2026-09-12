// Impressão via Web Bluetooth (BLE) direto do celular, sem diálogo de
// impressão do sistema. Só funciona em navegadores com Web Bluetooth (Chrome
// Android/desktop com adaptador Bluetooth) — iPhone/Safari bloqueia por
// completo, é restrição da Apple, não dá pra contornar. Impressora Bluetooth
// CLÁSSICA (SPP) também não aparece aqui — a Web Bluetooth só enxerga BLE.
//
// UUID de serviço/característica: usa o padrão das impressoras clone baratas
// (o mesmo chip/firmware genérico "ESC/POS BLE" vendido sob várias marcas).
// Sem a impressora real em mãos ainda pra confirmar — se a que o Eduardo
// comprar usar outro UUID, é só trocar as duas constantes abaixo.
const SERVICO_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const CARACTERISTICA_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

// 180 bytes por bloco causava texto embaralhado/faltando pedaço em impressora
// real (testado pelo Eduardo, 2026-09-12: "Tabela" saiu "abela", "Entrada"
// saiu "trada", trechos viraram "---"). O clone BLE genérico dessas
// impressoras baratas tem uma ponte serial interna que não aguenta receber
// rajadas grandes — mesmo o Web Bluetooth aceitando escrever 180 bytes de
// uma vez (a característica GATT permite), o firmware da impressora não dá
// conta de esvaziar o buffer a tempo e derruba bytes no meio, o que
// desalinha o parser ESC/POS dali pra frente (uma sequência de comando
// cortada no meio faz o resto do texto virar lixo, não só truncar). 20 bytes
// é o payload padrão de MTU do Bluetooth clássico (o que esse tipo de chip
// realmente aguenta, ainda que a API deixe pedir mais) — mesmo valor usado
// por outros apps de impressão térmica Bluetooth com esse chip genérico.
const TAMANHO_BLOCO = 20;
const INTERVALO_ENTRE_BLOCOS_MS = 30;

function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Abre o diálogo de pareamento do navegador e conecta na impressora
 * escolhida. Precisa ser chamado a partir de um clique (gesto do usuário) —
 * o navegador bloqueia se for chamado sozinho, sem interação de quem usa.
 */
export async function conectarImpressoraBluetooth() {
  const dispositivo = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SERVICO_UUID],
  });
  const servidor = await dispositivo.gatt.connect();
  const servico = await servidor.getPrimaryService(SERVICO_UUID);
  const caracteristica = await servico.getCharacteristic(CARACTERISTICA_UUID);
  // Nem toda impressora aceita "sem resposta" (mais rápido) — usa o que a
  // característica anunciar suportar.
  const semResposta = caracteristica.properties?.writeWithoutResponse;

  return {
    nome: dispositivo.name || 'Impressora Bluetooth',
    async enviar(bytes) {
      for (let i = 0; i < bytes.length; i += TAMANHO_BLOCO) {
        const bloco = bytes.slice(i, i + TAMANHO_BLOCO);
        if (semResposta) await caracteristica.writeValueWithoutResponse(bloco);
        else await caracteristica.writeValue(bloco);
        await aguardar(INTERVALO_ENTRE_BLOCOS_MS);
      }
    },
    desconectar() {
      dispositivo.gatt.disconnect();
    },
  };
}
