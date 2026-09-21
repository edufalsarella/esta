import { fmtBRL, fmtDataBR, fmtHora, dataHoraDe } from './tempo.js';
import { MODELOS_PADRAO } from './modelosPadrao.js';
import { base64ParaBytes } from './logoTicket.js';

// Monta o mapa token -> valor consumido por `renderizarModelo`. Os nomes dos
// tokens são os mesmos do sistema legado (SISPROC.PRG), pra dar pra colar um
// .txt antigo no editor e ele funcionar quase sem edição.
//
// Token sem equivalente no esta hoje (@CODBARRA@, @CHANCELA@, @TAXA1-3@…)
// simplesmente não entra no mapa e sai vazio na renderização.

/**
 * Dados do estabelecimento — os "fixos" do legado (analisa_fixo). @ER@ é o
 * nome do estacionamento (nome fantasia; cai pra razão social se não tiver
 * um definido) — a razão social "oficial" continua disponível em @RAZAORPS@,
 * pro RPS/DPS. @EF@ fica sempre em branco: nenhum cliente usa nome fantasia
 * separado do nome do estacionamento — mantido só pra não quebrar um .txt
 * antigo que ainda tenha o token.
 */
export function dadosFilial(filial = {}) {
  const logo = filial.config?.logo;
  return {
    // @LOGO@ (ver modeloTicket.js/Configurações → dados do estabelecimento):
    // dataUrl pro HTML/prévia, escposBytes (já decodificado do base64
    // salvo) pro Bluetooth — os dois processados uma vez só no upload
    // (ver logoTicket.js), nunca aqui.
    LOGO: logo ? { dataUrl: logo.dataUrl, escposBytes: base64ParaBytes(logo.escposB64) } : undefined,
    ER: filial.nome_fantasia || filial.razao_social || '',
    EF: '',
    EE: [filial.endereco, filial.numero].filter(Boolean).join(', '),
    EC: [filial.cidade, filial.uf].filter(Boolean).join('-'),
    EG: filial.cnpj || '',
    // @EI@ NÃO é a inscrição municipal (esse é o @IMRPS@, logo abaixo) — no
    // legado do Eduardo, @EI@ já era usado pra imprimir o telefone do
    // estacionamento. @FONE@ é o mesmo dado com um nome mais claro pra quem
    // for montar um modelo novo do zero; os dois ficam sempre iguais.
    EI: filial.inscricao_est || '',
    FONE: filial.inscricao_est || '',
    RAZAORPS: filial.razao_social || '',
    IMRPS: filial.inscricao_mun || '',
  };
}

/**
 * Permanência em hora comercial (HH.MM) a partir dos horários gravados. O
 * resultado do motor não fica no banco, então reimpressões (e o RPS) precisam
 * recalcular para preencher o `@TH@`.
 */
export function permanenciaDe(movimento) {
  if (!movimento?.dt_saida || movimento.hr_saida == null) return undefined;
  const minutos = Math.max(0, (dataHoraDe(movimento.dt_saida, Number(movimento.hr_saida)).getTime()
    - dataHoraDe(movimento.dt_entrada, Number(movimento.hr_entrada)).getTime()) / 60000);
  return Math.floor(minutos / 60) + Math.round(minutos % 60) / 100;
}

