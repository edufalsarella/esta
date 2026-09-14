import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { carregarTabelasPreco, carregarPatio, carregarModelosVeiculo, carregarTabelasManuais, carregarModelosTicket } from '../lib/dados.js';
import { agoraHHMM, hojeISO, dataDeISO, dataHoraDe, limitesDiaLocal, fmtHora, fmtBRL, fmtDataBR, dentroDoVencimento } from '../lib/tempo.js';
import { normalizar, REGEX_PLACA } from '../lib/texto.js';
import { calcularTarifa, horas as horasDecorridas } from '../../packages/tarifacao/tarifacao.ts';
import { diaSemanaLegado, calcularRestricaoEntrada } from '../lib/restricaoMensalista.js';
import { TicketModal } from '../componentes/Ticket.jsx';
import CapturaPlaca from '../componentes/CapturaPlaca.jsx';
import DitarPlaca from '../componentes/DitarPlaca.jsx';
import CardAcoes from '../componentes/CardAcoes.jsx';
import ReceberMensalidadeFluxo from '../componentes/ReceberMensalidade.jsx';
import VendaProdutosFluxo from '../componentes/VendaProdutos.jsx';
import AbrirCaixaInline from '../componentes/AbrirCaixaInline.jsx';
import { criarNotaFiscal } from '../lib/notaFiscal.js';
import { dadosFilial, dadosMovimento, permanenciaDe, montarTicketRps, dadosDivida } from '../lib/dadosTicket.js';
import { erroCpfCnpj, validarCpfCnpj, formatarCpfCnpj } from '../lib/documento.js';
import { buscarCnpj } from '../lib/cnpj.js';
import { issRetidoDaPlaca, salvarIssRetidoDaPlaca, AR_PARA_ABRASF, ABRASF_PARA_AR } from '../lib/issRetido.js';
import { ehGerente } from '../lib/acesso.js';
import { configInfinitePay, ehCelular, parcelasPossiveis, cobrarNoInfiniteTap } from '../lib/infinitepay.js';

const MENSALISTA = new Set(['I', 'P', 'H']);
const EXCLUSAO_JANELA_MIN = 5; // operador só pode excluir nos primeiros N minutos da entrada

/** Placa fictícia de quem entrou sem placa — convenção herdada do legado. */
const semChapa = (placa) => String(placa || '').startsWith('$$$');
const placaSemChapa = (controle) => `$$$${String(controle).padStart(4, '0')}`;
/** Na tela, `$$$0042` só polui: o nº já está na coluna ao lado. */
const rotuloPlaca = (placa) => (semChapa(placa) ? 'sem placa' : placa);

