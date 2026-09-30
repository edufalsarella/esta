// Mapeamento DBF -> colunas do esta, pra importação de Mensalistas e Modelos
// de veículo. Puro (sem Supabase) — a gravação fica em src/lib/importacaoDbf.js.
import type { RegistroDbf, ValorDbf } from './dbf.ts';

export type TipoColuna = 'texto' | 'number' | 'bool' | 'data';
export type ColunaDestino = {
  campo: string;
  rotulo: string;
  tipo?: TipoColuna;      // default: 'texto'
  obrigatorio?: boolean;  // sem valor -> linha rejeitada
  padrao?: ValorDbf;      // aplicado quando a coluna é NOT NULL no banco e o dbf não trouxe valor
  palpites?: string[];    // nomes de campo do dbf tentados automaticamente (case-insensitive)
  /**
   * Linha só entra na importação se o valor desta coluna (já convertido)
   * bater com este texto — ou com UM dos textos, quando é lista (comparação
   * sem diferenciar maiúsc./minúsc.). Ex.: ESTACONV.dbf mistura convênio,
   * vale e serviço na mesma tabela, distinguidos pelo campo TIPO
   * ('C'/'V'/'S'): "Serviços" filtra 'S', "Convênios e vales" filtra
   * ['C', 'V'].
   */
  filtro?: string | string[];
  /**
   * Coluna auxiliar (ex.: o próprio campo do filtro acima) que não é coluna
   * de verdade da tabela de destino — fica de fora do INSERT.
   */
  naoGravar?: boolean;
};

export type Destino = {
  rotulo: string;
  tabela: string;
  colunas: ColunaDestino[];
  /**
   * 'cadastro' (padrão): cria registro novo em `tabela`, ignorando código já
   * existente. 'veiculos_extra': não cria nada em `tabela` — cada linha vira
   * um veículo (mensalista_veiculos) de um mensalista que JÁ existe, achado
   * pelo campo `codigo_mestre` (ver ESTASUBS.dbf, CARMESTRE/CARSUBST/NOMECAR).
   * 'tabela_preco': foge do resto do mapeamento coluna-a-coluna — ver
   * packages/dbf/tabelaPreco.ts (formato "largo" do ESTAHORA, detectado
   * direto pelos nomes de campo, não escolhido à mão). `colunas` fica vazio
   * pra esse tipo, só existe aqui pra aparecer no seletor "O que importar?".
   */
  tipoImportacao?: 'cadastro' | 'veiculos_extra' | 'tabela_preco' | 'rps_pendentes';
};