/** Movimento (entrada/saída/2ª via). `resultado` é o retorno do motor de tarifação. */
export function dadosMovimento({ movimento = {}, resultado, operador, servicos = [], convenio } = {}) {
  const temSaida = !!movimento.dt_saida;
  const valor = Number(resultado?.valor ?? movimento.valor ?? 0);
  // valorInformado: serviço "Pede valor" (ver Patio.jsx/servicoPedeValor) —
  // os demais não têm preço próprio (a tabela do serviço já vira o valor
  // final da saída via o motor, não uma soma por item aqui).
  const valorServicos = servicos.reduce((s, x) => s + Number(x.valorInformado || 0), 0);

  return {
    // Número de controle do ticket: curto de propósito, é ditado na saída.
    'C#': movimento.controle != null ? String(movimento.controle).padStart(4, '0') : '',
    CC: movimento.placa || '',
    CV: movimento.modelo || '',
    TV: movimento.tipo_veic || '',
    TM: movimento.tipo_mens || '',
    XBOX: movimento.box || '',
    AVISO: movimento.aviso || '',
    DE: fmtDataBR(movimento.dt_entrada),
    HE: movimento.hr_entrada != null ? fmtHora(Number(movimento.hr_entrada)) : '',
    DS: temSaida ? fmtDataBR(movimento.dt_saida) : '',
    HS: temSaida && movimento.hr_saida != null ? fmtHora(Number(movimento.hr_saida)) : '',
    TH: resultado?.tempoDecorrido != null ? fmtHora(resultado.tempoDecorrido) : '',
    V: fmtBRL(valor),
    V_NUM: valor,
    CO: convenio?.codigo || movimento.convenio_codigo || '',
    VC: fmtBRL(Number(resultado?.valorConvenio ?? movimento.valor_convenio ?? 0)),
    VC_NUM: Number(resultado?.valorConvenio ?? movimento.valor_convenio ?? 0),
    VD: fmtBRL(Number(movimento.valor_dev || 0)),
    VD_NUM: Number(movimento.valor_dev || 0),
    BONUS: Number(movimento.bonus_fidelidade || 0) ? fmtBRL(Number(movimento.bonus_fidelidade)) : '',
    BONUS_NUM: Number(movimento.bonus_fidelidade || 0),
    SERVICOS: servicos.map((s) => s.descricao).join(', '),
    VALORSERVICOS: valorServicos ? fmtBRL(valorServicos) : '',
    VALORSERVICOS_NUM: valorServicos,
    AVARIAS: movimento.avarias || '',
    ANTECIPADO: Number(resultado?.valorAntecipado ?? movimento.valor_antecipado ?? 0)
      ? fmtBRL(Number(resultado?.valorAntecipado ?? movimento.valor_antecipado)) : '',
    ANTECIPADO_NUM: Number(resultado?.valorAntecipado ?? movimento.valor_antecipado ?? 0),
    US: operador || '',
  };
}

/** Mensalista — usado no ticket de mensalidade e quando o veículo é de um. */
export function dadosMensalista({ mensalista, veiculos = [] } = {}) {
  if (!mensalista) return { MENSALISTA: '' };
  const dados = {
    MENSALISTA: mensalista.razao || '',
    MEND: [mensalista.endereco, mensalista.numero].filter(Boolean).join(', '),
    MCEP: mensalista.cep || '',
    MCID: [mensalista.cidade, mensalista.uf].filter(Boolean).join('-'),
    MTR: mensalista.telefone || '',
    MCEL: mensalista.celular || '',
    MCPF: mensalista.cpf_cnpj || '',
    MEMAIL: mensalista.email || '',
    VAGAS: String(mensalista.qte_vagas ?? ''),
    XBOX: mensalista.box || '',
  };
  // @CC01@/@CV01@… — placas do mensalista, na ordem do cadastro.
  veiculos.forEach((v, i) => {
    const n = String(i + 1).padStart(2, '0');
    dados[`CC${n}`] = v.placa || '';
    dados[`CV${n}`] = v.modelo || '';
  });
  return dados;
}

/** Recebimento de mensalidade. */
export function dadosMensalidade({ dtPagamento, proximo, valor, valorMensalidade, formaDescricao, multa, extras } = {}) {
  return {
    DE: fmtDataBR(dtPagamento),
    DS: fmtDataBR(proximo),
    V: fmtBRL(Number(valor || 0)),
    // @VM@ é o valor de cadastro; sem ele (proporcional da 1ª mensalidade, por
    // exemplo) cai no valor efetivamente pago.
    VM: fmtBRL(Number(valorMensalidade ?? valor ?? 0)),
    MULTA: Number(multa || 0) ? fmtBRL(Number(multa)) : '',
    MULTA_NUM: Number(multa || 0),
    EXTRA: Number(extras || 0) ? fmtBRL(Number(extras)) : '',
    EXTRA_NUM: Number(extras || 0),
    MOEDA: formaDescricao || '',
  };
}