export default function Patio({ perfil }) {
  const [tabelas, setTabelas] = useState({});
  const [convenios, setConvenios] = useState({});
  const [formas, setFormas] = useState([]);
  const [patio, setPatio] = useState([]);
  // No celular, as listas "No pátio" e "Saídas de hoje" nascem escondidas
  // atrás de um botão (mais espaço pra Entrada de veículo, especialmente com
  // a fonte maior — ver .card-entrada/.btn-ver-lista-mobile no CSS) — no
  // desktop sempre visíveis, como sempre foi (o botão nem aparece lá, ver CSS).
  const [verPatioMobile, setVerPatioMobile] = useState(() => window.innerWidth > 760);
  const [verSaidasMobile, setVerSaidasMobile] = useState(() => window.innerWidth > 760);
  const [placa, setPlaca] = useState('');
  const [detectado, setDetectado] = useState(null); // {mensalista, convenio_codigo, tipo_mens}
  const [vagaEsgotada, setVagaEsgotada] = useState(null); // nome do mensalista, se as vagas dele já estão ocupadas
  const [mensalistaVencido, setMensalistaVencido] = useState(null); // nome do mensalista, se venceu (entra como avulso)
  const [restricaoHorario, setRestricaoHorario] = useState(null); // { nome, livreAPartir } — fora do dia/turno contratado
  const [reservaDetectada, setReservaDetectada] = useState(null); // só pro aviso na tela
  // Ref (não state) porque registrarEntrada às vezes é chamado na hora, no
  // meio da mesma função que setReservaDetectada — o state só atualizaria no
  // próximo render, tarde demais pra registrarEntrada ler o valor certo.
  const reservaParaChegadaRef = useRef(null);
  const [dividaDetectada, setDividaDetectada] = useState(0); // só pro aviso na tela — ver detectar()
  const dividaDetectadaRef = useRef(0); // mesmo raciocínio do reservaParaChegadaRef — registrarEntrada lê daqui
  const [livreAPartirEntrada, setLivreAPartirEntrada] = useState(null); // valor a persistir na entrada (ver registrarEntrada)
  const [erro, setErro] = useState('');
  const [saindo, setSaindo] = useState(null);
  const [parcelasCartao, setParcelasCartao] = useState(1); // só pro InfiniteTap em crédito

  // Busca de modelo de carro (Entrada) + fallback de tabela manual.
  const [modelos, setModelos] = useState([]);
  const [tabelasManuais, setTabelasManuais] = useState([]);
  const [buscaModelo, setBuscaModelo] = useState('');
  const [modeloSelecionado, setModeloSelecionado] = useState(null);
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);
  const [tabelaManual, setTabelaManual] = useState('');
  const [nomeCarroNovo, setNomeCarroNovo] = useState('');
  const [confirmNovo, setConfirmNovo] = useState(null); // { nome, tipo }
  const [confirmPlaca, setConfirmPlaca] = useState(null); // placa digitada, fora do formato esperado
  const [ticket, setTicket] = useState(null); // { titulo, linhas: [[rotulo, valor], ...] }
  const [celularTicket, setCelularTicket] = useState('');
  const [placaTicket, setPlacaTicket] = useState(''); // placa do ticket atual — pra TicketModal saber onde salvar o celular
  const [filial, setFilial] = useState(null); // dados do estabelecimento — cabeçalho/tokens do ticket
  const [modelosTicket, setModelosTicket] = useState({}); // tipo -> layout com tokens (vazio = layout fixo)
  const [saidasRecentes, setSaidasRecentes] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [bonusFaixas, setBonusFaixas] = useState([]); // ordenadas da maior pontuação pra menor
  const [modalBonus, setModalBonus] = useState(null); // { faixa, pontosAtual, pontosProjetados }
  const [modalServicos, setModalServicos] = useState(null); // { mov, marcados: Set<servico_id> }
  const [movimentosComServico, setMovimentosComServico] = useState(new Set());
  const [modalValorServico, setModalValorServico] = useState(null); // { servicoId, descricao, valor } — serviço "Pede valor" (ver alternarServico)
  const [servicosEntrada, setServicosEntrada] = useState([]); // [{servico_id, descricao, valorInformado}] — marcados ANTES de registrar a entrada (ver botão "Serviços" na Entrada)
  const [modalServicosEntrada, setModalServicosEntrada] = useState(false);
  const [modalValorServicoEntrada, setModalValorServicoEntrada] = useState(null); // { servicoId, descricao, valor }
  const [avarias, setAvarias] = useState(''); // texto (até 5 linhas de 50) — ver botão "Avarias" na Entrada
  const [modalAvarias, setModalAvarias] = useState(false);
  const [fotosAvarias, setFotosAvarias] = useState(0); // só contador — as fotos não ficam no app, vão pro aparelho
  const [valorAntecipado, setValorAntecipado] = useState(''); // pago na entrada, descontado na saída — ver botão "Mais opções" na Entrada
  const [formaAntecipado, setFormaAntecipado] = useState('');
  const [modalAntecipado, setModalAntecipado] = useState(false);
  const [modalExclusao, setModalExclusao] = useState(null); // { mov, motivo }
  const [modalDps, setModalDps] = useState(null); // { documento, nome }
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [erroCnpj, setErroCnpj] = useState('');
  const [modalValor, setModalValor] = useState(null); // { valor } — alteração manual do valor da saída
  const [agora, setAgora] = useState(() => Date.now());
  const [abrirRecebimento, setAbrirRecebimento] = useState(false); // fluxo de "Receber mensalidade" (menu ⋮)
  const [modalSenhaMes, setModalSenhaMes] = useState(null); // { senha, erro, ocupado } — "Cadastrar senha do mês" (menu ⋮)
  const [caixaAberto, setCaixaAberto] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [abrirVendaProdutos, setAbrirVendaProdutos] = useState(false); // fluxo de "Venda Produtos" (menu ⋮)
  const [pendenteCaixa, setPendenteCaixa] = useState(null); // { executar } — ação de recebimento esperando caixa aberto
  const placaRef = useRef(null);
  const buscaModeloRef = useRef(null);
  const btnRegistrarRef = useRef(null);
  const btnConfirmarSaidaRef = useRef(null);
  // Ausente = true (comportamento de sempre): só desliga se explicitamente false.
  const imprimeTicketMensalista = filial?.config?.patio?.imprimeTicketMensalista !== false;

  /**
   * Volta o cursor pro campo de placa — na cabine o operador encadeia um carro
   * atrás do outro e não deveria precisar do mouse. Chamado ao abrir a tela e
   * ao fechar o comprovante (não logo depois da entrada/saída: enquanto o
   * ticket está aberto o foco pertence a ele, inclusive pros atalhos F/W/I).
   */
  function focarPlaca() {
    placaRef.current?.focus();
  }
  useEffect(() => { focarPlaca(); }, []);

  useEffect(() => {
    supabase.from('caixas').select('id').eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle()
      .then(({ data }) => setCaixaAberto(data));
  }, [perfil.id]);

  // Tique periódico só pra reavaliar a janela de 5min do botão Excluir (operador).
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  // Só o que COMEÇA com o que foi digitado (não "contém" em qualquer
  // posição) — "GO" trazia "KANGOO" junto com "GOL"/"GOLF", o que não ajuda
  // ninguém a digitar mais rápido. Ordem alfabética, não a ordem do cadastro
  // — sem isso "GOLF" podia aparecer antes de "GOL" só por ter sido
  // cadastrado primeiro.
  const sugestoes = useMemo(() => {
    const alvo = normalizar(buscaModelo);
    if (alvo.length < 2) return [];
    return modelos.filter((m) => normalizar(m.nome).startsWith(alvo))
      .sort((a, b) => normalizar(a.nome).localeCompare(normalizar(b.nome), 'pt-BR'))
      .slice(0, 8);
  }, [buscaModelo, modelos]);

  const mensalistasNoPatio = useMemo(() => patio.filter((m) => MENSALISTA.has(m.tipo_mens)).length, [patio]);
  const avulsosNoPatio = patio.length - mensalistasNoPatio;

  async function recarregar() {
    try {
      const hoje = hojeISO();
      const { inicio: inicioHoje, fim: fimHoje } = limitesDiaLocal(hoje, hoje);
      const [t, p, cv, fp, md, tm, sr, fl, sv, mt, bf, pr] = await Promise.all([
        carregarTabelasPreco(), carregarPatio(),
        supabase.from('convenios').select('*'),
        supabase.from('formas_pagamento').select('*').eq('ativo', true).order('codigo'),
        carregarModelosVeiculo(), carregarTabelasManuais(),
        // Saídas normais de hoje + veículos excluídos (cancelados) hoje — ordenado/limitado depois em JS.
        supabase.from('movimentos').select('*')
          .or(`dt_saida.eq.${hoje},and(excluido_em.gte.${inicioHoje},excluido_em.lt.${fimHoje})`),
        supabase.from('filiais').select('*').eq('id', perfil.filial_id).maybeSingle(),
        supabase.from('servicos').select('*').eq('ativo', true).order('codigo'),
        carregarModelosTicket(),
        supabase.from('bonus_faixas').select('*').order('pontos_necessarios', { ascending: false }),
        supabase.from('produtos').select('*').eq('ativo', true).order('codigo'),
      ]);
      setTabelas(t); setPatio(p);
      setConvenios(Object.fromEntries((cv.data || []).map((c) => [c.codigo, c])));
      setFormas(fp.data || []);
      setModelos(md); setTabelasManuais(tm);
      setProdutos(pr.data || []);
      const listaSaidas = (sr.data || [])
        .map((m) => ({ ...m, _quando: m.excluido_em ? new Date(m.excluido_em).getTime() : dataHoraDe(m.dt_saida, Number(m.hr_saida)).getTime() }))
        .sort((a, b) => b._quando - a._quando)
        .slice(0, 50);
      setSaidasRecentes(listaSaidas);
      setFilial(fl.data || null);
      setServicos(sv.data || []);
      setModelosTicket(mt);
      setBonusFaixas(bf.data || []);
      const idsPatio = p.map((m) => m.id);
      if (idsPatio.length > 0) {
        const { data: ms } = await supabase.from('movimento_servicos').select('movimento_id').in('movimento_id', idsPatio);
        setMovimentosComServico(new Set((ms || []).map((r) => r.movimento_id)));
      } else {
        setMovimentosComServico(new Set());
      }
    } catch (e) { setErro(e.message); }
  }
  useEffect(() => { recarregar(); /* eslint-disable-next-line */ }, []);

  /**
   * Aplica o layout que a filial cadastrou (tabela `modelos_ticket`) ao ticket.
   * Sem modelo pro tipo, o layout na tela/impressão/WhatsApp continua sendo o
   * fixo de sempre (`ticket.modelo` fica ausente) — mas `tipo`+`dados` são
   * anexados de qualquer forma: é o que permite Imprimir Bluetooth/na cabine
   * (que usam o modelo padrão de fábrica como último recurso, ver escpos.js).
   */
  function comModelo(tipo, ticket, dados) {
    const modelo = modelosTicket[tipo];
    return {
      ...ticket, tipo,
      ...(modelo ? { modelo } : {}),
      dados: { ...dadosFilial(filial || {}), ...dados },
    };
  }

  /**
   * Acha o carro no pátio pelo que o operador digitou no campo da placa: o
   * número de controle (só dígitos) ou a placa. Não há ambiguidade porque
   * placa brasileira sempre tem letra.
   */
  function encontrarNoPatio(texto) {
    const p = String(texto || '').trim().toUpperCase();
    if (!p) return null;
    if (/^\d{1,4}$/.test(p)) {
      const porControle = patio.find((m) => m.controle === Number(p));
      if (porControle) return porControle;
    }
    return patio.find((m) => m.placa === p) || null;
  }

  // Detecção de mensalista ao digitar a placa.
  async function detectar(pl) {
    const p = pl.trim().toUpperCase();
    setDetectado(null);
    setVagaEsgotada(null);
    setMensalistaVencido(null);
    setRestricaoHorario(null);
    setLivreAPartirEntrada(null);
    setReservaDetectada(null);
    reservaParaChegadaRef.current = null;
    setDividaDetectada(0);
    dividaDetectadaRef.current = 0;

    // Já está no pátio (por placa ou pelo nº de controle)? Vai direto pra saída.
    // Antes do corte de 3 caracteres: número de controle costuma ter 1 ou 2.
    const jaNoPatio = encontrarNoPatio(p);
    if (jaNoPatio) { limparFormEntrada(); prepararSaida(jaNoPatio); return; }

    if (p.length < 3) return;

    // Já esteve aqui antes? Traz o modelo de volta pro campo Carro.
    if (!buscaModelo.trim()) {
      const { data: anterior } = await supabase.from('movimentos')
        .select('modelo').eq('placa', p).not('dt_saida', 'is', null)
        .order('dt_saida', { ascending: false }).order('hr_saida', { ascending: false })
        .limit(1).maybeSingle();
      preencherModeloConhecido(anterior?.modelo);
    }

    // Dívida de uma saída anterior (forma de pagamento "Devedor", ver
    // confirmarSaida) — soma na próxima estadia calculada (ver
    // calcularResultadoSaida/dividaAnterior) e já avisa aqui na entrada.
    // Vale pra qualquer placa (mensalista ou avulso), por isso é checado
    // antes de qualquer um dos ramos abaixo, não só no caminho de avulso.
    const { data: clienteDivida } = await supabase.from('clientes').select('saldo_devedor').eq('placa', p).maybeSingle();
    const divida = Number(clienteDivida?.saldo_devedor || 0);
    if (divida > 0) { setDividaDetectada(divida); dividaDetectadaRef.current = divida; }

    const { data: mv } = await supabase.from('mensalista_veiculos').select('mensalista_id, modelo, tipo_veic').eq('placa', p).maybeSingle();
    if (!mv) { await detectarReserva(p); return; }
    const { data: m } = await supabase.from('mensalistas').select('*').eq('id', mv.mensalista_id).maybeSingle();
    if (!m || !m.ativo) return;

    // Fora do vencimento + tolerância? Entra como avulso (tabela normal, sem convênio).
    if (!dentroDoVencimento(m.proximo_pagamento, m.tolerancia_dias)) {
      setMensalistaVencido(m.razao);
      if (mv.tipo_veic) await registrarEntrada(mv.tipo_veic, mv.modelo, 'E', null);
      else preencherModeloConhecido(mv.modelo);
      return;
    }

    // Vagas contratadas já ocupadas por OUTROS veículos dele? Entra como avulso.
    // Só conta quem está de fato usando a vaga como mensalista (I/P/H) — um
    // carro irmão que entrou avulso (por vaga esgotada, vencimento, restrição
    // de horário…) não "toma" a vaga; senão, uma vez que um deles caísse pra
    // avulso, a vaga ficaria travada mesmo depois do titular sair.
    const { data: veiculosDele } = await supabase.from('mensalista_veiculos').select('placa').eq('mensalista_id', m.id);
    const outrasPlacas = (veiculosDele || []).map((v) => v.placa).filter((pl) => pl !== p);
    let ocupadas = 0;
    if (outrasPlacas.length) {
      const { count } = await supabase.from('movimentos')
        .select('id', { count: 'exact', head: true }).in('placa', outrasPlacas).in('tipo_mens', [...MENSALISTA])
        .is('dt_saida', null).is('excluido_em', null);
      ocupadas = count || 0;
    }
    if (ocupadas >= (m.qte_vagas || 1)) {
      setVagaEsgotada(m.razao);
      preencherModeloConhecido(mv.modelo);
      return;
    }

    // Dia/turno fora do contratado (RESTRM/RESTRT/RESTRN + PERIODO1/2/3)?
    // Entra como avulso, mas cobra só até o próximo turno contratado do dia
    // (ver calcularResultadoSaida) — não a estadia inteira.
    const restricao = calcularRestricaoEntrada({
      horaEntrada: agoraHHMM(), diaSemana: diaSemanaLegado(new Date()), mensalista: m,
    });
    if (!restricao.dentroDoHorario) {
      setRestricaoHorario({ nome: m.razao, livreAPartir: restricao.livreAPartir });
      setLivreAPartirEntrada(restricao.livreAPartir);
      if (mv.tipo_veic) await registrarEntrada(mv.tipo_veic, mv.modelo, 'E', null);
      else preencherModeloConhecido(mv.modelo);
      return;
    }

    let convCod = null;
    if (m.convenio_id) {
      const { data: c } = await supabase.from('convenios').select('codigo').eq('id', m.convenio_id).maybeSingle();
      convCod = c?.codigo ?? null;
    }

    // Veículo já cadastrado com tabela definida: completa a entrada sozinho.
    if (mv.tipo_veic) {
      await registrarEntrada(mv.tipo_veic, mv.modelo, m.tipo_mens, convCod);
      return;
    }

    preencherModeloConhecido(mv.modelo);
    setDetectado({ nome: m.razao, tipo_mens: m.tipo_mens, convenio_codigo: convCod });
  }

  /**
   * Placa não é de mensalista — tenta achar uma reserva confirmada que
   * cubra hoje (ver Reservas de vaga). A reserva só garante a vaga, não
   * isenta cobrança: entra como avulso ('E'), cobrado normal na saída.
   * Modelo batendo com o catálogo (mesmo nome) → entrada automática, igual
   * já acontece com mensalista em dia; senão só pré-preenche e avisa.
   */
  async function detectarReserva(p) {
    const hoje = hojeISO();
    const { data: reservasHoje } = await supabase.from('reservas').select('*')
      .eq('placa', p).eq('status', 'confirmada')
      .lte('data_inicio', hoje).gte('data_fim', hoje)
      .order('data_inicio').limit(1);
    const reserva = reservasHoje?.[0];
    if (!reserva) return;

    preencherModeloConhecido(reserva.modelo);
    setReservaDetectada(reserva); // só pro aviso na tela (ver comentário no state)
    reservaParaChegadaRef.current = reserva; // registrarEntrada lê daqui, não do state
    const match = modelos.find((mo) => normalizar(mo.nome) === normalizar(reserva.modelo));
    if (match?.tabela_tipo) {
      await registrarEntrada(match.tabela_tipo, reserva.modelo, 'E', null);
    }
  }

  /**
   * Pré-preenche o campo Carro com um modelo já conhecido (do catálogo, se
   * bater o nome; senão texto livre) — usado quando a entrada não se
   * completa sozinha (vaga esgotada, restrição de horário, mensalista sem
   * tabela cadastrada…) e o operador precisa terminar o formulário à mão.
   * Não sobrescreve o que o operador já tiver digitado.
   */
  function preencherModeloConhecido(nomeModelo) {
    if (!nomeModelo || buscaModelo.trim()) return;
    const match = modelos.find((m) => normalizar(m.nome) === normalizar(nomeModelo));
    if (match) selecionarModelo(match);
    else setBuscaModelo(nomeModelo);
  }

  function onBuscaModeloChange(valorDigitado) {
    const v = valorDigitado.toUpperCase();
    setBuscaModelo(v);
    setMostrarSugestoes(true);
    setModeloSelecionado((m) => (m && normalizar(v) !== normalizar(m.nome)) ? null : m);
  }

  function selecionarModelo(m) {
    setModeloSelecionado(m);
    setBuscaModelo(m.nome);
    setMostrarSugestoes(false);
    setTabelaManual(''); setNomeCarroNovo('');
    // Tabela com "Valor antecipado" configurado (ex.: promoção de evento
    // vizinho, ver Preços) — já sugere o Vlr. Antecipado da Entrada com esse
    // valor e em dinheiro, do jeito que sempre foi cobrado. Só sugestão: o
    // operador ainda vê/edita no modal "Mais opções" antes de confirmar.
    const valorAntes = Number(tabelas[m.tabela_tipo]?.valorAntes || 0);
    if (valorAntes > 0) {
      setValorAntecipado(String(valorAntes));
      setFormaAntecipado(formas.find((f) => f.eh_dinheiro)?.codigo || '');
    }
  }

  // Pré-preenche o nome do carro novo com o que foi digitado, enquanto nada foi
  // selecionado do catálogo (o operador ainda pode editar antes de confirmar).
  useEffect(() => {
    if (!modeloSelecionado) setNomeCarroNovo(buscaModelo);
    // eslint-disable-next-line
  }, [buscaModelo]);

  function limparFormEntrada() {
    setPlaca(''); setDetectado(null); setVagaEsgotada(null); setMensalistaVencido(null);
    setRestricaoHorario(null); setLivreAPartirEntrada(null); setReservaDetectada(null);
    reservaParaChegadaRef.current = null;
    setDividaDetectada(0); dividaDetectadaRef.current = 0;
    setBuscaModelo(''); setModeloSelecionado(null); setMostrarSugestoes(false);
    setTabelaManual(''); setNomeCarroNovo(''); setConfirmNovo(null);
    setServicosEntrada([]);
    setAvarias(''); setFotosAvarias(0);
    setValorAntecipado(''); setFormaAntecipado('');
  }

  /**
   * Grava a entrada reservando o número de controle (@C#@) — o número curto que
   * o operador entrega ao cliente e recebe de volta na saída.
   *
   * O banco garante que ele não se repete entre os carros no pátio; se duas
   * cabines pegarem o mesmo número no mesmo instante, a segunda leva erro de
   * duplicidade e aqui tentamos o próximo livre.
   */
  async function inserirComControle(dados, tentativas = 3) {
    for (let i = 0; i < tentativas; i++) {
      const { data: proximo, error: errSeq } = await supabase.rpc('proximo_controle', { p_filial: perfil.filial_id });
      // Sem a migration 0020 no ar, segue sem número em vez de travar a entrada.
      if (errSeq && !dados.placa) {
        return { data: null, error: { message: 'Sem numeração de controle disponível — digite a placa (ou aplique a migration 0020).' } };
      }
      const payload = errSeq ? dados : {
        ...dados,
        controle: proximo,
        // Carro sem placa: o próprio nº de controle vira o identificador, no
        // formato $$$0042 do sistema antigo. Lá o $$$ vinha de um contador
        // separado; aqui é o mesmo número do ticket, então o operador tem um
        // só pra procurar.
        placa: dados.placa || placaSemChapa(proximo),
      };
      const res = await supabase.from('movimentos').insert(payload).select().single();
      if (!res.error) return res;
      const colidiuNoControle = res.error.code === '23505' && String(res.error.message).includes('controle');
      if (!colidiuNoControle) return res;
    }
    return { data: null, error: { message: 'Não consegui reservar um número de controle livre. Tente de novo.' } };
  }

  /**
   * `livreAPartir` (omitido = usa o que `detectar()` calculou, se houver):
   * fora do dia/turno contratado, é o horário em que a saída passa a cobrar
   * avulso só até ali. `undefined` explícito porque `null` é um valor válido
   * (default explícito no parâmetro só entraria com `undefined`).
   */
  async function registrarEntrada(tipoVeic, nomeModelo, tipoMens, convenioCodigo, livreAPartir = livreAPartirEntrada) {
    // Tabela com "Valor antecipado" configurado (ex.: evento/promoção, ver
    // Preços) — normalmente já preenchido em `valorAntecipado` por
    // selecionarModelo(), mas cobre também quem digitou o nome certinho e deu
    // Enter sem clicar na sugestão (prosseguirEntrada/matchExato). Só pra
    // avulso: mensalista/reserva não usam esse fallback (tipoMens vazio é o
    // sinal de entrada avulsa "pura", ver chamada em prosseguirEntrada).
    const antecipadoAuto = !tipoMens && !valorAntecipado ? Number(tabelas[tipoVeic]?.valorAntes || 0) : 0;
    const valorAntecipadoEfetivo = Number(valorAntecipado) || antecipadoAuto;
    // Antecipado (desta entrada + o que já veio de uma reserva) conta como
    // pagamento recebido agora — precisa de caixa aberto pra não ficar de
    // fora do fechamento (ver AbrirCaixaInline). Busca direto no banco (não
    // do state `caixaAberto`): essa mesma função é chamada de novo assim que
    // o operador abre o caixa (ver pendenteCaixa.executar mais abaixo), e o
    // state daquele render ainda não teria atualizado — bateria o gate de
    // novo e tentaria abrir um SEGUNDO caixa (erro de unicidade).
    const precisaCaixa = valorAntecipadoEfetivo
      + Number(reservaParaChegadaRef.current?.placa === placa.trim().toUpperCase()
        ? reservaParaChegadaRef.current?.valor_antecipado || 0 : 0) > 0;
    if (precisaCaixa) {
      const { data: cxAtual } = await supabase.from('caixas').select('*')
        .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
      if (!cxAtual) {
        setPendenteCaixa({ executar: () => registrarEntrada(tipoVeic, nomeModelo, tipoMens, convenioCodigo, livreAPartir) });
        return;
      }
      if (!caixaAberto) setCaixaAberto(cxAtual);
    }
    const p = placa.trim().toUpperCase();
    const dtEntrada = hojeISO();
    const hrEntrada = agoraHHMM();
    const nomeMensalista = detectado?.nome || '';
    const tipoMensFinal = tipoMens ?? detectado?.tipo_mens ?? 'E';
    // `select()` para ter o movimento gravado — é dele que sai o ticket.
    const { data: novo, error } = await inserirComControle({
      filial_id: perfil.filial_id, placa: p, modelo: nomeModelo || null,
      dt_entrada: dtEntrada, hr_entrada: hrEntrada,
      tipo_veic: tipoVeic,
      tipo_mens: tipoMensFinal,
      convenio_codigo: convenioCodigo ?? detectado?.convenio_codigo ?? null,
      livre_a_partir: livreAPartir ?? null,
      usuario_entrada: perfil.id,
      avarias: avarias.trim() || null,
      // Soma o antecipado desta entrada com o que já veio da reserva (se
      // houver) — o da reserva já foi recebido/contado lá no caixa de quando
      // ela foi criada (ver 0040_reserva_antecipado.sql), então NÃO gera um
      // novo movimento_pagamentos abaixo, só entra no total a descontar na saída.
      valor_antecipado: valorAntecipadoEfetivo + Number(reservaParaChegadaRef.current?.placa === p
        ? reservaParaChegadaRef.current?.valor_antecipado || 0 : 0) || null,
      // Dívida trazida de uma saída anterior (ver detectar()) — cobrada
      // junto com esta estadia na saída (dividaAnterior em calcularResultadoSaida).
      valor_dev: dividaDetectadaRef.current || 0,
    });
    if (error) { setErro(error.code === '23505' ? 'Essa placa já está no pátio.' : error.message); return; }
    // Sem Parar (ver docs/SEMPARAR.md): pergunta se esta placa pode pagar
    // por lá — best-effort, não trava a entrada nem o ticket. O resultado só
    // aparece no pátio (badge) e na saída (marcação na forma) quando/se essa
    // chamada terminar antes; sem Sem Parar ligado na filial, nem dispara
    // (o próprio endpoint devolve "desligado" sem custo).
    if (filial?.config?.semparar?.ativo) {
      supabase.auth.getSession().then(({ data: sessao }) => {
        fetch('/api/semparar-autoriza', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session?.access_token}` },
          body: JSON.stringify({ movimentoId: novo.id }),
        }).then(() => recarregar()).catch(() => {});
      });
    }
    // Serviços marcados antes de dar entrada (ver alternarServicoEntrada) —
    // grava agora que o movimento já existe (é o mesmo movimento_servicos
    // que o botão "Serviço" da lista usa, só que preenchido de antemão).
    if (servicosEntrada.length) {
      await supabase.from('movimento_servicos').insert(
        servicosEntrada.map((s) => ({
          filial_id: perfil.filial_id, movimento_id: novo.id, servico_id: s.servico_id, valor: s.valorInformado,
        }))
      );
    }
    // Valor antecipado conta como pagamento recebido AGORA (não só um
    // desconto lá na saída) — liga ao caixa aberto deste momento, que pode
    // ser um turno diferente do que vai fechar a saída (ver
    // 0039_valor_antecipado.sql e Caixa.jsx).
    if (valorAntecipadoEfetivo > 0) {
      const { data: cx } = await supabase.from('caixas').select('id')
        .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
      await supabase.from('movimento_pagamentos').insert({
        filial_id: perfil.filial_id, movimento_id: novo.id,
        forma_pagamento: formaAntecipado || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || 'D',
        valor: valorAntecipadoEfetivo, caixa_id: cx?.id ?? null,
      });
    }
    // Reserva encontrada pra essa placa (ver detectarReserva) — marca só o
    // indicador de chegada, sem tocar no status (ver 0038_reservas_chegou.sql).
    // Lê do ref (não do state reservaDetectada): no caminho de auto-registro,
    // registrarEntrada é chamado na mesma função que acabou de setar o
    // state, antes do React re-renderizar — o state ainda leria o valor
    // antigo (null) ali.
    if (reservaParaChegadaRef.current?.placa === p) {
      await supabase.from('reservas').update({ chegou_em: new Date().toISOString() }).eq('id', reservaParaChegadaRef.current.id);
      reservaParaChegadaRef.current = null;
    }
    // Mensalista/hóspede de verdade (não o que caiu pra avulso por
    // vencimento/vaga/restrição — esse continua mostrando, é cobrança real):
    // respeita a preferência de não parar na tela do ticket.
    if (MENSALISTA.has(tipoMensFinal) && !imprimeTicketMensalista) {
      setCelularTicket('');
      setPlacaTicket('');
      limparFormEntrada();
      recarregar();
      focarPlaca(); // sem ticket pra fechar, ninguém mais devolve o foco à placa
      return;
    }
    setTicket(comModelo('entrada', {
      titulo: 'Ticket de entrada',
      linhas: [
        ...(novo?.controle != null ? [['Controle', String(novo.controle).padStart(4, '0')]] : []),
        ['Placa', novo?.placa || p],
        ['Carro', nomeModelo || '—'],
        ['Tabela', tipoVeic],
        ...(servicosEntrada.length ? [['Serviços', servicosEntrada.map((s) => s.descricao).join(', ')]] : []),
        ...(avarias.trim() ? [['Avarias', avarias.trim()]] : []),
        ...(Number(novo?.valor_dev) > 0 ? [['Dívida anterior', fmtBRL(Number(novo.valor_dev))]] : []),
        ...(Number(novo?.valor_antecipado) > 0 ? [['Valor antecipado', fmtBRL(Number(novo.valor_antecipado))]] : []),
        ['Entrada', `${dtEntrada.split('-').reverse().join('/')} ${fmtHora(Number(hrEntrada))}`],
        ['Operador', perfil.nome],
      ],
    }, {
      ...dadosMovimento({
        movimento: { ...novo, avarias: avarias.trim() || null },
        operador: perfil.nome, servicos: servicosEntrada,
      }),
      MENSALISTA: nomeMensalista,
    }));
    setPlacaTicket(novo?.placa || p);
    setCelularTicket(await celularSalvo(novo?.placa || p));
    limparFormEntrada();
    recarregar();
  }

  async function darEntrada(e) {
    e.preventDefault();
    setErro('');
    const p = placa.trim().toUpperCase();

    // Segurança extra (ex.: Enter sem sair do campo, sem disparar o onBlur).
    const jaNoPatio = encontrarNoPatio(p);
    if (jaNoPatio) { limparFormEntrada(); prepararSaida(jaNoPatio); return; }

    // Enter com a placa em branco: entra sem placa e o nº de controle vira o
    // identificador ($$$0042), como no sistema antigo.
    if (p && !REGEX_PLACA.test(p)) { setConfirmPlaca(p); return; }
    await prosseguirEntrada();
  }

  /**
   * Enter no campo Placa: na cabine o operador não deveria precisar do
   * mouse pra encadear placa -> carro -> Registrar entrada. Placa já no
   * pátio (vai pra saída) ou mal formatada (confirmação "sem chapa") continuam
   * pelo submit nativo do form (mesmo fluxo de sempre) — só quando é mesmo uma
   * entrada nova é que o Enter pula pro campo Carro em vez de tentar submeter
   * cedo demais (e cair no erro "digite um carro do catálogo").
   */
  function onKeyDownPlaca(e) {
    if (e.key !== 'Enter') return;
    const p = placa.trim().toUpperCase();
    if (encontrarNoPatio(p) || (p && !REGEX_PLACA.test(p))) return;
    e.preventDefault();
    buscaModeloRef.current?.focus();
    buscaModeloRef.current?.select();
  }

  /** Enter no campo Carro: fecha as sugestões e passa o foco pro botão
   * "Registrar entrada" — o Enter seguinte (nativo, botão focado) finaliza. */
  function onKeyDownModelo(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Sugestões na tela (mostrarSugestoes) e nenhuma ainda escolhida —
    // assume a primeira da lista (já vem em ordem alfabética, ver
    // `sugestoes` acima), sem precisar tirar a mão do teclado pra clicar.
    if (mostrarSugestoes && sugestoes.length && !modeloSelecionado) selecionarModelo(sugestoes[0]);
    else setMostrarSugestoes(false);
    btnRegistrarRef.current?.focus();
  }

  async function prosseguirEntrada() {
    if (modeloSelecionado) {
      await registrarEntrada(modeloSelecionado.tabela_tipo, modeloSelecionado.nome);
      return;
    }
    // Digitou o nome certinho mas não clicou na sugestão — casa mesmo assim.
    const alvo = normalizar(buscaModelo);
    const matchExato = alvo && modelos.find((m) => normalizar(m.nome) === alvo);
    if (matchExato) {
      await registrarEntrada(matchExato.tabela_tipo, matchExato.nome);
      return;
    }
    if (tabelaManual && nomeCarroNovo.trim()) {
      setConfirmNovo({ nome: nomeCarroNovo.trim(), tipo: tabelaManual });
      return;
    }
    setErro('Digite um carro do catálogo, ou selecione a tabela manual e o nome do carro novo.');
  }

  async function confirmarPlacaForcada() {
    setConfirmPlaca(null);
    await prosseguirEntrada();
  }

  function corrigirPlaca() {
    setConfirmPlaca(null);
    setPlaca('');
    setDetectado(null);
  }

  async function confirmarNovoCarro() {
    if (!confirmNovo) return;
    const { nome, tipo } = confirmNovo;
    const codigo = `AUTO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { data: novo, error } = await supabase.from('modelos_veiculo')
      .insert({ filial_id: perfil.filial_id, codigo, nome, tabela_tipo: tipo, ativo: true })
      .select().single();
    if (error) { setErro(error.message); setConfirmNovo(null); return; }
    setModelos((ms) => [...ms, novo]);
    setConfirmNovo(null);
    await registrarEntrada(tipo, nome);
  }

  async function abrirServicosModal(mov) {
    const { data } = await supabase.from('movimento_servicos').select('servico_id').eq('movimento_id', mov.id);
    setModalServicos({ mov, marcados: new Set((data || []).map((r) => r.servico_id)) });
  }

  /**
   * Serviço cuja tabela de preço tem faixa "Pede valor" (ver Precos.jsx):
   * normalmente é assim que esse tipo de faixa é usado — preço variável por
   * serviço (ex.: lavagem cujo preço depende do carro) — então pergunta o
   * valor aqui, ao MARCAR o serviço, em vez de deixar pra saída como as
   * faixas 'valor' da tabela do próprio veículo/convênio (essas continuam
   * perguntando na saída — ver abrirValorObrigatorioSePreciso).
   */
  function servicoPedeValor(servico) {
    return !!tabelas[servico?.tabela_tipo]?.faixas?.some((f) => f.tipoCobranca === 'valor');
  }

  async function alternarServico(servicoId) {
    if (!modalServicos) return;
    const { mov, marcados } = modalServicos;
    const jaMarcado = marcados.has(servicoId);
    if (!jaMarcado) {
      const servico = servicos.find((s) => s.id === servicoId);
      if (servicoPedeValor(servico)) {
        setModalValorServico({ servicoId, descricao: servico.descricao, valor: '' });
        return;
      }
    }
    const acao = jaMarcado
      ? supabase.from('movimento_servicos').delete().eq('movimento_id', mov.id).eq('servico_id', servicoId)
      : supabase.from('movimento_servicos').insert({ filial_id: perfil.filial_id, movimento_id: mov.id, servico_id: servicoId });
    const { error } = await acao;
    if (error) { setErro(error.message); return; }
    const novosMarcados = new Set(marcados);
    if (jaMarcado) novosMarcados.delete(servicoId); else novosMarcados.add(servicoId);
    setModalServicos({ mov, marcados: novosMarcados });
    setMovimentosComServico((prev) => {
      const proximo = new Set(prev);
      if (novosMarcados.size > 0) proximo.add(mov.id); else proximo.delete(mov.id);
      return proximo;
    });
  }

  async function confirmarValorServico() {
    const valor = Number(modalValorServico.valor);
    if (!(valor >= 0)) { setErro('Informe um valor válido.'); return; }
    const { mov, marcados } = modalServicos;
    const { error } = await supabase.from('movimento_servicos')
      .insert({ filial_id: perfil.filial_id, movimento_id: mov.id, servico_id: modalValorServico.servicoId, valor });
    if (error) { setErro(error.message); return; }
    const novosMarcados = new Set(marcados);
    novosMarcados.add(modalValorServico.servicoId);
    setModalServicos({ mov, marcados: novosMarcados });
    setMovimentosComServico((prev) => new Set(prev).add(mov.id));
    setModalValorServico(null);
  }

  /**
   * Serviços marcados ANTES de dar entrada (ver botão "Serviços" no card
   * de Entrada) — pro cliente que é só lava-rápido, onde o serviço já é
   * sabido no momento em que o carro chega, não depois. Fica em memória
   * até a entrada ser confirmada de verdade (registrarEntrada grava tudo
   * de uma vez, junto com o movimento) — mesmo motivo pelo qual não dá pra
   * usar movimento_servicos aqui ainda: o movimento nem existe.
   */
  function alternarServicoEntrada(servicoId) {
    const jaMarcado = servicosEntrada.some((s) => s.servico_id === servicoId);
    if (jaMarcado) { setServicosEntrada((prev) => prev.filter((s) => s.servico_id !== servicoId)); return; }
    const servico = servicos.find((s) => s.id === servicoId);
    if (servicoPedeValor(servico)) {
      setModalValorServicoEntrada({ servicoId, descricao: servico.descricao, valor: '' });
      return;
    }
    setServicosEntrada((prev) => [...prev, { servico_id: servicoId, descricao: servico.descricao, valorInformado: null }]);
  }

  function confirmarValorServicoEntrada() {
    const valor = Number(modalValorServicoEntrada.valor);
    if (!(valor >= 0)) { setErro('Informe um valor válido.'); return; }
    setServicosEntrada((prev) => [...prev, {
      servico_id: modalValorServicoEntrada.servicoId, descricao: modalValorServicoEntrada.descricao, valorInformado: valor,
    }]);
    setModalValorServicoEntrada(null);
  }

  /** No máximo 5 linhas, 50 caracteres cada — mesmo limite do formulário de papel de sempre. */
  function limitarAvarias(texto) {
    return texto.split('\n').slice(0, 5).map((l) => l.slice(0, 50)).join('\n');
  }

  /**
   * Foto de avaria: NUNCA sobe pro esta — baixa direto pro aparelho de quem
   * está registrando, identificada por placa+data+hora. Sem servidor, sem
   * Supabase Storage, sem rastro nenhum no sistema — é assim que foi pedido.
   */
  function baixarFotoAvaria(file) {
    const p = (placa.trim() || 'SEMPLACA').toUpperCase();
    const agora = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const carimbo = `${agora.getFullYear()}${p2(agora.getMonth() + 1)}${p2(agora.getDate())}_${p2(agora.getHours())}${p2(agora.getMinutes())}${p2(agora.getSeconds())}`;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = `${p}_${carimbo}.jpg`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFotosAvarias((n) => n + 1);
  }

  async function buscarServicosDoMovimento(movimentoId) {
    const { data } = await supabase.from('movimento_servicos').select('servico_id, valor').eq('movimento_id', movimentoId);
    const valorPorServico = new Map((data || []).map((r) => [r.servico_id, r.valor]));
    return servicos
      .filter((s) => valorPorServico.has(s.id))
      .map((s) => ({ ...s, valorInformado: valorPorServico.get(s.id) }));
  }

  // Operador só exclui nos primeiros 5min da entrada; do gerente pra cima, sem limite.
  function podeExcluir(mov) {
    if (ehGerente(perfil)) return true;
    const minutos = (agora - dataHoraDe(mov.dt_entrada, Number(mov.hr_entrada)).getTime()) / 60000;
    return minutos <= EXCLUSAO_JANELA_MIN;
  }

  function abrirExclusao(mov) {
    setModalExclusao({ mov, motivo: '' });
  }

  async function confirmarExclusao() {
    if (!modalExclusao) return;
    const { mov, motivo } = modalExclusao;
    if (!motivo.trim()) { setErro('Informe o motivo da exclusão.'); return; }
    if (!podeExcluir(mov)) {
      setErro(`Prazo de ${EXCLUSAO_JANELA_MIN} minutos para excluir expirou — peça a um supervisor.`);
      setModalExclusao(null);
      return;
    }
    const agoraDt = new Date();
    const { error } = await supabase.from('movimentos').update({
      excluido_em: agoraDt.toISOString(), excluido_motivo: motivo.trim(), excluido_por: perfil.id,
    }).eq('id', mov.id);
    if (error) { setErro(error.message); return; }
    const dataExclusao = `${String(agoraDt.getDate()).padStart(2, '0')}/${String(agoraDt.getMonth() + 1).padStart(2, '0')}/${agoraDt.getFullYear()}`;
    const horaExclusao = `${String(agoraDt.getHours()).padStart(2, '0')}:${String(agoraDt.getMinutes()).padStart(2, '0')}`;
    setTicket({
      titulo: 'Exclusão de veículo',
      linhas: [
        ['Placa', mov.placa],
        ['Modelo', mov.modelo || '—'],
        ['Entrada', `${mov.dt_entrada.split('-').reverse().join('/')} ${fmtHora(Number(mov.hr_entrada))}`],
        ['Exclusão', `${dataExclusao} ${horaExclusao}`],
        ['Motivo', motivo.trim()],
      ],
    });
    setCelularTicket('');
    setPlacaTicket('');
    setModalExclusao(null);
    recarregar();
  }

  function reimprimirExclusao(mov) {
    const dt = new Date(mov.excluido_em);
    const dataExclusao = `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    const horaExclusao = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    setTicket({
      titulo: 'Exclusão de veículo (reimpressão)',
      linhas: [
        ['Placa', mov.placa],
        ['Modelo', mov.modelo || '—'],
        ['Entrada', `${mov.dt_entrada.split('-').reverse().join('/')} ${fmtHora(Number(mov.hr_entrada))}`],
        ['Exclusão', `${dataExclusao} ${horaExclusao}`],
        ['Motivo', mov.excluido_motivo || '—'],
      ],
    });
    setCelularTicket('');
    setPlacaTicket('');
  }

  /**
   * `horaConvenio` (HH.MM): hora em que o cliente saiu do convênio, pedida na
   * saída quando o convênio tem "Pede hora" — o convênio banca até ali e o
   * resto da estadia é cobrado do cliente (ver packages/tarifacao).
   */
  function calcularResultadoSaida(mov, convenioCodigo, servicosSelecionados, bonusFidelidade = 0, horaConvenio) {
    if (MENSALISTA.has(mov.tipo_mens)) {
      // Mensalista: já paga a mensalidade; saída sem cobrança nesta fase.
      return { valor: 0, valorProporcional: 0, valorConvenio: 0, pontos: 0, mensalista: true, tempoDecorrido: 0 };
    }

    // Serviços com valor já informado ao marcar (ver servicoPedeValor) somam
    // direto, fora do motor — os demais entram na soma por tabela de sempre.
    const comValor = (servicosSelecionados || []).filter((s) => s.valorInformado != null);
    const semValor = (servicosSelecionados || []).filter((s) => s.valorInformado == null);
    const somaServicosComValor = comValor.reduce((t, s) => t + Number(s.valorInformado), 0);
    const servicosTipos = semValor.map((s) => s.tabela_tipo);
    // Só serviço(s) com valor, nenhum por tabela: sem isso o motor cairia de
    // volta na tabela do VEÍCULO (servicosTipos vazio = "nenhum serviço") e
    // cobraria os dois juntos — mas a regra é sempre "em vez da tabela do
    // veículo", nunca além dela (ver texto do modal de Serviços).
    const soServicoComValor = comValor.length > 0 && semValor.length === 0;
    // Pontos de fidelidade: quando tem serviço marcado, são sempre a soma
    // das tabelas dos serviços (comValor + semValor juntos) — o motor só
    // soma os de `servicosTipos` (semValor), então o de comValor (ex.: um
    // serviço "Pede valor" com qte_pontos configurado) ficaria de fora se
    // não somar aqui também.
    const pontosServicos = (servicosSelecionados || [])
      .reduce((t, s) => t + Number(tabelas[s.tabela_tipo]?.qtePontos || 0), 0);
    // Soma nos dois: valorProporcional (o "cheio") e valor (o cobrado) andam
    // juntos aqui, sem desconto de convênio — sem isso o BI via a diferença
    // entre os dois como se fosse desconto de convênio, o que não é.
    const comSomaServicos = (resultado) => ({
      ...resultado,
      ...(soServicoComValor ? { valorConvenio: 0, manual: false, pedeValor: false } : {}),
      ...((servicosSelecionados || []).length ? { pontos: pontosServicos } : {}),
      valorProporcional: Math.round(((soServicoComValor ? 0 : resultado.valorProporcional) + somaServicosComValor) * 100) / 100,
      valor: Math.round(((soServicoComValor ? 0 : resultado.valor) + somaServicosComValor) * 100) / 100,
    });
    // Desconto de faixa de bônus (ver Cadastros → Faixas de bônus): aplicado
    // por cima do total já pronto (tabela + convênio + serviços) — precisa
    // ser DEPOIS do comSomaServicos, não dentro do motor, senão o desconto
    // some no caso "só serviço com valor" (ali o motor descarta o próprio
    // valor calculado, ver comSomaServicos acima). Piso em zero, igual ao
    // resto do pipeline.
    const comBonus = (resultado) => (
      bonusFidelidade > 0
        ? { ...resultado, valor: Math.max(0, Math.round((resultado.valor - bonusFidelidade) * 100) / 100) }
        : resultado
    );
    // Valor antecipado (pago na entrada, ver 0039_valor_antecipado.sql) —
    // só mexe em `.valor` (o cobrado), nunca em `.valorProporcional` (o
    // "cheio"), mesmo raciocínio do comBonus: não é desconto de convênio,
    // não pode entrar na conta de "Convênio" do BI.
    const valorAntecipadoMov = Number(mov.valor_antecipado || 0);
    const comAntecipado = (resultado) => (
      valorAntecipadoMov > 0
        ? { ...resultado, valor: Math.max(0, Math.round((resultado.valor - valorAntecipadoMov) * 100) / 100), valorAntecipado: valorAntecipadoMov }
        : { ...resultado, valorAntecipado: 0 }
    );

    // Entrou fora do dia/turno contratado (ver detectar()): cobra avulso só
    // até o horário guardado em livre_a_partir — dali em diante já está
    // dentro do período contratado, sem cobrança. Só vale no mesmo dia da
    // entrada (a restrição não tenta prever o dia seguinte), só depois que a
    // saída realmente ultrapassa esse horário (antes disso é avulso normal,
    // pela permanência real — o boundary nunca chegou a valer), e só sem
    // convênio escolhido à mão (escolha do operador tem prioridade).
    if (!convenioCodigo && mov.livre_a_partir != null && mov.dt_entrada === hojeISO() && agoraHHMM() > Number(mov.livre_a_partir)) {
      const parcial = calcularTarifa({
        tabelas, tipoVeic: mov.tipo_veic,
        servicosTipos: servicosTipos.length ? servicosTipos : undefined,
        movimento: {
          dtEntrada: dataDeISO(mov.dt_entrada), entrada: Number(mov.hr_entrada),
          dtSaida: dataDeISO(mov.dt_entrada), saida: Number(mov.livre_a_partir),
        },
        // Saldo devedor trazido de uma visita anterior (ver detectar() e
        // registrarEntrada) — o motor já soma isso ao final, sem mexer em
        // valorProporcional (não é desconto de convênio nem precisa de
        // wrapper, como antecipado/bônus — é nativo do pipeline).
        dividaAnterior: Number(mov.valor_dev || 0),
      });
      return comBonus(comAntecipado(comSomaServicos({
        ...parcial,
        // Tempo mostrado ao operador é o real (quanto tempo o carro ficou),
        // mesmo cobrando só a parte fora do horário contratado.
        tempoDecorrido: horasDecorridas({ dtEntrada: dataDeISO(mov.dt_entrada), entrada: Number(mov.hr_entrada), dtSaida: new Date(), saida: agoraHHMM() }),
        restricaoAte: Number(mov.livre_a_partir),
      })));
    }

    const convenio = convenioCodigo ? mapConvenio(convenios[convenioCodigo]) : undefined;
    return comBonus(comAntecipado(comSomaServicos(calcularTarifa({
      tabelas, tipoVeic: mov.tipo_veic, convenio,
      servicosTipos: servicosTipos.length ? servicosTipos : undefined,
      movimento: { dtEntrada: dataDeISO(mov.dt_entrada), entrada: Number(mov.hr_entrada), dtSaida: new Date(), saida: agoraHHMM() },
      dividaAnterior: Number(mov.valor_dev || 0),
      // Só divide em dois trechos com uma hora de corte válida digitada — em
      // branco (ou 0) o convênio cobre a estadia inteira, como sempre.
      horaConvenio: Number(horaConvenio) > 0 ? Number(horaConvenio) : undefined,
    }))));
  }

  /**
   * Faixa "Pede valor" (ver Precos.jsx): sem número configurado, o motor
   * devolve `pedeValor: true` e o operador precisa informar quanto cobrar
   * antes de conseguir confirmar a saída — abre o mesmo modal do "Alterar
   * valor" do menu ⋮, só que obrigatório (vazio, não pré-preenchido, e sem
   * marcar `valorCalculado`/o "*" — não houve valor calculado pra alterar,
   * é assim que essa faixa sempre cobra).
   */
  function abrirValorObrigatorioSePreciso(resultado) {
    if (resultado.pedeValor) setModalValor({ valor: '', obrigatorio: true });
  }

  async function pontosAcumulados(placa) {
    try {
      const { data } = await supabase.from('clientes').select('qte_pontos')
        .eq('placa', placa.trim().toUpperCase()).maybeSingle();
      return Number(data?.qte_pontos || 0);
    } catch { return 0; }
  }

  /**
   * Faixas de bônus (Cadastros → Faixas de bônus, mantidas pelo cliente do
   * Eduardo): se os pontos já acumulados + os que esta saída vai render
   * alcançam alguma faixa, oferece a MAIOR faixa alcançada (bonusFaixas já
   * vem ordenada da maior pra menor) — o operador decide usar agora ou
   * seguir acumulando pra próxima.
   */
  async function avaliarBonus(resultado, placa) {
    if (!bonusFaixas.length || resultado.mensalista) return null;
    const pontosAtual = await pontosAcumulados(placa);
    const pontosProjetados = pontosAtual + Number(resultado.pontos || 0);
    const faixa = bonusFaixas.find((f) => Number(f.pontos_necessarios) <= pontosProjetados);
    return faixa ? { faixa, pontosAtual, pontosProjetados } : null;
  }

  async function prepararSaida(mov) {
    try {
      const servicosSelecionados = await buscarServicosDoMovimento(mov.id);
      const convenioCodigo = mov.convenio_codigo || '';
      const horaConvenio = horaConvenioSugerida(convenioCodigo);
      const resultado = calcularResultadoSaida(mov, convenioCodigo, servicosSelecionados, 0, horaConvenio);
      const formaPadrao = formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || 'D';
      const pagamentos = [{ forma: formaPadrao, valor: resultado.valor }];

      // Mensalista/hóspede de verdade (mensalidade em dia e dentro do
      // horário contratado — é exatamente isso que faz calcularResultadoSaida
      // devolver mensalista:true; quem caiu pra avulso por vencimento/vaga/
      // restrição tem mensalista:false e continua parando aqui, é cobrança
      // real). Sem valor a cobrar e sem bônus a oferecer (avaliarBonus já
      // ignora esse caso) — não tem por que parar pedindo confirmação, mesmo
      // raciocínio da entrada automática dele.
      if (resultado.mensalista) {
        await confirmarSaida(null, { mov, convenioCodigo, servicosSelecionados, resultado, bonusAplicado: null, pagamentos });
        return;
      }

      setSaindo({ mov, convenioCodigo, horaConvenio, servicosSelecionados, resultado, bonusAplicado: null, bonusDisponivel: null, pagamentos });
      abrirValorObrigatorioSePreciso(resultado);
      const bonus = await avaliarBonus(resultado, mov.placa);
      if (bonus) { setSaindo((s) => (s ? { ...s, bonusDisponivel: bonus } : s)); setModalBonus(bonus); return; }
      // "Emitir RPS/DPS em toda saída" (Configurações → Fiscal) — em vez de
      // esperar o operador lembrar de abrir "Mais opções → Gerar DPS", já
      // abre sozinho quando tem valor certo pra cobrar (pedeValor ainda
      // pendente fica pro fluxo manual depois, ver abrirModalDps ali
      // embaixo). Documento em branco continua permitido nessa tela (emite
      // sem identificação) — quem não quiser DPS nesta saída específica só
      // cancela o modal, sem perder o valor calculado.
      if (filial?.config?.nfse?.emitirTodaSaida && resultado.valor > 0 && !resultado.pedeValor) {
        await abrirModalDps(mov);
        return;
      }
      // Sem convênio, sem valor obrigatório pra confirmar e pagando em
      // dinheiro (o padrão de prepararSaida) — placa/nº de ticket digitado e
      // Enter já finaliza, sem precisar de mouse. Convênio, bônus disponível
      // ou forma diferente de dinheiro continuam exigindo o operador olhar
      // antes de confirmar (ver mudarConvenioSaida/setPagamentos, que tiram o
      // foco de novo ao trocar algo).
      const formaEhDinheiro = formas.find((f) => f.codigo === pagamentos[0]?.forma)?.eh_dinheiro;
      if (!convenioCodigo && !resultado.pedeValor && pagamentos.length === 1 && formaEhDinheiro) {
        requestAnimationFrame(() => btnConfirmarSaidaRef.current?.focus());
      }
    } catch (e) { setErro(e.message); }
  }

  /** Cancelar a saída (botão ou clique fora do card) — sem isso o foco ficava
   * perdido em vez de voltar pro campo Placa, pro operador seguir digitando. */
  function cancelarSaida() {
    setSaindo(null);
    focarPlaca();
  }

  function mudarConvenioSaida(codigo) {
    if (!saindo) return;
    try {
      // Trocar de convênio refaz a hora de corte: a anterior era do convênio
      // antigo (e o novo pode nem pedir hora).
      const horaConvenio = horaConvenioSugerida(codigo);
      const resultado = calcularResultadoSaida(saindo.mov, codigo, saindo.servicosSelecionados, 0, horaConvenio);
      const formaAtual = saindo.pagamentos[0]?.forma || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || 'D';
      // Convênio pode trocar a tabela (Tabela alt.), o que muda os pontos —
      // reavalia o bônus do zero, descarta o que tinha sido aplicado antes.
      setSaindo({ ...saindo, convenioCodigo: codigo, horaConvenio, resultado, bonusAplicado: null, bonusDisponivel: null, pagamentos: [{ forma: formaAtual, valor: resultado.valor }] });
      abrirValorObrigatorioSePreciso(resultado);
      avaliarBonus(resultado, saindo.mov.placa).then((bonus) => {
        if (bonus) { setSaindo((s) => (s ? { ...s, bonusDisponivel: bonus } : s)); setModalBonus(bonus); }
      });
    } catch (e) { setErro(e.message); }
  }

  /**
   * Hora de corte já sugerida ao abrir a saída: a de AGORA, que é o caso mais
   * comum (o cliente saiu do convênio e veio direto pro portão) — aí os dois
   * períodos coincidem e o convênio cobre tudo, igual a não preencher. Quando
   * ele passeou antes de sair, o operador corrige pra hora do ticket.
   * Formatada com 2 casas ("14.05", "14.30") pra ficar legível como HH.MM.
   * Convênio que não pede hora fica em branco (o campo nem aparece).
   */
  function horaConvenioSugerida(codigo) {
    return convenios[codigo]?.pede_hora ? agoraHHMM().toFixed(2) : '';
  }

  /**
   * Hora em que o cliente saiu do convênio (convênio com "Pede hora"): o
   * convênio banca até esse horário e o resto vira estadia normal, paga pelo
   * cliente (ver calcularResultadoSaida/tarifacao). Recalcula a cada
   * digitação — o operador vê o valor mudando enquanto confere o ticket.
   */
  function mudarHoraConvenio(valor) {
    if (!saindo) return;
    try {
      const resultado = calcularResultadoSaida(
        saindo.mov, saindo.convenioCodigo, saindo.servicosSelecionados, saindo.bonusAplicado?.valor_desconto || 0, valor
      );
      const formaAtual = saindo.pagamentos[0]?.forma || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || 'D';
      setSaindo((s) => ({ ...s, horaConvenio: valor, resultado, pagamentos: [{ forma: formaAtual, valor: resultado.valor }] }));
    } catch (e) { setErro(e.message); }
  }

  /** Aplica a faixa de bônus oferecida — desconta valor_desconto e consome os pontos dela. */
  function confirmarBonus() {
    if (!modalBonus || !saindo) return;
    const resultado = calcularResultadoSaida(
      saindo.mov, saindo.convenioCodigo, saindo.servicosSelecionados, modalBonus.faixa.valor_desconto, saindo.horaConvenio
    );
    setSaindo((s) => ({
      ...s, resultado, bonusAplicado: modalBonus.faixa,
      pagamentos: [{ forma: s.pagamentos[0]?.forma || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || 'D', valor: resultado.valor }],
    }));
    setModalBonus(null);
  }

  /**
   * `movAlvo`: normalmente vem do `saindo` já em tela (clique manual em
   * "Mais opções → Gerar DPS", onde o closure já está atualizado); passado
   * explícito só quando chamado de dentro de prepararSaida (emissão
   * automática) — ali `saindo` ainda não existe neste fechamento da função,
   * só depois do próximo render, então ler `saindo?.mov` direto pegaria o
   * valor antigo (ou nenhum).
   */
  async function abrirModalDps(movAlvo = saindo?.mov) {
    setModalDps({ documento: '', nome: '', issRetido: '' });
    setErroCnpj('');
    // Memória por placa (ver src/lib/issRetido.js) — se essa placa já teve
    // o recolhimento de ISS descoberto/corrigido antes, vem preenchido
    // sozinho, sem repetir o ciclo de rejeição da prefeitura.
    const salvo = await issRetidoDaPlaca(supabase, movAlvo?.placa);
    if (salvo) setModalDps((s) => (s ? { ...s, issRetido: AR_PARA_ABRASF[salvo] } : s));
  }

  /**
   * Preenche o nome/razão social a partir do CNPJ (dado público — ver
   * src/lib/cnpj.js). Só vale pra CNPJ: CPF não tem consulta pública
   * equivalente (protegido por sigilo fiscal).
   */
  async function buscarNomePorCnpj() {
    setErroCnpj(''); setBuscandoCnpj(true);
    const r = await buscarCnpj(modalDps.documento);
    setBuscandoCnpj(false);
    if (r.erro) { setErroCnpj(r.erro); return; }
    setModalDps((s) => ({ ...s, nome: r.nome || s.nome }));
  }

  function abrirModalValor() {
    setModalValor({ valor: String(saindo.resultado.valor), obrigatorio: false });
  }

  /**
   * Confirma o valor digitado no modal — serve tanto pro "Alterar valor"
   * opcional do ⋮ quanto pro obrigatório da faixa "Pede valor"
   * (`modalValor.obrigatorio` distingue os dois): o opcional guarda o valor
   * original em `valorCalculado` (pra marcar "*" nas listagens; se alterar de
   * novo, o original continua sendo o do motor, não o da alteração anterior);
   * o obrigatório não — não houve valor calculado, é assim que a faixa cobra.
   * Os dois zeram `pedeValor` e o pagamento acompanha o valor novo.
   */
  function confirmarAlteracaoValor() {
    const novo = Number(modalValor.valor);
    if (!(novo >= 0)) { setErro('Informe um valor válido.'); return; }
    setSaindo((s) => ({
      ...s,
      ...(modalValor.obrigatorio ? {} : { valorCalculado: s.valorCalculado ?? s.resultado.valor }),
      resultado: {
        ...s.resultado,
        valor: novo,
        // "Pede valor" não tinha cálculo nenhum — o "cheio" é o que foi
        // digitado. "Alterar valor" só sobe o cheio se o novo valor passar
        // do que a tabela tinha calculado (senão o BI mostraria desconto
        // negativo — Faturamento nunca pode ficar abaixo do que foi cobrado).
        valorProporcional: modalValor.obrigatorio ? novo : Math.max(s.resultado.valorProporcional, novo),
        pedeValor: false,
      },
      pagamentos: [{ forma: s.pagamentos[0]?.forma || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || 'D', valor: novo }],
    }));
    setModalValor(null);
  }

  /**
   * "Cadastrar senha do mês" (menu ⋮) — qualquer pessoa da filial que
   * recebeu a senha do fornecedor por WhatsApp digita ela aqui, sem
   * precisar do fornecedor. O cálculo/comparação roda só no servidor (ver
   * api/cadastrar-senha-mes.js) — esta tela nunca sabe se está certa, o
   * cadastro aceita qualquer coisa, só é conferido no 1º acesso do mês.
   * 6 campos fixos (um por posição da fila): os já cadastrados aparecem em
   * texto normal (travados) — quem cadastra já tinha esse valor em mãos, não
   * tem problema mostrar de volta — e "Cadastrar" manda de uma vez só os
   * campos vazios que foram preenchidos.
   */
  async function chamarSenhaMes(body) {
    const { data: sessao } = await supabase.auth.getSession();
    const resp = await fetch('/api/cadastrar-senha-mes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session?.access_token}` },
      body: JSON.stringify(body),
    });
    return { ok: resp.ok, dados: await resp.json().catch(() => ({})) };
  }

  async function atualizarListaSenhaMes() {
    const { ok, dados } = await chamarSenhaMes({ acao: 'listar' });
    const travadas = ok ? (dados.senhas || []) : [];
    setModalSenhaMes((m) => ({
      ...(m || {}),
      ocupado: false,
      travadas,
      campos: Array.from({ length: 6 - travadas.length }, () => ''),
    }));
  }

  function abrirModalSenhaMes() {
    setModalSenhaMes({ travadas: null, campos: [], erro: '', ocupado: false });
    atualizarListaSenhaMes();
  }

  async function cadastrarSenhaMes() {
    const pendentes = modalSenhaMes.campos.filter((c) => c.trim());
    if (pendentes.length === 0) return;
    setModalSenhaMes((m) => ({ ...m, ocupado: true, erro: '' }));
    for (const senha of pendentes) {
      const { ok, dados } = await chamarSenhaMes({ senha });
      if (!ok || dados.erro) {
        setModalSenhaMes((m) => ({ ...m, ocupado: false, erro: dados.erro || 'Não deu pra cadastrar.' }));
        return;
      }
    }
    await atualizarListaSenhaMes();
  }

  async function removerUltimaSenhaMes() {
    setModalSenhaMes((m) => ({ ...m, ocupado: true, erro: '' }));
    const { ok, dados } = await chamarSenhaMes({ acao: 'remover_ultima' });
    if (!ok || dados.erro) {
      setModalSenhaMes((m) => ({ ...m, ocupado: false, erro: dados.erro || 'Não deu pra remover.' }));
      return;
    }
    await atualizarListaSenhaMes();
  }

  /**
   * `dadosOverride`: usado só pela saída automática de mensalista em dia
   * (ver prepararSaida) — ali o card de confirmação nunca chega a abrir
   * (não faz sentido piscar e sumir na tela), então os dados vêm direto,
   * sem passar pelo estado `saindo`.
   */
  async function confirmarSaida(tomadorDps, dadosOverride) {
    const { mov, resultado, pagamentos, convenioCodigo, valorCalculado, bonusAplicado, servicosSelecionados, horaConvenio } = dadosOverride || saindo;
    // Cobrança real (dinheiro entrando agora) precisa de caixa aberto pra não
    // ficar de fora do fechamento — mensalista/hóspede sem pagamento (todos
    // os itens de `pagamentos` zerados) não passa por aqui. Busca direto no
    // banco (não do state `caixaAberto`): esta função é chamada de novo assim
    // que o operador abre o caixa (pendenteCaixa.executar), e o state daquele
    // render ainda não teria atualizado — bateria o gate de novo e tentaria
    // abrir um SEGUNDO caixa (erro de unicidade).
    if ((pagamentos || []).some((p) => Number(p.valor) > 0)) {
      const { data: cxAtual } = await supabase.from('caixas').select('*')
        .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
      if (!cxAtual) {
        setPendenteCaixa({ executar: () => confirmarSaida(tomadorDps, dadosOverride) });
        return;
      }
      if (!caixaAberto) setCaixaAberto(cxAtual);
    }
    const dtSaida = hojeISO();
    const hrSaida = agoraHHMM();

    // Sem Parar (ver docs/SEMPARAR.md): só roda quando o operador escolheu
    // essa forma nas formas de pagamento — nunca sozinho. Fica ANTES de
    // qualquer efeito colateral (caixa, movimento, pagamento): se o Sem
    // Parar recusar, a saída não avança nem um pouco — o operador só troca
    // de forma e confirma de novo.
    const formaSemParar = formas.find((f) => f.eh_semparar);
    const pagSemParar = formaSemParar
      ? (pagamentos || []).find((p) => p.forma === formaSemParar.codigo && Number(p.valor) > 0)
      : null;
    if (pagSemParar) {
      const { data: sessao } = await supabase.auth.getSession();
      const resp = await fetch('/api/semparar-saida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session?.access_token}` },
        body: JSON.stringify({ movimentoId: mov.id, valor: Number(pagSemParar.valor), dtSaida, hrSaida }),
      });
      const dadosSemParar = await resp.json().catch(() => ({}));
      if (!resp.ok || !dadosSemParar.ok) {
        setErro(dadosSemParar.erro || 'Sem Parar recusou o pagamento — escolha outra forma.');
        return;
      }
    }

    // Liga ao caixa aberto do operador (se houver), para o fechamento.
    const { data: cx } = await supabase.from('caixas').select('id')
      .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
    const valorFoiAlterado = valorCalculado != null && valorCalculado !== resultado.valor;
    const { error } = await supabase.from('movimentos').update({
      dt_saida: dtSaida, hr_saida: hrSaida,
      convenio_codigo: convenioCodigo || null,
      // Hora em que o cliente saiu do convênio (ver mudarHoraConvenio) — o
      // que dividiu a cobrança em dois trechos. Guardada pra reimpressão e
      // pra explicar depois por que a conta ficou nesse valor.
      hora_convenio: Number(horaConvenio) > 0 ? Number(horaConvenio) : 0,
      valor: resultado.valor, valor_proporcional: resultado.valorProporcional,
      valor_convenio: resultado.valorConvenio, pontos_ganhos: resultado.pontos,
      bonus_fidelidade: bonusAplicado?.valor_desconto || 0,
      caixa_id: cx?.id ?? null, usuario_saida: perfil.id,
      // Só marca alteração se o valor final ficou mesmo diferente do calculado
      // (dá pra abrir o modal e confirmar o mesmo valor — isso não é alteração).
      valor_calculado: valorFoiAlterado ? valorCalculado : null,
      usuario_altera: valorFoiAlterado ? perfil.id : null,
      dt_altera: valorFoiAlterado ? new Date().toISOString() : null,
      // Tinha autorização Sem Parar mas o operador cobrou por outra forma —
      // marca só pra registro (não existe endpoint pra "desistir" de uma
      // mera autorização, só de uma transação já confirmada — ver
      // docs/SEMPARAR.md). Sem autorização nenhuma, nem mexe no campo.
      ...(!pagSemParar && mov.semparar_status === 'autorizado' ? { semparar_status: 'nao_utilizado' } : {}),
    }).eq('id', mov.id);
    if (error) { setErro(error.message); return; }

    // Rateio de pagamento.
    const pagos = pagamentos.filter((p) => Number(p.valor) > 0);
    const linhasPag = pagos.map((p) => ({ filial_id: perfil.filial_id, movimento_id: mov.id, forma_pagamento: p.forma, valor: Number(p.valor) }));
    if (linhasPag.length) await supabase.from('movimento_pagamentos').insert(linhasPag);

    // Fidelidade (best-effort) — desconta os pontos da faixa de bônus usada,
    // se algum foi aplicado nesta saída (ver confirmarBonus).
    if (!resultado.mensalista) {
      await atualizarFidelidade(mov.placa, resultado.pontos - (bonusAplicado?.pontos_necessarios || 0));
    }

    // Forma "Devedor" (ver Cadastros → Formas de pagamento, eh_devedor): a
    // parte paga com ela não entrou em caixa — vira saldo devedor da placa,
    // cobrado junto com a estadia da próxima entrada (dividaAnterior/valor_dev,
    // ver detectar() e calcularResultadoSaida acima). Zera/atualiza mesmo
    // quando não há dívida nova, pra não deixar um saldo velho pendurado.
    const formasDevedor = new Set(formas.filter((f) => f.eh_devedor).map((f) => f.codigo));
    const novaDivida = pagos.filter((p) => formasDevedor.has(p.forma)).reduce((s, p) => s + Number(p.valor), 0);
    if (novaDivida > 0 || Number(mov.valor_dev || 0) > 0) {
      await atualizarSaldoDevedor(mov.placa, novaDivida);
    }

    let ticketRps = null;
    if (tomadorDps) {
      const { error: errNota, nota } = await criarNotaFiscal(supabase, {
        filialId: perfil.filial_id, movimentoId: mov.id, competencia: dtSaida,
        valor: resultado.valor, tomador: tomadorDps,
      });
      if (errNota) setErro(errNota);
      // Com nota gerada, o comprovante de saída ganha o botão "Imprimir RPS".
      if (nota) {
        ticketRps = montarTicketRps({
          nota, filial, modelo: modelosTicket.rps,
          movimento: { ...mov, dt_saida: dtSaida, hr_saida: hrSaida, valor: resultado.valor },
        });
      }
      // Memória por placa (ver src/lib/issRetido.js): o operador confirmou/
      // corrigiu o recolhimento pra esta placa — guarda pra não perguntar
      // de novo na próxima visita dela.
      if (tomadorDps.issRetido) {
        await salvarIssRetidoDaPlaca(supabase, perfil.filial_id, mov.placa, ABRASF_PARA_AR[tomadorDps.issRetido]);
      }
    }
    setModalDps(null);

    const formaTexto = resultado.mensalista ? 'Mensalista/hóspede'
      : (pagos.map((p) => formas.find((f) => f.codigo === p.forma)?.descricao || p.forma).join(' + ') || '—');
    const ticketSaida = comModelo('saida', {
      titulo: 'Ticket de saída',
      linhas: [
        ...(mov.controle != null ? [['Controle', String(mov.controle).padStart(4, '0')]] : []),
        ['Placa', mov.placa],
        ['Carro', mov.modelo || '—'],
        ['Entrada', `${mov.dt_entrada.split('-').reverse().join('/')} ${fmtHora(Number(mov.hr_entrada))}`],
        ['Tempo', resultado.mensalista ? '—' : fmtHora(resultado.tempoDecorrido)],
        ...(servicosSelecionados?.length ? [['Serviços', servicosSelecionados.map((s) => s.descricao).join(', ')]] : []),
        ...(convenioCodigo && resultado.valorConvenio > 0
          ? [['Convênio', convenioCodigo], ['Valor convênio', `-${fmtBRL(resultado.valorConvenio)}`]]
          : []),
        ...(Number(mov.valor_dev) > 0 ? [['Dívida anterior', `+${fmtBRL(Number(mov.valor_dev))}`]] : []),
        ...(resultado.valorAntecipado > 0 ? [['Valor antecipado', `-${fmtBRL(resultado.valorAntecipado)}`]] : []),
        ...(bonusAplicado ? [['Bônus fidelidade', `-${fmtBRL(bonusAplicado.valor_desconto)}`]] : []),
        ['Valor', fmtBRL(resultado.valor)],
        ['Pagamento', formaTexto],
        ['Saída', `${dtSaida.split('-').reverse().join('/')} ${fmtHora(Number(hrSaida))}`],
        ['Operador', perfil.nome],
      ],
    }, {
      ...dadosMovimento({
        movimento: { ...mov, dt_saida: dtSaida, hr_saida: hrSaida, valor: resultado.valor, bonus_fidelidade: bonusAplicado?.valor_desconto || 0 },
        resultado, operador: perfil.nome,
        servicos: servicosSelecionados, convenio: convenios[convenioCodigo],
      }),
      MOEDA: formaTexto,
    });
    // Contraiu dívida nova nesta saída (forma "Devedor") — ticket dedicado,
    // igual ao TICKETD.TXT do legado (ver atualizarSaldoDevedor acima).
    const ticketDivida = novaDivida > 0 ? comModelo('divida', {
      titulo: 'Ticket de dívida',
      linhas: [
        ['Placa', mov.placa],
        ['Carro', mov.modelo || '—'],
        ['Data', `${dtSaida.split('-').reverse().join('/')} ${fmtHora(Number(hrSaida))}`],
        ['Valor devido', fmtBRL(novaDivida)],
      ],
    }, {
      ...dadosMovimento({ movimento: { ...mov, dt_saida: dtSaida, hr_saida: hrSaida }, operador: perfil.nome }),
      ...dadosDivida(novaDivida),
    }) : null;
    // Mensalista/hóspede de verdade (sem cobrança) respeita a preferência de
    // não parar na tela do ticket — quem foi cobrado (mesmo um mensalista
    // fora do horário/vencido) sempre vê o comprovante, é dinheiro de verdade.
    if (!(resultado.mensalista && !imprimeTicketMensalista)) {
      setTicket({ ...ticketSaida, ticketRps, ticketDivida });
      setPlacaTicket(mov.placa);
      setCelularTicket(await celularSalvo(mov.placa));
    }
    setSaindo(null); recarregar();
    if (resultado.mensalista && !imprimeTicketMensalista) focarPlaca(); // sem ticket pra fechar, idem
  }

  async function reimprimirSaida(mov) {
    const { data: pagtos } = await supabase.from('movimento_pagamentos')
      .select('forma_pagamento, valor').eq('movimento_id', mov.id);
    const formaTexto = pagtos && pagtos.length
      ? pagtos.map((p) => formas.find((f) => f.codigo === p.forma_pagamento)?.descricao || p.forma_pagamento).join(' + ')
      : (MENSALISTA.has(mov.tipo_mens) ? 'Mensalista/hóspede' : '—');
    const valorConvenio = Number(mov.valor_convenio || 0);
    const servicosDoMov = await buscarServicosDoMovimento(mov.id);
    // O resultado do motor não fica gravado; pra reimpressão basta o que está
    // no movimento + a permanência recalculada a partir dos horários.
    const permanencia = permanenciaDe(mov);
    setTicket(comModelo('saida', {
      titulo: 'Ticket de saída (reimpressão)',
      linhas: [
        ['Placa', mov.placa],
        ['Carro', mov.modelo || '—'],
        ['Entrada', `${mov.dt_entrada.split('-').reverse().join('/')} ${fmtHora(Number(mov.hr_entrada))}`],
        ...(servicosDoMov.length ? [['Serviços', servicosDoMov.map((s) => s.descricao).join(', ')]] : []),
        ...(mov.convenio_codigo && valorConvenio > 0
          ? [['Convênio', mov.convenio_codigo], ['Valor convênio', `-${fmtBRL(valorConvenio)}`]]
          : []),
        ['Valor', fmtBRL(Number(mov.valor || 0))],
        ['Pagamento', formaTexto],
        ['Saída', `${mov.dt_saida.split('-').reverse().join('/')} ${fmtHora(Number(mov.hr_saida))}`],
        ['Reimpresso por', perfil.nome],
      ],
    }, {
      ...dadosMovimento({
        movimento: mov,
        resultado: { valor: Number(mov.valor || 0), valorConvenio, tempoDecorrido: permanencia },
        operador: perfil.nome, servicos: servicosDoMov, convenio: convenios[mov.convenio_codigo],
      }),
      MOEDA: formaTexto,
    }));
    setPlacaTicket(mov.placa);
    setCelularTicket(await celularSalvo(mov.placa));
  }

  /**
   * 2ª via do comprovante de entrada — o cliente perdeu o ticket e o veículo
   * ainda está no pátio. O modelo padrão traz o termo de retirada com
   * assinatura, como no TICKET2 do sistema antigo.
   */
  async function segundaVia(mov) {
    setTicket(comModelo('segunda_via', {
      titulo: 'Ticket de entrada (2ª via)',
      linhas: [
        ...(mov.controle != null ? [['Controle', String(mov.controle).padStart(4, '0')]] : []),
        ['Placa', mov.placa],
        ['Carro', mov.modelo || '—'],
        ['Tabela', mov.tipo_veic],
        ['Entrada', `${mov.dt_entrada.split('-').reverse().join('/')} ${fmtHora(Number(mov.hr_entrada))}`],
        ['Reimpresso por', perfil.nome],
      ],
    }, dadosMovimento({ movimento: mov, operador: perfil.nome })));
    setPlacaTicket(mov.placa);
    setCelularTicket(await celularSalvo(mov.placa));
  }

  /**
   * Celular salvo pra essa placa (cadastro em `clientes`, o mesmo da
   * fidelidade) — pra pré-preencher o campo de WhatsApp em vez de vir em
   * branco de novo a cada entrada/saída do mesmo carro.
   */
  async function celularSalvo(placa) {
    try {
      const { data } = await supabase.from('clientes').select('telefone')
        .eq('placa', placa.trim().toUpperCase()).maybeSingle();
      return data?.telefone || '';
    } catch { return ''; }
  }

  async function atualizarFidelidade(placa, pontos) {
    try {
      const { data: c } = await supabase.from('clientes').select('*').eq('placa', placa).maybeSingle();
      if (c) {
        await supabase.from('clientes').update({
          qte_visitas: (c.qte_visitas || 0) + 1, qte_pontos: Number(c.qte_pontos || 0) + Number(pontos || 0), ult_visita: hojeISO(),
        }).eq('id', c.id);
      } else {
        await supabase.from('clientes').insert({
          filial_id: perfil.filial_id, placa, qte_visitas: 1, qte_pontos: Number(pontos || 0), ult_visita: hojeISO(),
        });
      }
    } catch { /* fidelidade é best-effort */ }
  }

  // Saldo devedor da placa (ver confirmarSaida, forma "Devedor") — mesmo
  // padrão de find-or-create de atualizarFidelidade, mas substitui o valor
  // (não soma): `novaDivida` já é o total do saldo depois desta saída.
  async function atualizarSaldoDevedor(placa, saldo) {
    try {
      const { data: c } = await supabase.from('clientes').select('id').eq('placa', placa).maybeSingle();
      if (c) {
        await supabase.from('clientes').update({ saldo_devedor: saldo }).eq('id', c.id);
      } else if (saldo > 0) {
        await supabase.from('clientes').insert({ filial_id: perfil.filial_id, placa, saldo_devedor: saldo });
      }
    } catch { /* best-effort, igual fidelidade */ }
  }

  const totalPago = (saindo?.pagamentos || []).reduce((s, p) => s + Number(p.valor || 0), 0);

  // InfiniteTap (ver src/lib/infinitepay.js): só no celular, porque a leitura
  // do cartão é pelo NFC do próprio aparelho — no PC da cabine o botão não
  // teria como funcionar.
  const infinitePay = configInfinitePay(filial);
  const podeInfiniteTap = infinitePay.ativo && ehCelular();

  /**
   * Abre o app da InfinitePay já com o valor preenchido. O esta NÃO recebe o
   * resultado de volta (ver infinitepay.js): depois de aproximar o cartão o
   * operador volta pra cá e confirma a saída na mão, como sempre.
   */
  function cobrarNoCelular(pagamento, metodo) {
    setErro('');
    const maxParcelas = parcelasPossiveis(pagamento.valor);
    const motivo = cobrarNoInfiniteTap({
      valor: Number(pagamento.valor),
      metodo,
      parcelas: metodo === 'credit' ? Math.min(parcelasCartao, maxParcelas) : 1,
      orderId: saindo?.mov?.id,
      config: infinitePay,
    });
    if (motivo) setErro(motivo);
  }

  return (
    <>
      {erro && <div className="card aviso">{erro}</div>}

      <div className="card card-entrada">
        <div className="card-cab">
          <h2>Entrada de veículo</h2>
          <CardAcoes acoes={[
            { label: 'Receber mensalidade', onClick: () => setAbrirRecebimento(true) },
            { label: 'Cadastrar senha do mês', onClick: abrirModalSenhaMes },
            { label: 'Venda Produtos', onClick: () => setAbrirVendaProdutos(true) },
          ]} />
        </div>
        <form className="linha-form" onSubmit={darEntrada}>
          <div className="campo">
            <label>Placa ou nº do ticket</label>
            <input className="mono placa-input campo-destaque" ref={placaRef} value={placa}
              onChange={(e) => { setPlaca(e.target.value); setConfirmPlaca(null); setVagaEsgotada(null); setMensalistaVencido(null); }}
              onBlur={(e) => detectar(e.target.value)} onKeyDown={onKeyDownPlaca}
              inputMode="text" autoCapitalize="characters" autoComplete="off"
              placeholder="ABC1D23" style={{ textTransform: 'uppercase' }} />
            <span className="suave" style={{ fontSize: 11 }}>
              Na saída, o nº do ticket (ex.: 42) também serve.
            </span>
          </div>
          {(filial?.config?.patio?.usaLeituraPlaca ?? true) && (
            <CapturaPlaca onConfirmar={(p) => { setPlaca(p); setConfirmPlaca(null); setVagaEsgotada(null); setMensalistaVencido(null); detectar(p); }} />
          )}
          {(filial?.config?.patio?.usaDitadoPlaca ?? false) && (
            <DitarPlaca onConfirmar={(p) => { setPlaca(p); setConfirmPlaca(null); setVagaEsgotada(null); setMensalistaVencido(null); detectar(p); }} />
          )}
          <div className="campo campo-busca" style={{ minWidth: 340 }}>
            <label>Carro</label>
            <input ref={buscaModeloRef} value={buscaModelo}
              onChange={(e) => onBuscaModeloChange(e.target.value)}
              onFocus={() => setMostrarSugestoes(true)}
              onBlur={() => setTimeout(() => setMostrarSugestoes(false), 150)}
              onKeyDown={onKeyDownModelo}
              placeholder="Digite o modelo do carro…" style={{ width: '100%', fontSize: 18 }} />
            {mostrarSugestoes && sugestoes.length > 0 && (
              <ul className="sugestoes-lista">
                {sugestoes.map((m) => (
                  <li key={m.id} className="sugestao-item"
                    onMouseDown={(e) => { e.preventDefault(); selecionarModelo(m); }}>
                    {m.nome}
                  </li>
                ))}
              </ul>
            )}
            {/* Mesma altura tenha ou não modelo selecionado (  no lugar do
                texto) — sem isso o campo "Carro" ficava mais baixo que a Placa
                (que tem a nota da saída embaixo), desalinhando os dois inputs
                (.linha-form usa align-items:end). */}
            <span className="suave" style={{ fontSize: 11 }}>
              {modeloSelecionado ? `Tabela: ${modeloSelecionado.tabela_tipo}` : ' '}
            </span>
          </div>
          {buscaModelo.trim().length >= 2 && !modeloSelecionado && sugestoes.length === 0 && (
            <>
              <div className="campo">
                <label>Tabela de preço (carro não encontrado)</label>
                <select value={tabelaManual} onChange={(e) => setTabelaManual(e.target.value)}>
                  <option value="">—</option>
                  {tabelasManuais.map((t) => <option key={t.tipo} value={t.tipo}>{t.tipo} · {t.descricao}</option>)}
                </select>
                {tabelasManuais.length === 0 && <span className="suave" style={{ fontSize: 11 }}>Nenhuma tabela liberada — marque em Preços.</span>}
              </div>
              <div className="campo">
                <label>Nome do carro (novo)</label>
                <input value={nomeCarroNovo} onChange={(e) => setNomeCarroNovo(e.target.value.toUpperCase())} />
              </div>
            </>
          )}
          <CardAcoes rotulo="Mais opções"
            className={(servicosEntrada.length || avarias.trim() || fotosAvarias || Number(valorAntecipado) > 0) ? 'btn-servico-ativo' : 'btn-ghost'}
            acoes={[
              { label: `Serviços${servicosEntrada.length ? ` (${servicosEntrada.length})` : ''}`, onClick: () => setModalServicosEntrada(true) },
              { label: `Avarias${fotosAvarias ? ` (${fotosAvarias} foto${fotosAvarias > 1 ? 's' : ''})` : ''}`, onClick: () => setModalAvarias(true) },
              { label: `Vlr. Antecipado${Number(valorAntecipado) > 0 ? ` (${fmtBRL(Number(valorAntecipado))})` : ''}`, onClick: () => setModalAntecipado(true) },
            ]} />
          <button className="btn-primary" type="submit" ref={btnRegistrarRef}>Registrar entrada</button>
          {detectado && (
            <span className="badge-mens">
              {detectado.tipo_mens === 'H' ? 'Hóspede' : 'Mensalista'}: {detectado.nome}
              {detectado.convenio_codigo && ` · conv. ${detectado.convenio_codigo}`}
            </span>
          )}
          {vagaEsgotada && (
            <span className="badge-mens" style={{ color: 'var(--ambar)', borderColor: 'var(--ambar)', background: 'rgba(245,166,35,.12)' }}>
              Vaga(s) de {vagaEsgotada} já ocupada(s) — entrando como avulso
            </span>
          )}
          {mensalistaVencido && (
            <span className="badge-mens" style={{ color: 'var(--ambar)', borderColor: 'var(--ambar)', background: 'rgba(245,166,35,.12)' }}>
              Mensalidade de {mensalistaVencido} vencida — entrando como avulso
            </span>
          )}
          {restricaoHorario && (
            <span className="badge-mens" style={{ color: 'var(--ambar)', borderColor: 'var(--ambar)', background: 'rgba(245,166,35,.12)' }}>
              {restricaoHorario.nome} fora do dia/turno contratado — avulso
              {restricaoHorario.livreAPartir != null
                ? ` até as ${fmtHora(restricaoHorario.livreAPartir)}`
                : ' pelo período todo'}
            </span>
          )}
          {reservaDetectada && (
            <span className="badge-mens" style={{ color: 'var(--ambar)', borderColor: 'var(--ambar)', background: 'rgba(245,166,35,.12)' }}>
              Reserva encontrada ({reservaDetectada.tipo}, até {fmtDataBR(reservaDetectada.data_fim)}) — confirme
              o modelo/tabela e registre a entrada
            </span>
          )}
          {dividaDetectada > 0 && (
            <span className="badge-mens" style={{ color: 'var(--erro)', borderColor: 'var(--erro)', background: 'rgba(255,107,107,.12)' }}>
              Placa com dívida de {fmtBRL(dividaDetectada)} — soma na estadia calculada na saída
            </span>
          )}
        </form>
      </div>

      <div className="card">
        <div className="card-cab">
          <h2>No pátio ({patio.length}) — {avulsosNoPatio} avulso(s), {mensalistasNoPatio} mensalista(s)</h2>
          {/* Só existe de verdade no celular (ver .btn-ver-lista-mobile no CSS) —
              no desktop a lista sempre aparece, como antes. */}
          <button type="button" className="btn-ghost btn-ver-lista-mobile" onClick={() => setVerPatioMobile((v) => !v)}>
            {verPatioMobile ? 'Ocultar pátio' : `Ver pátio (${patio.length})`}
          </button>
        </div>
        {verPatioMobile && (
          <div className="tabela-scroll">
            <table>
              <thead><tr><th>Nº</th><th>Placa</th><th>Carro</th><th>Tabela</th><th>Tipo</th><th>Entrada</th><th></th></tr></thead>
              <tbody>
                {patio.map((m) => (
                  <tr key={m.id}>
                    {/* O número de controle é o que o cliente devolve na saída —
                        dá pra digitá-lo no mesmo campo da placa. */}
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {m.controle != null ? String(m.controle).padStart(4, '0') : '—'}
                    </td>
                    <td>{semChapa(m.placa)
                      ? <span className="suave">{rotuloPlaca(m.placa)}</span>
                      : <span className="placa mono">{m.placa}</span>}
                      {m.semparar_status === 'autorizado' && (
                        <span className="suave" title="Autorizado a pagar por Sem Parar"> 🅿️</span>
                      )}</td>
                    <td>{m.modelo || '—'}</td>
                    <td>{m.tipo_veic}</td>
                    <td>
                      {Number(m.valor_antecipado) > 0 && <span title={`Antecipado: ${fmtBRL(Number(m.valor_antecipado))}`}>$ </span>}
                      {rotuloTipo(m.tipo_mens)}{m.convenio_codigo ? ` · ${m.convenio_codigo}` : ''}
                    </td>
                    <td className="mono">{m.dt_entrada.split('-').reverse().join('/')} {fmtHora(Number(m.hr_entrada))}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {podeExcluir(m) && (
                        <button className="btn-ghost aviso-btn" onClick={() => abrirExclusao(m)}>Excluir</button>
                      )}
                      <button className="btn-ghost" onClick={() => segundaVia(m)} title="Cliente perdeu o ticket">2ª via</button>
                      <button
                        className={movimentosComServico.has(m.id) ? 'btn-servico-ativo' : 'btn-ghost'}
                        onClick={() => abrirServicosModal(m)}
                      >Serviço</button>
                      <button className="btn-primary" onClick={() => prepararSaida(m)}>Saída</button>
                    </td>
                  </tr>
                ))}
                {patio.length === 0 && <tr><td colSpan={7} className="suave">Pátio vazio.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-cab">
          <h2>Saídas de hoje ({saidasRecentes.length})</h2>
          <button type="button" className="btn-ghost btn-ver-lista-mobile" onClick={() => setVerSaidasMobile((v) => !v)}>
            {verSaidasMobile ? 'Ocultar saídas' : `Ver saídas (${saidasRecentes.length})`}
          </button>
        </div>
        {verSaidasMobile && (
          <div className="tabela-scroll">
            <table>
              <thead><tr><th>Placa</th><th>Carro</th><th>Entrada</th><th>Saída</th><th>Valor</th><th></th></tr></thead>
              <tbody>
                {saidasRecentes.map((m) => (
                  <tr key={m.id}>
                    <td>{semChapa(m.placa)
                      ? <span className="suave">{rotuloPlaca(m.placa)}{m.controle != null ? ` ${String(m.controle).padStart(4, '0')}` : ''}</span>
                      : <span className="placa mono">{m.placa}</span>}</td>
                    <td>{m.modelo || '—'}</td>
                    <td className="mono">
                      {m.dt_entrada ? `${m.dt_entrada.split('-').reverse().join('/')} ${fmtHora(Number(m.hr_entrada))}` : '—'}
                    </td>
                    <td className="mono">
                      {m.excluido_em
                        ? new Date(m.excluido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : `${m.dt_saida.split('-').reverse().join('/')} ${fmtHora(Number(m.hr_saida))}`}
                    </td>
                    <td>
                      {m.excluido_em
                        ? <span className="status status-cancelada">Cancelado</span>
                        : (
                          <>
                            {fmtBRL(Number(m.valor || 0))}
                            {m.valor_calculado != null && (
                              <span title={`Valor alterado na saída — o cálculo dava ${fmtBRL(Number(m.valor_calculado))}`}> *</span>
                            )}
                          </>
                        )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn-ghost" onClick={() => (m.excluido_em ? reimprimirExclusao(m) : reimprimirSaida(m))}>Reimprimir</button>
                    </td>
                  </tr>
                ))}
                {saidasRecentes.length === 0 && <tr><td colSpan={6} className="suave">Nenhuma saída hoje.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalServicos && (
        <div className="modal-bg" onClick={() => setModalServicos(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Serviços — <span className="placa mono">{modalServicos.mov.placa}</span></h2>
            <p className="suave">
              Marque os serviços feitos neste veículo. Na saída, se houver algum marcado, o valor
              cobrado vira a soma das tabelas desses serviços, em vez da tabela do veículo.
            </p>
            {servicos.length === 0 && <p className="suave">Nenhum serviço cadastrado — cadastre em Cadastros → Serviços.</p>}
            {servicos.map((s) => (
              <label className="campo-check" key={s.id} style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={modalServicos.marcados.has(s.id)}
                  onChange={() => alternarServico(s.id)} />
                {s.codigo} · {s.descricao}
                {servicoPedeValor(s) && <span className="suave" style={{ fontSize: 11 }}> (pede valor ao marcar)</span>}
              </label>
            ))}
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-primary" onClick={() => setModalServicos(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {modalValorServico && (
        <div className="modal-bg" onClick={() => setModalValorServico(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Valor do serviço — {modalValorServico.descricao}</h2>
            <p className="suave">Esse serviço não tem valor configurado — digite quanto cobrar.</p>
            <div className="campo">
              <label>Valor</label>
              <input type="number" step="0.01" min="0" autoFocus value={modalValorServico.valor}
                onChange={(e) => setModalValorServico({ ...modalValorServico, valor: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmarValorServico(); }} />
            </div>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setModalValorServico(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarValorServico}>Marcar serviço</button>
            </div>
          </div>
        </div>
      )}

      {modalServicosEntrada && (
        <div className="modal-bg" onClick={() => setModalServicosEntrada(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Serviços — entrada</h2>
            <p className="suave">
              Marque os serviços já sabidos nesta entrada (ex.: lava-rápido). Vão pro ticket
              de entrada e já saem gravados junto com o movimento.
            </p>
            {servicos.length === 0 && <p className="suave">Nenhum serviço cadastrado — cadastre em Cadastros → Serviços.</p>}
            {servicos.map((s) => (
              <label className="campo-check" key={s.id} style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={servicosEntrada.some((x) => x.servico_id === s.id)}
                  onChange={() => alternarServicoEntrada(s.id)} />
                {s.codigo} · {s.descricao}
                {servicoPedeValor(s) && <span className="suave" style={{ fontSize: 11 }}> (pede valor ao marcar)</span>}
              </label>
            ))}
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-primary" onClick={() => setModalServicosEntrada(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {modalValorServicoEntrada && (
        <div className="modal-bg" onClick={() => setModalValorServicoEntrada(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Valor do serviço — {modalValorServicoEntrada.descricao}</h2>
            <p className="suave">Esse serviço não tem valor configurado — digite quanto cobrar.</p>
            <div className="campo">
              <label>Valor</label>
              <input type="number" step="0.01" min="0" autoFocus value={modalValorServicoEntrada.valor}
                onChange={(e) => setModalValorServicoEntrada({ ...modalValorServicoEntrada, valor: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmarValorServicoEntrada(); }} />
            </div>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setModalValorServicoEntrada(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarValorServicoEntrada}>Marcar serviço</button>
            </div>
          </div>
        </div>
      )}

      {modalAvarias && (
        <div className="modal-bg" onClick={() => setModalAvarias(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Avarias — <span className="placa mono">{placa.trim().toUpperCase() || '—'}</span></h2>
            <p className="suave">
              Texto (até 5 linhas de 50 caracteres) fica salvo no sistema e sai no ticket de
              entrada. Fotos não ficam salvas aqui — baixam direto pro aparelho, identificadas
              com placa + data + hora.
            </p>
            <div className="campo" style={{ marginBottom: 10 }}>
              <label>Descrição</label>
              <textarea rows={5} className="mono" style={{ width: '100%' }}
                value={avarias} onChange={(e) => setAvarias(limitarAvarias(e.target.value))}
                placeholder={'Ex.: Risco na porta direita\nAmassado no para-choque traseiro'} />
              <span className="suave" style={{ fontSize: 11 }}>
                {avarias.split('\n').length}/5 linhas
              </span>
            </div>
            {/* tabIndex + onKeyDown: sem isso o <label> não entra na ordem de Tab
                (o <input> real fica display:none, também fora dela) — só clique
                de mouse abria o seletor de foto/câmera. Depois de aberto, a
                escolha do arquivo em si é sempre do sistema operacional. */}
            <label className="btn-ghost" style={{ cursor: 'pointer', display: 'inline-block' }} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector('input').click(); } }}>
              Tirar/anexar foto
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files[0]; if (f) baixarFotoAvaria(f); e.target.value = ''; }} />
            </label>
            {fotosAvarias > 0 && (
              <span className="suave" style={{ marginLeft: 8, fontSize: 12 }}>
                {fotosAvarias} foto{fotosAvarias > 1 ? 's' : ''} baixada{fotosAvarias > 1 ? 's' : ''} pro aparelho.
              </span>
            )}
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-primary" onClick={() => setModalAvarias(false)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {modalAntecipado && (
        <div className="modal-bg" onClick={() => setModalAntecipado(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Valor antecipado — <span className="placa mono">{placa.trim().toUpperCase() || '—'}</span></h2>
            <p className="suave">
              Cobrado agora (conta como pagamento recebido, entra no caixa deste momento) — na
              saída, é descontado do valor total calculado.
            </p>
            {!caixaAberto && (
              <p className="aviso" style={{ fontSize: 12 }}>
                Sem caixa aberto — ao registrar a entrada, vamos pedir o troco inicial pra abrir um.
              </p>
            )}
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo">
                <label>Valor</label>
                <input type="number" step="0.01" min="0" value={valorAntecipado} autoFocus
                  onChange={(e) => setValorAntecipado(e.target.value)} />
              </div>
              <div className="campo">
                <label>Forma de pagamento</label>
                <select value={formaAntecipado || formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || ''}
                  onChange={(e) => setFormaAntecipado(e.target.value)}>
                  {formas.map((f) => <option key={f.codigo} value={f.codigo}>{f.descricao}</option>)}
                </select>
              </div>
            </div>
            <div className="linha-form" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              {Number(valorAntecipado) > 0 && (
                <button type="button" className="btn-ghost aviso-btn"
                  onClick={() => { setValorAntecipado(''); setFormaAntecipado(''); setModalAntecipado(false); }}>
                  Remover
                </button>
              )}
              <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModalAntecipado(false)}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {modalExclusao && (
        <div className="modal-bg" onClick={() => setModalExclusao(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir veículo — <span className="placa mono">{modalExclusao.mov.placa}</span></h2>
            <p className="suave">
              Cancela a entrada deste veículo (some do pátio, sem cobrança). Fica registrado
              para auditoria com data/hora e o motivo abaixo, e imprime um comprovante.
            </p>
            <div className="campo">
              <label>Motivo da exclusão</label>
              <textarea rows={3} style={{ width: '100%' }} value={modalExclusao.motivo}
                onChange={(e) => setModalExclusao({ ...modalExclusao, motivo: e.target.value })} />
            </div>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setModalExclusao(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarExclusao}>Confirmar exclusão</button>
            </div>
          </div>
        </div>
      )}

      {confirmPlaca && (
        <div className="modal-bg" onClick={corrigirPlaca}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Confirmar placa</h2>
            <p className="suave">Essa placa não parece ter um formato válido (ex.: ABC1234 ou ABC1D23).</p>
            <div className="grande mono">{confirmPlaca}</div>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={corrigirPlaca}>Não, digitar outra</button>
              <button className="btn-primary" onClick={confirmarPlacaForcada}>Sim, está correta</button>
            </div>
          </div>
        </div>
      )}

      {confirmNovo && (
        <div className="modal-bg" onClick={() => setConfirmNovo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Confirmar carro novo</h2>
            <p className="suave">Confira se o nome está certo — ele entra no catálogo de modelos permanentemente.</p>
            <div className="grande">{confirmNovo.nome}</div>
            <p className="mono suave" style={{ textAlign: 'center' }}>Tabela: {confirmNovo.tipo}</p>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setConfirmNovo(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarNovoCarro}>Confirmar e adicionar</button>
            </div>
          </div>
        </div>
      )}

      {ticket && (
        <TicketModal ticket={ticket} filial={filial} perfil={perfil} celular={celularTicket} placa={placaTicket}
          onCelular={setCelularTicket} onFechar={() => { setTicket(null); focarPlaca(); }} />
      )}

      {abrirRecebimento && (
        <ReceberMensalidadeFluxo perfil={perfil} formas={formas} caixaAberto={caixaAberto} onCaixaAberto={setCaixaAberto}
          onConcluido={(t, celularSugerido) => { setTicket(t); setCelularTicket(celularSugerido); setAbrirRecebimento(false); }}
          onFechar={() => setAbrirRecebimento(false)} />
      )}

      {abrirVendaProdutos && (
        <VendaProdutosFluxo perfil={perfil} produtos={produtos} formas={formas} caixaAberto={caixaAberto} onCaixaAberto={setCaixaAberto}
          onConcluido={(t) => { setTicket(t); setAbrirVendaProdutos(false); recarregar(); }}
          onFechar={() => setAbrirVendaProdutos(false)} />
      )}

      {pendenteCaixa && (
        // z-index acima do padrão (50): esta ação sempre nasce de dentro de outro
        // modal já aberto (Confirmar saída, Registrar entrada...) — precisa ficar
        // por cima dele, não embaixo (mesma z-index empataria e o de baixo, por
        // vir depois no JSX, ganharia).
        <div className="modal-bg" style={{ zIndex: 60 }} onClick={() => setPendenteCaixa(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 92vw)' }}>
            <h2>Abrir caixa</h2>
            <AbrirCaixaInline perfil={perfil}
              onAberto={(cx) => { setCaixaAberto(cx); const { executar } = pendenteCaixa; setPendenteCaixa(null); executar(); }} />
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setPendenteCaixa(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {modalSenhaMes && (
        <div className="modal-bg" onClick={() => setModalSenhaMes(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 92vw)' }}>
            <h2>Cadastrar senha do mês</h2>
            <p className="suave">
              Digite a senha do mês que você recebeu do fornecedor. Preencha só
              a 1ª pra um mês avulso, ou as 6 de uma vez pra um cliente
              semestral — cada uma vale pra um mês, na ordem.
            </p>
            <p className="suave" style={{ fontWeight: 600 }}>
              {modalSenhaMes.travadas == null ? 'Carregando…' : `${modalSenhaMes.travadas.length} de 6 já cadastradas.`}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>
              {Array.from({ length: 6 }, (_, i) => {
                const travada = modalSenhaMes.travadas?.[i];
                return (
                  <div className="campo" key={i} style={{ width: 62 }}>
                    <label style={{ fontSize: 11 }}>{i + 1}ª</label>
                    {travada != null ? (
                      <input className="mono" value={travada} disabled style={{ width: '100%', padding: '6px 4px', textAlign: 'center' }} />
                    ) : (
                      <input className="mono" autoFocus={i === (modalSenhaMes.travadas?.length || 0)}
                        value={modalSenhaMes.campos[i - (modalSenhaMes.travadas?.length || 0)] || ''}
                        onChange={(e) => {
                          const idx = i - (modalSenhaMes.travadas?.length || 0);
                          const campos = [...modalSenhaMes.campos];
                          campos[idx] = e.target.value.toUpperCase();
                          setModalSenhaMes({ ...modalSenhaMes, campos });
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !modalSenhaMes.ocupado) cadastrarSenhaMes(); }}
                        disabled={modalSenhaMes.travadas == null}
                        maxLength={5} style={{ width: '100%', padding: '6px 4px', textTransform: 'uppercase', textAlign: 'center' }} />
                    )}
                  </div>
                );
              })}
            </div>
            {modalSenhaMes.erro && <p className="aviso">{modalSenhaMes.erro}</p>}
            <div className="linha-form" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <button className="btn-ghost" disabled={modalSenhaMes.ocupado || !modalSenhaMes.travadas?.length} onClick={removerUltimaSenhaMes}>
                Remover última
              </button>
              <div className="linha-form" style={{ gap: 8 }}>
                <button className="btn-ghost" onClick={() => setModalSenhaMes(null)}>Fechar</button>
                <button className="btn-primary"
                  disabled={modalSenhaMes.ocupado || !modalSenhaMes.campos.some((c) => c.trim())}
                  onClick={cadastrarSenhaMes}>
                  {modalSenhaMes.ocupado ? '…' : 'Cadastrar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {saindo && (
        <div className="modal-bg" onClick={cancelarSaida}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-cab">
              <h2>
                Saída — {semChapa(saindo.mov.placa)
                  ? <span className="suave">{rotuloPlaca(saindo.mov.placa)}</span>
                  : <span className="placa mono">{saindo.mov.placa}</span>}
                {saindo.mov.controle != null && (
                  <span className="suave mono" style={{ marginLeft: 8 }}>
                    nº {String(saindo.mov.controle).padStart(4, '0')}
                  </span>
                )}
              </h2>
              {!saindo.resultado.mensalista && (
                <CardAcoes acoes={[
                  { label: 'Alterar valor', onClick: abrirModalValor },
                  ...(saindo.resultado.valor > 0 ? [{ label: 'Gerar DPS', onClick: abrirModalDps }] : []),
                ]} />
              )}
            </div>
            {!saindo.resultado.mensalista && (
              <div className="campo" style={{ marginBottom: 10 }}>
                <label>Convênio (opcional — em branco cobra normal)</label>
                <select value={saindo.convenioCodigo} onChange={(e) => mudarConvenioSaida(e.target.value)}>
                  <option value="">— Sem convênio —</option>
                  {Object.values(convenios)
                    .filter((c) => c.ativo && (!c.so_supervisor || ehGerente(perfil)))
                    .map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.razao}</option>)}
                </select>
              </div>
            )}
            {/* Convênio que "pede hora": o ticket vem carimbado com o horário
                em que o cliente saiu do convênio. Dali até a saída de verdade
                é estadia normal, paga por ele (ver mudarHoraConvenio). */}
            {!saindo.resultado.mensalista && convenios[saindo.convenioCodigo]?.pede_hora && (
              <div className="campo" style={{ marginBottom: 10 }}>
                <label>Hora em que saiu do convênio</label>
                <input type="number" step="0.01" min="0" max="23.59" style={{ width: 120 }}
                  placeholder="13.45" value={saindo.horaConvenio ?? ''}
                  onChange={(e) => mudarHoraConvenio(e.target.value)} />
                <span className="suave" style={{ fontSize: 11 }}>
                  Formato HH.MM (13.45 = 13h45), como vem carimbado no ticket. O convênio paga
                  até esse horário; do minuto seguinte até a saída cobra do cliente pela tabela{' '}
                  {convenios[saindo.convenioCodigo]?.tab_preco || saindo.mov.tipo_veic}. Em
                  branco, o convênio cobre a estadia inteira.
                </span>
              </div>
            )}
            {saindo.resultado.segmentos?.length === 2 && (
              <p className="suave" style={{ fontSize: 12 }}>
                No convênio: {fmtBRL(saindo.resultado.segmentos[0].valor)} ·
                depois do convênio: {fmtBRL(saindo.resultado.segmentos[1].valor)}
              </p>
            )}
            {saindo.resultado.mensalista ? (
              <p className="suave">Mensalista/hóspede — sem cobrança na saída (mensalidade paga à parte).</p>
            ) : (
              <>
                {/* A tabela usada é informação de diagnóstico: com Tabela alt.
                    no convênio, o cálculo sai da tabela DELE, não da de entrada. */}
                <p className="mono suave">
                  Tempo: {fmtHora(saindo.resultado.tempoDecorrido)} · tabela {tabelaDaSaida(saindo, convenios)}
                </p>
                {/* Quanto o convênio está bancando: sem isso, um convênio mal
                    cadastrado passa despercebido (o valor simplesmente não cai). */}
                {saindo.convenioCodigo && (
                  <p className={saindo.resultado.valorConvenio > 0 ? 'ok-txt' : 'aviso'} style={{ fontSize: 13 }}>
                    {saindo.resultado.valorConvenio > 0
                      ? `Convênio ${saindo.convenioCodigo} paga ${fmtBRL(saindo.resultado.valorConvenio)}`
                      : `Convênio ${saindo.convenioCodigo} sem desconto — confira o cadastro dele (% desc., valor fixo ou grade própria) e a coluna "Valor convênio" da tabela ${tabelaDaSaida(saindo, convenios)}.`}
                  </p>
                )}
                {/* Entrou fora do dia/turno contratado: cobra só até aqui —
                    dali em diante já estava dentro do período contratado. */}
                {saindo.resultado.restricaoAte != null && (
                  <p className="suave" style={{ fontSize: 13 }}>
                    Fora do horário contratado na entrada — cobrando só até as {fmtHora(saindo.resultado.restricaoAte)}
                    {' '}(quando o período contratado começa).
                  </p>
                )}
              </>
            )}
            {saindo.servicosSelecionados?.length > 0 && (() => {
              const comValor = saindo.servicosSelecionados.filter((s) => s.valorInformado != null);
              const semValor = saindo.servicosSelecionados.filter((s) => s.valorInformado == null);
              return (
                <>
                  {semValor.length > 0 && (
                    <p className="suave">
                      Cobrando por serviço: {semValor.map((s) => s.descricao).join(', ')}
                      {' '}(em vez da tabela do veículo)
                    </p>
                  )}
                  {comValor.map((s) => (
                    <p className="suave" key={s.id}>
                      + {s.descricao}: {fmtBRL(Number(s.valorInformado))} (valor informado ao marcar o serviço)
                    </p>
                  ))}
                </>
              );
            })()}
            {Number(saindo.mov.valor_dev) > 0 && (
              <p className="suave" style={{ textAlign: 'center' }}>
                Dívida anterior: +{fmtBRL(Number(saindo.mov.valor_dev))}
              </p>
            )}
            {saindo.resultado.valorAntecipado > 0 && (
              <p className="suave" style={{ textAlign: 'center' }}>
                Valor antecipado: -{fmtBRL(saindo.resultado.valorAntecipado)}
              </p>
            )}
            {saindo.bonusAplicado && (
              <p className="suave" style={{ textAlign: 'center' }}>
                Bônus fidelidade: -{fmtBRL(saindo.bonusAplicado.valor_desconto)} ({saindo.bonusAplicado.pontos_necessarios} pontos)
              </p>
            )}
            <div className="grande">{fmtBRL(saindo.resultado.valor)}</div>
            {saindo.valorCalculado != null && saindo.valorCalculado !== saindo.resultado.valor && (
              <p className="suave" style={{ textAlign: 'center' }}>
                * valor alterado — o cálculo dava {fmtBRL(saindo.valorCalculado)}
              </p>
            )}

            {!saindo.resultado.mensalista && saindo.resultado.valor > 0 && (
              <div style={{ margin: '12px 0' }}>
                <label className="suave">Pagamento</label>
                {saindo.pagamentos.map((p, i) => (
                  <div className="linha-form" key={i} style={{ marginTop: 6 }}>
                    <select value={p.forma} onChange={(e) => atualizaPagto(i, 'forma', e.target.value)}>
                      {formas.map((f) => (
                        <option key={f.codigo} value={f.codigo}>
                          {/* Marca a forma Sem Parar só quando ESTE veículo tem
                              autorização válida — escolhê-la fora disso dá erro
                              ao confirmar (ver confirmarSaida). */}
                          {f.eh_semparar && saindo.mov.semparar_status === 'autorizado' ? '🅿️ ' : ''}{f.descricao}
                        </option>
                      ))}
                    </select>
                    <input type="number" step="0.01" value={p.valor}
                      onChange={(e) => atualizaPagto(i, 'valor', e.target.value)} style={{ width: 120 }} />
                    {saindo.pagamentos.length > 1 && <button className="btn-ghost" onClick={() => removePagto(i)}>×</button>}
                  </div>
                ))}
                <button className="btn-ghost" onClick={addPagto} style={{ marginTop: 6 }}>+ dividir pagamento</button>
                {Math.abs(totalPago - saindo.resultado.valor) > 0.005 && (
                  <p className="aviso">Soma dos pagamentos ({fmtBRL(totalPago)}) difere do valor.</p>
                )}
                {/* InfiniteTap: um botão por pagamento em cartão (o normal é um
                    só). Abre o app da InfinitePay já com o valor — depois de
                    aproximar o cartão, o operador volta aqui e confirma. */}
                {podeInfiniteTap && saindo.pagamentos.map((p, i) => {
                  const metodo = formas.find((f) => f.codigo === p.forma)?.infinitepay_metodo;
                  if (!metodo || !(Number(p.valor) > 0)) return null;
                  const maxParcelas = parcelasPossiveis(p.valor);
                  return (
                    <div className="linha-form" key={`itap-${i}`} style={{ marginTop: 8, alignItems: 'center' }}>
                      {metodo === 'credit' && maxParcelas > 1 && (
                        <select value={Math.min(parcelasCartao, maxParcelas)} style={{ width: 70 }}
                          onChange={(e) => setParcelasCartao(Number(e.target.value))}>
                          {Array.from({ length: maxParcelas }, (_, n) => n + 1).map((n) => (
                            <option key={n} value={n}>{n}x</option>
                          ))}
                        </select>
                      )}
                      <button type="button" className="btn-ghost" onClick={() => cobrarNoCelular(p, metodo)}>
                        💳 Cobrar {fmtBRL(Number(p.valor))} no celular
                      </button>
                    </div>
                  );
                })}
                {podeInfiniteTap && saindo.pagamentos.some((p) => formas.find((f) => f.codigo === p.forma)?.infinitepay_metodo && Number(p.valor) > 0) && (
                  <p className="suave" style={{ fontSize: 11, marginTop: 4 }}>
                    Abre o app da InfinitePay já com o valor. Depois de aproximar o cartão,
                    volte aqui e confirme a saída — o esta não recebe a confirmação sozinho.
                  </p>
                )}
              </div>
            )}

            {saindo.resultado.manual && <p className="aviso">Tempo fora das faixas — confira o valor.</p>}
            {saindo.resultado.pedeValor && (
              <p className="aviso">
                Esta faixa pede o valor a cobrar —{' '}
                <button type="button" className="btn-ghost" onClick={abrirModalValor} style={{ padding: '2px 8px' }}>
                  informar valor
                </button>
              </p>
            )}
            {saindo.bonusDisponivel && !saindo.bonusAplicado && (
              <p className="suave">
                Cliente atingiu {saindo.bonusDisponivel.faixa.pontos_necessarios} pontos —{' '}
                <button type="button" className="btn-ghost" onClick={() => setModalBonus(saindo.bonusDisponivel)} style={{ padding: '2px 8px' }}>
                  usar bônus de {fmtBRL(saindo.bonusDisponivel.faixa.valor_desconto)}
                </button>
              </p>
            )}
            <div className="linha-form" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={cancelarSaida}>Cancelar</button>
              <button className="btn-primary" ref={btnConfirmarSaidaRef} disabled={saindo.resultado.pedeValor} onClick={() => confirmarSaida()}>Confirmar saída</button>
            </div>
          </div>
        </div>
      )}

      {modalBonus && (
        <div className="modal-bg" onClick={() => setModalBonus(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Bônus de fidelidade disponível</h2>
            <p className="suave">
              Este cliente tem {modalBonus.pontosProjetados} pontos acumulados (com esta saída) —
              atingiu a faixa de {modalBonus.faixa.pontos_necessarios} pontos, que dá{' '}
              <strong>{fmtBRL(modalBonus.faixa.valor_desconto)}</strong> de desconto. Aplicar agora
              consome {modalBonus.faixa.pontos_necessarios} pontos do acumulado; se não usar agora,
              os pontos continuam guardados pra próxima vez.
            </p>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setModalBonus(null)}>Não, continuar acumulando</button>
              <button className="btn-primary" onClick={confirmarBonus}>Usar desconto</button>
            </div>
          </div>
        </div>
      )}

      {modalValor && (
        <div className="modal-bg" onClick={() => setModalValor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{modalValor.obrigatorio ? 'Valor a cobrar' : 'Alterar valor'} — <span className="placa mono">{saindo?.mov.placa}</span></h2>
            <p className="suave">
              {modalValor.obrigatorio
                ? 'Esta faixa da tabela de preço não tem valor configurado — digite quanto cobrar.'
                : <>O cálculo deu {fmtBRL(saindo?.resultado.valor || 0)}
                    {saindo?.valorCalculado != null && ` (original: ${fmtBRL(saindo.valorCalculado)})`}.
                    O valor original fica registrado, e a saída aparece marcada com * nas listagens.</>}
            </p>
            <div className="campo">
              <label>Valor a cobrar</label>
              <input type="number" step="0.01" min="0" autoFocus value={modalValor.valor}
                onChange={(e) => setModalValor({ ...modalValor, valor: e.target.value })} />
            </div>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setModalValor(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarAlteracaoValor}>Usar este valor</button>
            </div>
          </div>
        </div>
      )}

      {modalDps && (
        <div className="modal-bg" onClick={() => setModalDps(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Gerar DPS — <span className="placa mono">{saindo?.mov.placa}</span></h2>
            <p className="suave">
              Informe o CPF ou CNPJ do tomador do serviço. Deixe em branco para emitir
              sem identificação (usa não exigibilidade do NIF).
            </p>
            <div className="linha-form" style={{ alignItems: 'flex-end' }}>
              <div className="campo" style={{ flex: 1 }}>
                <label>CPF/CNPJ (opcional)</label>
                <input className="mono" value={modalDps.documento}
                  onChange={(e) => { setModalDps({ ...modalDps, documento: e.target.value }); setErroCnpj(''); }}
                  placeholder="Deixe em branco para não identificar" />
                {erroCpfCnpj(modalDps.documento)
                  ? <span className="aviso" style={{ fontSize: 11 }}>{erroCpfCnpj(modalDps.documento)}</span>
                  : !validarCpfCnpj(modalDps.documento).vazio && (
                    <span className="suave" style={{ fontSize: 11 }}>
                      {validarCpfCnpj(modalDps.documento).tipo} válido: {formatarCpfCnpj(modalDps.documento)}
                    </span>
                  )}
              </div>
              {validarCpfCnpj(modalDps.documento).tipo === 'CNPJ' && (
                <button type="button" className="btn-ghost" disabled={buscandoCnpj} onClick={buscarNomePorCnpj}>
                  {buscandoCnpj ? 'Buscando…' : 'Buscar nome'}
                </button>
              )}
            </div>
            {erroCnpj && <p className="aviso" style={{ fontSize: 11 }}>{erroCnpj}</p>}
            <div className="campo">
              <label>Nome / Razão social (opcional)</label>
              <input value={modalDps.nome}
                onChange={(e) => setModalDps({ ...modalDps, nome: e.target.value })}
                placeholder="Em branco vira &quot;CONSUMIDOR&quot; no documento" />
            </div>
            <div className="campo" style={{ marginTop: 10 }}>
              <label>ISS retido pelo tomador?</label>
              <select value={modalDps.issRetido} onChange={(e) => setModalDps({ ...modalDps, issRetido: e.target.value })}>
                <option value="">Padrão da filial (Configurações → Fiscal)</option>
                <option value="2">Não — o estacionamento recolhe</option>
                <option value="1">Sim — o tomador retém</option>
              </select>
              <span className="suave" style={{ fontSize: 11 }}>
                Normalmente só se descobre quando a prefeitura rejeita — se já sabe que este
                tomador retém, marque aqui; senão deixe no padrão e corrija depois em NFS-e/RPS/DPS
                se for rejeitado.
              </span>
            </div>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setModalDps(null)}>Cancelar</button>
              {/* Documento em branco é permitido (vira tomador não
                  identificado); errado, não — a prefeitura rejeitaria. */}
              <button className="btn-primary" disabled={!!erroCpfCnpj(modalDps.documento)}
                onClick={() => confirmarSaida({ cpf_cnpj: modalDps.documento, nome: modalDps.nome, issRetido: modalDps.issRetido || null })}>
                Confirmar saída e gerar DPS
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  function atualizaPagto(i, campo, valor) {
    setSaindo((s) => { const pg = s.pagamentos.map((p, j) => j === i ? { ...p, [campo]: valor } : p); return { ...s, pagamentos: pg }; });
  }
  function addPagto() {
    setSaindo((s) => ({ ...s, pagamentos: [...s.pagamentos, { forma: formas[0]?.codigo || 'D', valor: 0 }] }));
  }
  function removePagto(i) {
    setSaindo((s) => ({ ...s, pagamentos: s.pagamentos.filter((_, j) => j !== i) }));
  }
}

function rotuloTipo(t) {
  return { E: 'Avulso', I: 'Mensalista', P: 'Pacote', H: 'Hóspede', C: 'Convênio' }[t] || t;
}

/** Tabela que o motor usou: a do convênio (Tabela alt.), se houver, ou a da entrada. */
function tabelaDaSaida(saindo, convenios) {
  // Serviço com valor já informado ao marcar não passa pelo motor (ver
  // calcularResultadoSaida) — só entram aqui os que ainda dependem da tabela.
  const porTabela = saindo.servicosSelecionados?.filter((s) => s.valorInformado == null) || [];
  if (porTabela.length) return porTabela.map((s) => s.tabela_tipo).join('+');
  const alt = saindo.convenioCodigo ? convenios[saindo.convenioCodigo]?.tab_conv : null;
  return alt || saindo.mov.tipo_veic;
}

function mapConvenio(c) {
  if (!c) return undefined;
  return {
    codigo: c.codigo, tabConv: c.tab_conv || undefined, tabHoras: c.tab_horas,
    perConv: Number(c.perc_conv || 0), vlrConv: Number(c.vlr_conv || 0),
    // Tabela do tempo DEPOIS que o cliente saiu do convênio (ver
    // packages/tarifacao: só entra em jogo junto com a hora de corte).
    tabPreco: c.tab_preco || undefined,
  };
}