export const DESTINOS: Record<string, Destino> = {
  mensalistas: {
    rotulo: 'Mensalistas',
    tabela: 'mensalistas',
    colunas: [
      { campo: 'codigo', rotulo: 'Código (= placa do veículo principal)', obrigatorio: true, palpites: ['VEICULO', 'CODIGO'] },
      // O ESTAEMPR também tem NOMECAR — modelo do veículo PRINCIPAL (o mesmo
      // campo é reaproveitado no ESTASUBS pro modelo de cada veículo EXTRA,
      // ver mensalista_veiculos_extra abaixo). Não é coluna de `mensalistas`
      // (isso é do veículo, não da pessoa) — importacaoDbf.js tira esse
      // campo antes de inserir e usa à parte, junto com o código/placa, pra
      // criar a linha do veículo principal em `mensalista_veiculos`.
      { campo: 'modelo', rotulo: 'Modelo do veículo principal', palpites: ['NOMECAR'] },
      { campo: 'razao', rotulo: 'Nome', obrigatorio: true, palpites: ['RAZAO', 'NOME'] },
      { campo: 'tipo_mens', rotulo: 'Tipo (I/P/H)', palpites: ['TIPOMENS'], padrao: 'I' },
      { campo: 'cpf_cnpj', rotulo: 'CPF/CNPJ', palpites: ['CPF', 'CGC', 'CNPJ'] },
      { campo: 'telefone', rotulo: 'Telefone', palpites: ['TELEFONE', 'FONE'] },
      { campo: 'celular', rotulo: 'Celular', palpites: ['CELULAR'] },
      { campo: 'email', rotulo: 'E-mail', palpites: ['EMAIL'] },
      { campo: 'endereco', rotulo: 'Endereço', palpites: ['ENDERECO'] },
      { campo: 'numero', rotulo: 'Número', palpites: ['NUMERO', 'NUM'] },
      { campo: 'bairro', rotulo: 'Bairro', palpites: ['BAIRRO'] },
      { campo: 'cidade', rotulo: 'Cidade', palpites: ['CIDADE'] },
      { campo: 'uf', rotulo: 'UF', palpites: ['UF', 'ESTADO'] },
      { campo: 'cep', rotulo: 'CEP', palpites: ['CEP'] },
      { campo: 'box', rotulo: 'Box', palpites: ['BOX'] },
      { campo: 'valor_mensalidade', rotulo: 'Valor da mensalidade', tipo: 'number', palpites: ['VALOR', 'VLRMES', 'VLRMES01'], padrao: 0 },
      { campo: 'proximo_pagamento', rotulo: 'Data do próximo pagamento', tipo: 'data', palpites: ['DIA', 'PROXVENC', 'DTVENC', 'DATAVENC', 'VENCIMENTO'] },
      { campo: 'dia_venc', rotulo: 'Dia vencimento', tipo: 'number', palpites: ['DIAVENC'] },
      { campo: 'tolerancia_dias', rotulo: 'Tolerância (dias)', tipo: 'number', palpites: ['TOLERANCIA'], padrao: 0 },
      { campo: 'multa_pct', rotulo: 'Multa %', tipo: 'number', palpites: ['MULTA'], padrao: 0 },
      { campo: 'juros_pct', rotulo: 'Juros %', tipo: 'number', palpites: ['JUROS'], padrao: 0 },
      { campo: 'qte_vagas', rotulo: 'Vagas contratadas', tipo: 'number', palpites: ['QTEVAGAS'], padrao: 1 },
      { campo: 'restr_manha', rotulo: 'Restrição manhã', palpites: ['RESTRM'] },
      { campo: 'restr_tarde', rotulo: 'Restrição tarde', palpites: ['RESTRT'] },
      { campo: 'restr_noite', rotulo: 'Restrição noite', palpites: ['RESTRN'] },
      { campo: 'periodo1', rotulo: 'Período 1', tipo: 'number', palpites: ['PERIODO1'], padrao: 0 },
      { campo: 'periodo2', rotulo: 'Período 2', tipo: 'number', palpites: ['PERIODO2'], padrao: 0 },
      { campo: 'periodo3', rotulo: 'Período 3', tipo: 'number', palpites: ['PERIODO3'], padrao: 0 },
      { campo: 'hora_extra', rotulo: 'Hora extra', tipo: 'bool', palpites: ['HORAEXTRA'], padrao: false },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool', palpites: ['ATIVO'], padrao: true },
    ],
  },
  // ESTASUBS.dbf: 1 linha por veículo além do principal (sem o limite de
  // 2 placas inline do ESTAEMPR). CARMESTRE liga ao mensalista pelo código
  // dele (o veículo principal — ver `mensalistas.codigo` acima); o mensalista
  // já precisa existir, então importar ESTAEMPR antes deste.
  mensalista_veiculos_extra: {
    rotulo: 'Veículos extras dos mensalistas (ESTASUBS)',
    tabela: 'mensalista_veiculos',
    tipoImportacao: 'veiculos_extra',
    colunas: [
      { campo: 'codigo_mestre', rotulo: 'Código do mensalista (carro mestre)', obrigatorio: true, palpites: ['CARMESTRE'] },
      { campo: 'placa', rotulo: 'Placa', obrigatorio: true, palpites: ['CARSUBST'] },
      { campo: 'modelo', rotulo: 'Modelo', palpites: ['NOMECAR'] },
    ],
  },
  modelos_veiculo: {
    rotulo: 'Modelos de veículo',
    tabela: 'modelos_veiculo',
    colunas: [
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true, palpites: ['CODIGO'] },
      { campo: 'nome', rotulo: 'Modelo', obrigatorio: true, palpites: ['CARRO'] },
      { campo: 'tabela_tipo', rotulo: 'Tabela padrão', palpites: ['TABELA'] },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool', palpites: ['ATIVO'], padrao: true },
    ],
  },
  formas_pagamento: {
    rotulo: 'Formas de pagamento',
    tabela: 'formas_pagamento',
    colunas: [
      // FORMAPGTO é o nome de verdade do campo código no ESTAPGTO.dbf do
      // legado — antes de aprender isso, o palpite automático ficava sem
      // achar nada e o operador tinha que escolher a coluna à mão toda vez.
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true, palpites: ['FORMAPGTO', 'CODIGO'] },
      { campo: 'descricao', rotulo: 'Descrição', obrigatorio: true, palpites: ['DESCRICAO', 'DESC', 'NOME'] },
      { campo: 'perc_ajuste', rotulo: 'Ajuste % (acréscimo/desconto)', tipo: 'number', palpites: ['PERCPGTO'], padrao: 0 },
      { campo: 'eh_dinheiro', rotulo: 'É dinheiro físico', tipo: 'bool', palpites: ['DINHEIRO'], padrao: false },
      { campo: 'rps_sempre', rotulo: 'Sempre gera RPS/NFS-e', tipo: 'bool', palpites: ['RPSSEMPRE'], padrao: false },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool', palpites: ['ATIVO'], padrao: true },
    ],
  },
  // Mesmo ESTACONV.dbf do destino "Serviços" abaixo, do outro lado do filtro:
  // aqui entram os TIPO='C' (convênio) e TIPO='V' (vale). Diferente de lá, o
  // campo TIPO não é só filtro — é a própria coluna `tipo` de `convenios`,
  // então É gravado (por isso sem `naoGravar`).
  //
  // Traz junto as regras de desconto (TABCONV/PERCONV/VLRCONV/…): sem elas o
  // convênio importado existiria como cadastro mas não descontaria nada. E os
  // dados cadastrais (endereço etc., ver 0049), porque alguns clientes emitem
  // DPS/RPS com o convênio como tomador.
  convenios: {
    rotulo: 'Convênios e vales (ESTACONV, tipo = C ou V)',
    tabela: 'convenios',
    colunas: [
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true, palpites: ['CODCONV'] },
      { campo: 'tipo', rotulo: 'Tipo (C convênio / V vale)', obrigatorio: true, palpites: ['TIPO'], filtro: ['C', 'V'] },
      { campo: 'razao', rotulo: 'Razão social', obrigatorio: true, palpites: ['RAZAO'] },
      // Regras de desconto — o miolo do convênio.
      { campo: 'tab_conv', rotulo: 'Tabela alternativa', palpites: ['TABCONV'] },
      // Tabela do 2º período (depois que o cliente sai do convênio), usada
      // junto com "Pede hora" — ver 0050 e packages/tarifacao (`tabPreco`).
      { campo: 'tab_preco', rotulo: 'Tabela depois do convênio', palpites: ['TABPRECO'] },
      { campo: 'tab_horas', rotulo: 'Grade própria (CON)', tipo: 'bool', palpites: ['TABHORAS'], padrao: false },
      { campo: 'perc_conv', rotulo: '% desconto', tipo: 'number', palpites: ['PERCONV'], padrao: 0 },
      { campo: 'vlr_conv', rotulo: 'Valor fixo', tipo: 'number', palpites: ['VLRCONV'], padrao: 0 },
      { campo: 'hor_conv', rotulo: 'Hora de corte', tipo: 'number', palpites: ['HORCONV'], padrao: 0 },
      { campo: 'pede_hora', rotulo: 'Pede hora', tipo: 'bool', palpites: ['PEDEHORA'], padrao: false },
      { campo: 'pede_cc', rotulo: 'Pede centro de custo', tipo: 'bool', palpites: ['PEDECC'], padrao: false },
      { campo: 'selos', rotulo: 'Selos', tipo: 'number', palpites: ['SELOS'], padrao: 0 },
      { campo: 'valor_selo', rotulo: 'Valor do selo', tipo: 'number', palpites: ['VALORSELO'], padrao: 0 },
      { campo: 'so_supervisor', rotulo: 'Só supervisor', tipo: 'bool', palpites: ['SOSUPER'], padrao: false },
      // Cadastrais (ver 0049_convenio_cadastro.sql).
      { campo: 'grupo', rotulo: 'Grupo', palpites: ['GRUPO'] },
      { campo: 'cnpj', rotulo: 'CNPJ/CPF', palpites: ['CGC', 'CNPJ', 'CPF'] },
      { campo: 'inscricao', rotulo: 'Inscrição municipal', palpites: ['INSCRICAO', 'INSCRMUN', 'INSCR'] },
      { campo: 'endereco', rotulo: 'Endereço', palpites: ['ENDERECO'] },
      { campo: 'numero', rotulo: 'Número', palpites: ['NUMERO', 'NUM'] },
      { campo: 'bairro', rotulo: 'Bairro', palpites: ['BAIRRO'] },
      { campo: 'cidade', rotulo: 'Cidade', palpites: ['CIDADE'] },
      { campo: 'uf', rotulo: 'UF', palpites: ['UF', 'ESTADO'] },
      { campo: 'cep', rotulo: 'CEP', palpites: ['CEP'] },
      { campo: 'telefone', rotulo: 'Telefone', palpites: ['TELEFONE', 'FONE'] },
      { campo: 'email', rotulo: 'E-mail', palpites: ['EMAIL'] },
      { campo: 'cod_ibge', rotulo: 'Código IBGE da cidade', palpites: ['CODIBGE', 'IBGE'] },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool', palpites: ['ATIVO'], padrao: true },
    ],
  },
  // ESTACONV.dbf mistura convênio, vale e serviço na mesma tabela do legado,
  // diferenciados pelo campo TIPO ('C' convênio, 'V' vale, 'S' serviço) —
  // este destino filtra e traz só os de serviço (os outros dois entram pelo
  // destino `convenios` acima). CODCONV/RAZAO/TABCONV são os mesmos nomes de
  // campo de sempre nesse arquivo.
  servicos: {
    rotulo: 'Serviços (ESTACONV, tipo = Serviço)',
    tabela: 'servicos',
    colunas: [
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true, palpites: ['CODCONV'] },
      { campo: 'descricao', rotulo: 'Descrição', obrigatorio: true, palpites: ['RAZAO'] },
      { campo: 'tabela_tipo', rotulo: 'Tabela de preço', obrigatorio: true, palpites: ['TABCONV'] },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool', palpites: ['ATIVO'], padrao: true },
      {
        campo: '_tipo_registro', rotulo: 'Tipo (filtra "S" = Serviço)', obrigatorio: true,
        palpites: ['TIPO'], filtro: 'S', naoGravar: true,
      },
    ],
  },
  // ESTAHORA.dbf: uma linha por tabela de preço, faixas "largas" (ATE/HOR/CON
  // até 45x lado a lado) — ver packages/dbf/tabelaPreco.ts. `colunas` fica
  // vazio de propósito: ImportarDbf.jsx detecta os campos sozinho pra esse
  // tipo, não usa o mapeamento manual coluna-a-coluna do resto da tela.
  tabela_preco: {
    rotulo: 'Tabela de preço (ESTAHORA)',
    tabela: 'tabelas_preco',
    tipoImportacao: 'tabela_preco',
    colunas: [],
  },
  // ESTAMORT.dbf: RPS emitidos no legado e ainda sem NFS-e (implantação num
  // cliente em uso). Campos fixos do ESTAMORT, sem mapeamento manual — ver
  // packages/dbf/rpsPendentes.ts.
  rps_pendentes: {
    rotulo: 'RPS pendentes de envio (ESTAMORT)',
    tabela: 'notas_fiscais',
    tipoImportacao: 'rps_pendentes',
    colunas: [],
  },
};