/** Reserva de vaga (Pátio → Reservas). CC/CV: mesmo sentido de placa/veículo que dadosMovimento já usa. */
export function dadosReserva(reserva = {}) {
  return {
    CC: reserva.placa || '',
    CV: reserva.modelo || '',
    RTIPO: reserva.tipo || '',
    RDE: fmtDataBR(reserva.data_inicio),
    RATE: fmtDataBR(reserva.data_fim),
    RNOME: reserva.nome || '',
    RFONE: reserva.telefone || '',
    ROBS: reserva.observacao || '',
    PROPOSTO: Number(reserva.valor_proposto || 0) ? fmtBRL(Number(reserva.valor_proposto)) : '',
    PROPOSTO_NUM: Number(reserva.valor_proposto || 0),
    ANTECIPADO: Number(reserva.valor_antecipado || 0) ? fmtBRL(Number(reserva.valor_antecipado)) : '',
    ANTECIPADO_NUM: Number(reserva.valor_antecipado || 0),
  };
}

/**
 * Ticket de dívida — impresso quando uma saída é paga (total ou em parte)
 * com a forma "Devedor" (ver Cadastros → Formas de pagamento, eh_devedor).
 * @DIVIDA@ é o valor contraído AGORA, diferente de @VD@ (dadosMovimento),
 * que é a dívida ANTERIOR sendo cobrada nesta mesma saída — os dois podem
 * aparecer juntos (ex.: devia R$20, esta estadia+dívida deu R$50, pagou
 * R$30 e deixou R$20 de dívida nova).
 */
export function dadosDivida(valorDivida) {
  return {
    DIVIDA: fmtBRL(Number(valorDivida || 0)),
    DIVIDA_NUM: Number(valorDivida || 0),
  };
}

/** RPS/NFS-e — para o ticket do tipo `rps`. */
export function dadosRps({ nota, filial } = {}) {
  if (!nota) return {};
  const tomador = nota.tomador || {};
  return {
    NNFE: String(nota.numero_nfse || nota.numero_rps || ''),
    SERIERPS: nota.serie || '',
    RPSDESCR: nota.descricao || '',
    COMPETENCIA: fmtDataBR(nota.competencia),
    ISS: fmtBRL(Number(nota.valor_iss || 0)),
    PERCISS: String(nota.aliquota_iss ?? ''),
    CCPF: tomador.cpf_cnpj || '',
    CNOME: tomador.nome || '',
    CENDE: tomador.endereco || '',
    CNUM: tomador.numero || '',
    CBAIRRO: tomador.bairro || '',
    CCEP: tomador.cep || '',
    CCID: tomador.cidade || filial?.cidade || '',
    CESTA: tomador.uf || filial?.uf || '',
    CFONE: tomador.telefone || '',
    CEMAIL: tomador.email || '',
  };
}

/** Junta as partes que o ticket em questão precisar. */
export function montarDadosTicket(...partes) {
  return Object.assign({}, ...partes);
}

/**
 * Ticket do RPS/DPS, pronto pro TicketModal. Diferente dos outros comprovantes,
 * este não tem layout fixo de fallback — sem modelo cadastrado usa o padrão de
 * fábrica, senão o RPS simplesmente não teria como ser impresso.
 *
 * Usado tanto na tela Fiscal quanto logo depois de gerar a nota (saída do pátio
 * e recebimento de mensalidade), onde vira o botão "Imprimir RPS" do ticket.
 */
export function montarTicketRps({ nota, filial, movimento, modelo }) {
  return {
    titulo: `RPS/DPS ${nota.numero_rps}`,
    linhas: [['RPS/DPS', nota.numero_rps], ['Valor', fmtBRL(Number(nota.valor))]],
    modelo: modelo || MODELOS_PADRAO.rps,
    dados: {
      // Um modelo só atende as duas origens: `@SE(MENSALIDADE)@` na parte que
      // só faz sentido na mensalidade, `@SE(#MENSALIDADE)@` na do pátio.
      MENSALIDADE: movimento ? '' : 'S',
      ...dadosFilial(filial || {}),
      ...(movimento
        ? dadosMovimento({ movimento, resultado: { valor: movimento.valor, tempoDecorrido: permanenciaDe(movimento) } })
        : {}),
      ...dadosRps({ nota, filial }),
      V: fmtBRL(Number(nota.valor)), // no RPS o valor é o da nota, não o do movimento
    },
  };
}
