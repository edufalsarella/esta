// Envio do DPS pelo UniNFe (Unimake) instalado no computador da cabine — pra
// certificado A3 (cartão/token, só assina onde está plugado) e pra sair pela
// internet do estacionamento. O app grava o DPS SEM assinatura na pasta de
// envio; o UniNFe assina, transmite e devolve o retorno noutra pasta. Mesma
// troca de arquivos que o sistema antigo já usa.
//
// Pastas (criadas à mão e configuradas no UniNFe, na empresa da filial):
//   <pasta escolhida>\Envio    — o app grava R_00000002-env-loterps.xml
//   <pasta escolhida>\Retorno  — o UniNFe devolve R_00000002-ret-loterps.xml/.err
//   <pasta escolhida>\Erro     — o UniNFe move o envio que não conseguiu processar
//
// Acesso à pasta pela File System Access API (Chrome/Edge): o operador
// escolhe a pasta uma vez; o "handle" fica guardado neste navegador
// (IndexedDB) e o navegador só pede pra confirmar a permissão de novo.
import { supabase } from './supabase.js';
import * as arquivos from './uninfeArquivos.js';

const BANCO = 'esta-uninfe';
const CHAVE_PASTA = 'pasta';

export const uninfeSuportado = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;
export const { ehNotaUninfe, nomeArquivoUninfe } = arquivos;

function abrirBanco() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BANCO, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function guardarHandle(handle) {
  const db = await abrirBanco();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, CHAVE_PASTA);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function pastaGuardada() {
  try {
    const db = await abrirBanco();
    return await new Promise((resolve) => {
      const req = db.transaction('handles').objectStore('handles').get(CHAVE_PASTA);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Pede ao operador a pasta do UniNFe (ex.: C:\sisparkweb) e guarda neste navegador. */
export async function escolherPasta() {
  const handle = await window.showDirectoryPicker({ id: 'uninfe', mode: 'readwrite' });
  await guardarHandle(handle);
  return handle;
}

/** 'granted' | 'prompt' | 'denied'. Com `pedir`, abre o pedido de permissão (precisa vir de um clique). */
export async function permissaoPasta(handle, pedir = false) {
  if (!handle) return 'denied';
  const opcoes = { mode: 'readwrite' };
  const atual = await handle.queryPermission(opcoes);
  if (atual === 'granted' || !pedir) return atual;
  return handle.requestPermission(opcoes);
}

/**
 * Hora de emissão do DPS pelo relógio do SERVIDOR (cabeçalho Date da
 * resposta), não do PC da cabine — PC adiantado gera E0008. Um minuto de
 * folga pra trás cobre a precisão de segundos e o tempo até o UniNFe
 * processar. Sem resposta, cai no relógio do PC (com a mesma folga).
 */
async function horaDeEmissao() {
  const FOLGA_MS = 60_000;
  try {
    const resp = await fetch(`${window.location.origin}/?hora=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    const servidor = Date.parse(resp.headers.get('date') || '');
    if (!Number.isNaN(servidor)) return servidor - FOLGA_MS;
  } catch { /* sem rede: usa o relógio do PC */ }
  return Date.now() - FOLGA_MS;
}

/** Grava o DPS em Envio — ver uninfeArquivos.js. */
export const enviarPeloUninfe = async (args) => arquivos.enviarPeloUninfe({ ...args, db: supabase, agora: await horaDeEmissao() });

/** Lê o retorno do UniNFe e atualiza a nota — ver uninfeArquivos.js. */
export const verificarRetorno = (args) => arquivos.verificarRetorno({ ...args, db: supabase });