/**
 * Mapeamento automático: pra cada coluna de destino, tenta os palpites NA
 * ORDEM declarada (ex.: CPF antes de CGC) — não na ordem em que os campos
 * aparecem no .dbf. Sem isso, um .dbf com um campo tipo CGC (não relacionado
 * ao CPF do mensalista) *antes* do campo CPF de verdade fazia a sugestão
 * pegar o CGC errado, só por vir primeiro no arquivo.
 */
export function sugerirMapeamento(colunas: ColunaDestino[], camposDbf: string[]): Record<string, string | null> {
  const porNome = new Map(camposDbf.map((c) => [c.toUpperCase(), c]));
  const mapeamento: Record<string, string | null> = {};
  for (const col of colunas) {
    let achado: string | null = null;
    for (const palpite of col.palpites || []) {
      const c = porNome.get(palpite.toUpperCase());
      if (c) { achado = c; break; }
    }
    mapeamento[col.campo] = achado;
  }
  return mapeamento;
}

export function paraTexto(v: ValorDbf): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function paraNumero(v: ValorDbf): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).trim());
  return Number.isNaN(n) ? null : n;
}

const REGEX_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Só aceita uma data ISO 'YYYY-MM-DD' já pronta — é o formato que `lerDbf`
 * devolve pra campos do tipo `D` (Date) do próprio .dbf. Se o campo mapeado
 * não for um campo de data de verdade (ex.: um número de dia isolado, sem
 * mês/ano), fica em branco em vez de gravar uma data inválida — aparece
 * vazio na prévia, sinal de que o mapeamento dessa coluna está errado.
 */
