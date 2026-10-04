// Interpreta o que o UniNFe devolve na pasta Retorno depois de transmitir o
// DPS (Padrão Nacional / Nacional Campinas). Puro (sem navegador), testável.
//
// Formatos (conferidos em arquivos reais do UniNFe):
//   ID-ret-loterps.xml — resposta do governo convertida pra <temp>: com
//     <erros><Codigo/><Descricao/></erros> quando recusou; com a chave de
//     acesso (e o XML da NFS-e) quando autorizou.
//   ID-ret-loterps.err — erro do próprio UniNFe (validação, certificado,
//     comunicação): texto livre.

const tag = (xml, nome) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`, 'i'))?.[1]?.trim() || null;

/** "E0207 — CPF do tomador não encontrado…" de cada erro do <temp>. */
export function errosDoRetorno(xml) {
  const blocos = [...xml.matchAll(/<(?:\w+:)?(erros?|Erro)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/gi)].map((m) => m[2]);
  return blocos
    .map((b) => [tag(b, 'Codigo'), tag(b, 'Descricao') || tag(b, 'Mensagem'), tag(b, 'Complemento')].filter(Boolean).join(' — '))
    .filter(Boolean);
}

async function gunzipBase64(b64) {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * { status: 'autorizada' | 'erro' | 'indefinido', numeroNfse, chaveAcesso, resumo }
 * a partir do conteúdo e do nome do arquivo de retorno.
 */
export async function interpretarRetornoUninfe(texto, nomeArquivo) {
  if (/\.err$/i.test(nomeArquivo)) {
    return { status: 'erro', resumo: `Erro no UniNFe: ${texto.trim().slice(0, 1000)}` };
  }
  const erros = errosDoRetorno(texto);
  if (erros.length) return { status: 'erro', resumo: `Recusada: ${erros.join(' · ')}` };

  const chaveAcesso = tag(texto, 'chaveAcesso') || texto.match(/Id="(NFS\d{50})"/)?.[1] || null;
  let numeroNfse = tag(texto, 'nNFSe');
  const gz = tag(texto, 'nfseXmlGZipB64');
  if (!numeroNfse && gz) {
    try { numeroNfse = tag(await gunzipBase64(gz), 'nNFSe'); } catch { /* fica só com a chave */ }
  }
  if (chaveAcesso || numeroNfse) {
    return { status: 'autorizada', numeroNfse, chaveAcesso, resumo: `Autorizada${numeroNfse ? ` — NFS-e nº ${numeroNfse}` : ''}` };
  }
  return { status: 'indefinido', resumo: 'Retorno do UniNFe sem erro e sem chave da NFS-e — confira o retorno.' };
}
