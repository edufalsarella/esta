// RPS gerados no sistema legado e ainda não convertidos em NFS-e, lidos do
// ESTAMORT.dbf — pra implantação num cliente em uso: entram no app como
// notas "gerada" e são enviadas por aqui. Puro (sem Supabase); a gravação
// fica em src/lib/importacaoDbf.js (importarRpsPendentes).
//
// Pendente = NUMERONF > 0 (o RPS foi emitido; 0 é "sem RPS" nesse campo
// numérico) e NUMNFSE em branco (a prefeitura ainda não devolveu a NFS-e).
import type { RegistroDbf, ValorDbf } from './dbf.ts';

/** Série fixa dos RPS importados — o número é o NUMERONF do legado. */
export const SERIE_RPS_IMPORTADO = '11000';

const CAMPOS_OBRIGATORIOS = ['NUMERONF', 'NUMNFSE', 'VALOR'];

export type RpsPendente = {
  numero_rps: number;
  competencia: string | null;
  valor: number;
  descricao: string | null;
  placa: string | null;
  /** 'A' (a recolher) / 'R' (retido) — campo TIPORECOL do legado. */
  tipoRecol: string | null;
  tomador: {
    cpf_cnpj: string; nome: string; endereco: string; numero: string; bairro: string;
    cep: string; cidade: string; uf: string; email: string; telefone: string;
  };
};

const texto = (v: ValorDbf) => (v == null ? '' : String(v).trim());
const data = (v: ValorDbf) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function detectarRpsPendentes(campos: string[], registros: RegistroDbf[]): { rps: RpsPendente[]; faltandoCampos: string[] } {
  const nomes = new Set(campos.map((c) => c.toUpperCase()));
  const faltandoCampos = CAMPOS_OBRIGATORIOS.filter((c) => !nomes.has(c));
  if (faltandoCampos.length) return { rps: [], faltandoCampos };

  const rps = registros
    .filter((r) => Number(r.NUMERONF) > 0 && !texto(r.NUMNFSE))
    .map((r) => ({
      numero_rps: Number(r.NUMERONF),
      competencia: data(r.DATASAIDA) || data(r.DATA),
      valor: Number(r.VALOR) || 0,
      descricao: texto(r.RPSDESCR) || null,
      placa: texto(r.VEICULO) || null,
      tipoRecol: texto(r.TIPORECOL).toUpperCase() || null,
      tomador: {
        cpf_cnpj: texto(r.CPFCOMPL).replace(/\D/g, ''),
        nome: texto(r.NOMECOMPL),
        endereco: texto(r.ENDECOMPL),
        numero: texto(r.NUMCOMPL),
        bairro: texto(r.BAICOMPL),
        cep: texto(r.CEPCOMPL).replace(/\D/g, ''),
        // CCIDCOMPL é o código SIAFI da cidade (Campinas = 6291), não o IBGE
        // que o DPS pede — o IBGE sai do nome + UF na gravação.
        cidade: texto(r.CIDCOMPL),
        uf: texto(r.ESTACOMPL).toUpperCase(),
        email: texto(r.EMAILCOMPL),
        telefone: texto(r.FONECOMPL),
      },
    }))
    .sort((a, b) => a.numero_rps - b.numero_rps);
  return { rps, faltandoCampos };
}