export function paraData(v: ValorDbf): string | null {
  if (typeof v !== 'string') return null;
  return REGEX_DATA_ISO.test(v) ? v : null;
}

export function paraBool(v: ValorDbf): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  if (['S', 'T', 'Y', '1'].includes(s)) return true;
  if (['N', 'F', '0'].includes(s)) return false;
  return null;
}

/** Converte um registro do dbf pras colunas de destino, aplicando o mapeamento e os tipos/padrões da coluna. */
export function converterLinha(
  registro: RegistroDbf,
  colunas: ColunaDestino[],
  mapeamento: Record<string, string | null>,
): Record<string, ValorDbf> {
  const linha: Record<string, ValorDbf> = {};
  for (const col of colunas) {
    const campoDbf = mapeamento[col.campo];
    const bruto = campoDbf ? registro[campoDbf] : null;
    const convertido = col.tipo === 'number' ? paraNumero(bruto)
      : col.tipo === 'bool' ? paraBool(bruto)
      : col.tipo === 'data' ? paraData(bruto)
      : paraTexto(bruto);
    linha[col.campo] = convertido ?? col.padrao ?? null;
  }
  return linha;
}

/**
 * Só as linhas que passam nos `filtro` das colunas (ex.: "servicos" filtra
 * `_tipo_registro === 'S'`; "convenios" aceita 'C' ou 'V') — sem nenhuma
 * coluna com `filtro`, devolve tudo. Comparação sem diferenciar
 * maiúsc./minúsc. (o legado é inconsistente com isso em texto).
 */
export function filtrarLinhas(
  colunas: ColunaDestino[],
  linhas: Record<string, ValorDbf>[],
): Record<string, ValorDbf>[] {
  const filtros = colunas.filter((c) => c.filtro != null);
  if (!filtros.length) return linhas;
  return linhas.filter((linha) => filtros.every((c) => {
    const valor = linha[c.campo];
    if (valor == null) return false;
    const atual = String(valor).trim().toUpperCase();
    const aceitos = Array.isArray(c.filtro) ? c.filtro : [c.filtro!];
    return aceitos.some((f) => f.toUpperCase() === atual);
  }));
}
