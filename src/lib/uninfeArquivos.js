// Troca de arquivos com o UniNFe (ver src/lib/uninfe.js): grava o DPS sem
// assinatura em Envio e lê o retorno. Recebe o client do banco (`db`) por
// parâmetro — sem depender do app, dá pra testar com pasta e banco simulados.
import { aliquotaIssConfigurada, gerarXmlDPS, problemaAntesDeEnviarDps } from './fiscal.js';
import { interpretarRetornoUninfe } from './uninfeRetorno.js';

export const PREFIXO_LOTE = 'UNINFE:';
export const ehNotaUninfe = (nota) => String(nota?.lote || '').startsWith(PREFIXO_LOTE);
export const nomeArquivoUninfe = (numeroRps) => `R_${String(numeroRps).padStart(8, '0')}`;

async function subpasta(raiz, nome) {
  for await (const [entrada, h] of raiz.entries()) {
    if (h.kind === 'directory' && entrada.toLowerCase() === nome.toLowerCase()) return h;
  }
  throw new Error(`Pasta "${nome}" não encontrada dentro de "${raiz.name}" — crie Envio, Retorno e Erro e configure o UniNFe com elas.`);
}

async function lerArquivo(dir, nome) {
  try {
    return await (await (await dir.getFileHandle(nome)).getFile()).text();
  } catch {
    return null;
  }
}

async function apagar(dir, nome) {
  try { await dir.removeEntry(nome); } catch { /* não existia */ }
}

async function escrever(dir, nome, conteudo) {
  const arquivo = await dir.getFileHandle(nome, { create: true });
  const escrita = await arquivo.createWritable();
  await escrita.write(conteudo);
  await escrita.close();
  return arquivo;
}

/**
 * O navegador cria o arquivo VAZIO e só depois troca pelo conteúdo: gravando
 * direto em Envio, o UniNFe pegava o vazio (ia pra Erro, 0 bytes) e só via o
 * arquivo certo na varredura seguinte, ~1 min depois. Grava completo numa
 * pasta de preparo (fora do Envio) e MOVE pra Envio — o UniNFe já vê pronto.
 * Se mover não funcionar neste navegador, grava direto (como antes).
 */
async function gravarEmEnvio({ raiz, envio, nomeArquivo, conteudo }) {
  try {
    const preparo = await raiz.getDirectoryHandle('Preparando', { create: true });
    await apagar(preparo, nomeArquivo);
    const arquivo = await escrever(preparo, nomeArquivo, conteudo);
    if (typeof arquivo.move !== 'function') throw new Error('sem move');
    await apagar(envio, nomeArquivo);
    await arquivo.move(envio, nomeArquivo);
    return;
  } catch {
    // segue pro plano B
  }
  await escrever(envio, nomeArquivo, conteudo);
}

/** Texto + tamanho + data de alteração, ou null se não existe. */
async function infoArquivo(dir, nome) {
  try {
    const f = await (await dir.getFileHandle(nome)).getFile();
    return { texto: await f.text(), tamanho: f.size, modificado: f.lastModified };
  } catch {
    return null;
  }
}

/**
 * Monta o DPS sem assinatura e grava em Envio. A nota fica "enviada"
 * (lote = UNINFE:R_xxxxxxxx) até o retorno aparecer (ver verificarRetorno).
 * Devolve { ok, erro }.
 */
export async function enviarPeloUninfe({ raiz, nota, filial, db, agora }) {
  // Mesma regra do envio pelo Vercel (api/gerar-nfse.js): alíquota da
  // configuração atual e as conferências de antes do envio.
  const aliquota = aliquotaIssConfigurada(filial);
  const atual = { ...nota, aliquota_iss: aliquota, valor_iss: Number((Number(nota.valor) * aliquota / 100).toFixed(2)) };
  const problema = problemaAntesDeEnviarDps({ nota: atual, filial });
  if (problema) {
    const erro = `${problema} Não foi enviado ao UniNFe.`;
    await db.from('notas_fiscais').update({ status: 'erro', retorno: erro }).eq('id', nota.id);
    return { ok: false, erro };
  }

  const nome = nomeArquivoUninfe(nota.numero_rps);
  const [envio, retorno, erroDir] = await Promise.all([subpasta(raiz, 'Envio'), subpasta(raiz, 'Retorno'), subpasta(raiz, 'Erro')]);
  // O nome se repete no reenvio: o retorno da tentativa anterior não pode
  // ser lido como resposta desta.
  for (const dir of [retorno, erroDir]) {
    await apagar(dir, `${nome}-ret-loterps.xml`);
    await apagar(dir, `${nome}-ret-loterps.err`);
  }
  await apagar(erroDir, `${nome}-env-loterps.xml`);

  const xml = gerarXmlDPS({ nota: atual, filial, agora });
  await gravarEmEnvio({ raiz, envio, nomeArquivo: `${nome}-env-loterps.xml`, conteudo: xml });

  const { error } = await db.from('notas_fiscais').update({
    status: 'enviada', lote: `${PREFIXO_LOTE}${nome}`, xml, retorno: null,
    aliquota_iss: atual.aliquota_iss, valor_iss: atual.valor_iss,
  }).eq('id', nota.id);
  if (error) return { ok: false, erro: `Arquivo gravado pro UniNFe, mas a nota não foi atualizada: ${error.message}` };
  return { ok: true };
}

/**
 * Procura o retorno do UniNFe desta nota (Retorno ou Erro). Achando,
 * atualiza a nota e devolve { pronto: true, status, resumo }; senão
 * { pronto: false } — o UniNFe ainda não processou (está aberto?).
 */
export async function verificarRetorno({ raiz, nota, db }) {
  const nome = String(nota.lote).slice(PREFIXO_LOTE.length);
  const [retorno, erroDir] = await Promise.all([subpasta(raiz, 'Retorno'), subpasta(raiz, 'Erro')]);
  for (const dir of [retorno, erroDir]) {
    for (const arquivo of [`${nome}-ret-loterps.xml`, `${nome}-ret-loterps.err`]) {
      const texto = await lerArquivo(dir, arquivo);
      if (texto == null) continue;
      const r = await interpretarRetornoUninfe(texto, arquivo);
      const retornoGravado = `${r.resumo}\n\n${texto}`;
      if (r.status === 'autorizada') {
        await db.from('notas_fiscais').update({
          status: 'autorizada', numero_nfse: r.numeroNfse || r.chaveAcesso || null, retorno: retornoGravado,
        }).eq('id', nota.id);
      } else if (r.status === 'erro') {
        await db.from('notas_fiscais').update({ status: 'erro', retorno: retornoGravado }).eq('id', nota.id);
      }
      // 'indefinido' não grava nada: a verificação roda de tempos em tempos.
      return { pronto: r.status !== 'indefinido', ...r };
    }
  }
  // O UniNFe moveu o envio pra Erro sem gerar retorno. Só conta com arquivo
  // de verdade (não vazio) e parado há 2 min: o vazio é o que o navegador
  // cria antes de escrever, e o retorno certo ainda pode estar a caminho.
  const noErro = await infoArquivo(erroDir, `${nome}-env-loterps.xml`);
  if (noErro && noErro.tamanho > 0 && Date.now() - noErro.modificado > 120_000) {
    const resumo = 'O UniNFe moveu o arquivo pra pasta Erro sem retorno — confira o UniNFe (certificado, configuração da empresa).';
    await db.from('notas_fiscais').update({ status: 'erro', retorno: resumo }).eq('id', nota.id);
    return { pronto: true, status: 'erro', resumo };
  }
  return { pronto: false };
}
