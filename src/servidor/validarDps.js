// Validação do DPS contra o XSD oficial do Sistema Nacional NFS-e antes de
// enviar (src/servidor/xsd = pacote NFSe-ESQUEMAS_XSD-v1.01-20260209, sem
// alteração). A IMA/Campinas valida estritamente por esse XSD e só devolve
// "L9999 Arquivo em desacordo com o XML Schema", sem dizer o campo — aqui o
// erro sai com o elemento exato e, quando vem da configuração, onde corrigir.
import { readFileSync } from 'node:fs';
import { validateXML } from 'xmllint-wasm';

const ARQUIVOS = ['DPS_v1.01.xsd', 'tiposComplexos_v1.01.xsd', 'tiposSimples_v1.01.xsd', 'xmldsig-core-schema.xsd'];

// Campos que vêm de Configurações → Fiscal / Configurações da filial.
const ONDE_CORRIGIR = {
  cTribNac: 'Código de tributação nacional (Configurações → Fiscal)',
  cTribMun: 'Código de tributação municipal (Configurações → Fiscal)',
  cNBS: 'Código NBS (Configurações → Fiscal)',
  pAliq: '% ISS (Configurações → Fiscal)',
  opSimpNac: 'Regime tributário (Configurações → Fiscal)',
  serie: 'Série (Configurações → Fiscal)',
  IM: 'Inscrição municipal da filial (Configurações)',
  CNPJ: 'CNPJ (da filial ou do tomador)',
  CPF: 'CPF do tomador',
  cLocEmi: 'Cidade da filial (Configurações)',
  cLocPrestacao: 'Cidade da filial (Configurações)',
};

let schemas;
function carregarSchemas() {
  schemas ||= ARQUIVOS.map((fileName) => ({
    fileName,
    // A série (TSSerieDPS) vem como pattern "^0{0,4}\d{1,5}$". Em regex de
    // XSD, ^ e $ não são âncoras (o pattern já casa o valor inteiro); o
    // libxml2 os trata como caracteres literais e recusaria toda série, mas
    // .NET e a IMA os tratam como âncora (série 10001 foi autorizada). Tirar
    // os dois dá o mesmo resultado da prefeitura.
    contents: readFileSync(new URL(`./xsd/${fileName}`, import.meta.url), 'utf-8')
      .replace(/pattern value="\^([^"]*)\$"/g, 'pattern value="$1"'),
  }));
  return schemas;
}

/** "Element '{ns}cTribMun': [facet 'pattern'] ..." -> texto sem namespaces + dica de onde corrigir. */
function explicarErro(e) {
  const texto = String(e.message || e.rawMessage || e).replace(/\{http[^}]*\}/g, '').trim();
  const campo = texto.match(/Element '([^']+)'/)?.[1];
  const onde = campo && ONDE_CORRIGIR[campo];
  return onde ? `${texto} → corrigir em: ${onde}` : texto;
}

/** { valido, erros: [texto] } — `xml` é o DPS já assinado, exatamente como vai ser enviado. */
export async function validarXmlDps(xml) {
  const [principal, ...preload] = carregarSchemas();
  const r = await validateXML({ xml: [{ fileName: 'dps.xml', contents: xml }], schema: [principal], preload });
  return { valido: r.valid, erros: (r.errors || []).map(explicarErro) };
}
