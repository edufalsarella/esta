import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { fmtBRL, fmtDataBR } from '../lib/tempo.js';
import { atualizarNotaFiscal } from '../lib/notaFiscal.js';
import { erroCpfCnpj, validarCpfCnpj } from '../lib/documento.js';
import { buscarCnpj, municipioIbgeDe } from '../lib/cnpj.js';
import { buscarTomadorCadastrado } from '../lib/tomador.js';
import { buscarCep } from '../lib/cep.js';
import { issRetidoDaPlaca, salvarIssRetidoDaPlaca, AR_PARA_ABRASF, ABRASF_PARA_AR } from '../lib/issRetido.js';
import { carregarModelosTicket } from '../lib/dados.js';
import { montarTicketRps } from '../lib/dadosTicket.js';
import { TicketModal } from '../componentes/Ticket.jsx';
import CidadeBusca from '../componentes/CidadeBusca.jsx';
import {
  uninfeSuportado, pastaGuardada, escolherPasta, permissaoPasta, enviarPeloUninfe, verificarRetorno, ehNotaUninfe,
} from '../lib/uninfe.js';

export default function Fiscal({ perfil }) {
  const [notas, setNotas] = useState([]);
  const [padrao, setPadrao] = useState('');
  const [filial, setFilial] = useState(null);
  const [modeloRps, setModeloRps] = useState(''); // layout do RPS, se a filial cadastrou um
  const [ticket, setTicket] = useState(null);
  const [celularTicket, setCelularTicket] = useState('');
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [xml, setXml] = useState(null);
  const [retorno, setRetorno] = useState(null);
  const [enviando, setEnviando] = useState(null); // id da nota em envio
  const [consultando, setConsultando] = useState(null); // id da nota em consulta
  const [emLote, setEmLote] = useState(null); // { acao, feitos, total } enquanto roda em lote
  const [alterando, setAlterando] = useState(null); // nota em edição (formulário do modal)
  const [salvando, setSalvando] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [erroCnpj, setErroCnpj] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [erroCep, setErroCep] = useState('');
  const [pastaUninfe, setPastaUninfe] = useState(null); // pasta do UniNFe neste navegador (ver src/lib/uninfe.js)
  const [permUninfe, setPermUninfe] = useState(null);
  const verificandoRef = useRef(false);
  const [origemTomador, setOrigemTomador] = useState(''); // de onde vieram os dados auto-preenchidos (ver preencherTomadorCadastrado)

  const carregar = useCallback(async () => {
    setErro('');
    const [{ data: n, error }, { data: f }, modelos] = await Promise.all([
      supabase.from('notas_fiscais').select('*').order('created_at', { ascending: false }).limit(200),
      // Com id: o fornecedor enxerga várias filiais, e sem o filtro o
      // maybeSingle() quebraria ao voltar mais de uma linha.
      supabase.from('filiais').select('*').eq('id', perfil.filial_id).maybeSingle(),
      carregarModelosTicket(),
    ]);
    if (error) setErro(error.message); else setNotas(n || []);
    setFilial(f || null);
    setPadrao(f?.config?.nfse?.padrao || 'padrao_nacional_campinas');
    setModeloRps(modelos.rps || '');
  }, [perfil.filial_id]);
  useEffect(() => { carregar(); }, [carregar]);

  /**
   * Imprime o RPS no layout de Modelos de ticket → RPS (ou no padrão de
   * fábrica, se a filial ainda não cadastrou um).
   */
  async function imprimirRps(n) {
    let movimento = null;
    if (n.movimento_id) {
      const { data } = await supabase.from('movimentos').select('*').eq('id', n.movimento_id).maybeSingle();
      movimento = data;
    }
    setTicket(montarTicketRps({ nota: n, filial, movimento, modelo: modeloRps }));
    setCelularTicket(n.tomador?.celular || n.tomador?.telefone || '');
  }

  // Assinatura (XMLDSig) + envio (mTLS) rodam nas funções do Vercel — elas
  // precisam do certificado, que nunca fica no navegador.
  async function chamarApi(rota, notaId) {
    const { data: sessao } = await supabase.auth.getSession();
    const resp = await fetch(rota, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session?.access_token}` },
      body: JSON.stringify({ notaId }),
    });
    return { httpOk: resp.ok, httpStatus: resp.status, dados: await resp.json() };
  }

  // --- UniNFe (Configurações → Fiscal → "Enviar pelo UniNFe") ------------
  // Só nos padrões nacionais: o app grava o DPS sem assinatura na pasta do
  // UniNFe e lê o retorno — ver src/lib/uninfe.js.
  const usaUninfe = !!filial?.config?.nfse?.envioUninfe && padrao !== 'abrasf';

  async function conectarPasta() {
    setErro('');
    try {
      let handle = pastaUninfe || await pastaGuardada();
      if (handle && await permissaoPasta(handle, true) !== 'granted') handle = null;
      if (!handle) handle = await escolherPasta();
      setPastaUninfe(handle);
      setPermUninfe(await permissaoPasta(handle));
    } catch (e) {
      if (e?.name !== 'AbortError') setErro(`Não consegui acessar a pasta do UniNFe: ${e.message}`);
    }
  }

  async function conectarPastaNova() {
    setErro('');
    try {
      const handle = await escolherPasta();
      setPastaUninfe(handle);
      setPermUninfe(await permissaoPasta(handle));
    } catch (e) {
      if (e?.name !== 'AbortError') setErro(`Não consegui acessar a pasta do UniNFe: ${e.message}`);
    }
  }

  /** Pasta pronta pra uso, ou mensagem de erro já mostrada (devolve null). */
  function pastaPronta() {
    if (pastaUninfe && permUninfe === 'granted') return pastaUninfe;
    setErro('Conecte a pasta do UniNFe (botão "Conectar pasta do UniNFe" acima) antes de enviar.');
    return null;
  }

  /** Envia UMA nota pelo caminho certo; { sucesso, erro } pra uso avulso e em lote. */
  async function enviarNota(nota) {
    if (usaUninfe) {
      const raiz = pastaPronta();
      if (!raiz) return { sucesso: false, erro: 'pasta do UniNFe não conectada' };
      const r = await enviarPeloUninfe({ raiz, nota, filial });
      return { sucesso: r.ok, erro: r.erro };
    }
    const { httpOk, dados } = await chamarApi('/api/gerar-nfse', nota.id);
    return { sucesso: httpOk && dados.ok, erro: dados.erro || dados.status };
  }

  /** Consulta UMA nota: lote do UniNFe lê a pasta Retorno; ABRASF consulta o protocolo. */
  async function consultarNota(nota) {
    if (ehNotaUninfe(nota)) {
      const raiz = pastaPronta();
      if (!raiz) return { sucesso: false, erro: 'pasta do UniNFe não conectada' };
      const r = await verificarRetorno({ raiz, nota });
      return { sucesso: r.status === 'autorizada', erro: r.pronto ? r.resumo : 'UniNFe ainda não devolveu o retorno', r };
    }
    const { httpOk, dados } = await chamarApi('/api/consultar-nfse', nota.id);
    return { sucesso: httpOk && dados.status === 'autorizada', erro: dados.erro || dados.status };
  }

  async function enviar(notaId) {
    setErro(''); setMsg(''); setEnviando(notaId);
    try {
      if (usaUninfe) {
        const r = await enviarNota(notas.find((n) => n.id === notaId));
        if (r.sucesso) setMsg('DPS gravado na pasta Envio do UniNFe — o retorno aparece aqui sozinho quando ele terminar (UniNFe aberto e certificado plugado).');
        else setErro(r.erro);
        return;
      }
      const { httpOk, httpStatus, dados } = await chamarApi('/api/gerar-nfse', notaId);
      if (!httpOk) { setErro(dados.erro || `Falha ao enviar (${httpStatus}).`); return; }
      if (dados.ok && dados.status === 'enviada') setMsg(`Lote enviado — protocolo ${dados.protocolo}. Use "Consultar" pra saber se autorizou.`);
      else if (dados.ok) setMsg(`NFS-e nº ${dados.numeroNfse || '—'} autorizada — chave de acesso ${dados.chaveAcesso || '—'} (ambiente: ${dados.ambiente}).`);
      else setErro(dados.erro || `Rejeitada pelo governo (ambiente: ${dados.ambiente}) — veja o retorno na linha da nota.`);
    } catch (e) {
      setErro(`Falha ao contatar o serviço de envio: ${e.message}`);
    } finally {
      setEnviando(null);
      carregar();
    }
  }

  // ABRASF é assíncrono: "Enviar" só entrega o protocolo do lote (status
  // "enviada"); a nota (ou o erro) sai aqui, consultando o protocolo depois.
  async function consultar(notaId) {
    setErro(''); setMsg(''); setConsultando(notaId);
    try {
      const nota = notas.find((n) => n.id === notaId);
      if (ehNotaUninfe(nota)) {
        const { r, erro: e } = await consultarNota(nota);
        if (!r) setErro(e);
        else if (r.status === 'autorizada') setMsg(`NFS-e${r.numeroNfse ? ` nº ${r.numeroNfse}` : ''} autorizada (pelo UniNFe).`);
        else if (r.status === 'erro') setErro(`${r.resumo} — veja o retorno na linha da nota.`);
        else setMsg(r.resumo || 'O UniNFe ainda não devolveu o retorno — confira se ele está aberto e com o certificado plugado.');
        return;
      }
      const { httpOk, httpStatus, dados } = await chamarApi('/api/consultar-nfse', notaId);
      if (!httpOk) { setErro(dados.erro || `Falha ao consultar (${httpStatus}).`); return; }
      if (dados.jaInformado) setMsg('Este RPS já tinha virado NFS-e num protocolo anterior — marcado como "IA" (informado anteriormente), não é erro.');
      else if (dados.status === 'autorizada') setMsg(`NFS-e autorizada — número ${dados.numeroNfse} (ambiente: ${dados.ambiente}).`);
      else if (dados.status === 'erro') setErro(`Rejeitada pelo governo (ambiente: ${dados.ambiente}) — veja o retorno na linha da nota.`);
      else if (dados.status === 'falha_consulta') setErro(`Falha ao consultar: ${dados.erro}`);
      else setMsg('Ainda em processamento na prefeitura — tente consultar de novo em instantes.');
    } catch (e) {
      setErro(`Falha ao contatar o serviço de consulta: ${e.message}`);
    } finally {
      setConsultando(null);
      carregar();
    }
  }

  async function abrirAlteracao(n) {
    const t = n.tomador || {};
    setAlterando({
      id: n.id, numero_rps: n.numero_rps,
      competencia: n.competencia || '', valor: String(n.valor ?? ''), descricao: n.descricao || '',
      cpf_cnpj: t.cpf_cnpj || '', nome: t.nome || '', endereco: t.endereco || '', numero: t.numero || '',
      bairro: t.bairro || '', cidade: t.cidade || '', uf: t.uf || '', cod_ibge: t.cod_ibge || '',
      cep: t.cep || '', email: t.email || '', telefone: t.telefone || '',
      issRetido: t.issRetido || '', _placa: null,
    });
    setErroCnpj('');
    setOrigemTomador('');
    setErroCep('');

    // Nota veio de uma saída do pátio (tem movimento) — se o recolhimento
    // dessa placa já foi descoberto/corrigido antes (ver src/lib/issRetido.js),
    // pré-preenche sozinho; nota de mensalidade não tem placa própria.
    if (!n.movimento_id) return;
    const { data: mov } = await supabase.from('movimentos').select('placa').eq('id', n.movimento_id).maybeSingle();
    if (!mov?.placa) return;
    setAlterando((a) => (a ? { ...a, _placa: mov.placa } : a));
    if (!t.issRetido) {
      const salvo = await issRetidoDaPlaca(supabase, mov.placa);
      if (salvo) setAlterando((a) => (a ? { ...a, issRetido: AR_PARA_ABRASF[salvo] } : a));
    }
  }

  /**
   * Preenche nome/endereço do tomador a partir do CNPJ (dado público — ver
   * src/lib/cnpj.js). Só vale pra CNPJ: CPF não tem consulta pública
   * equivalente (protegido por sigilo fiscal).
   */
  async function buscarDadosCnpj() {
    setErroCnpj(''); setBuscandoCnpj(true);
    const r = await buscarCnpj(alterando.cpf_cnpj);
    if (r.erro) { setErroCnpj(r.erro); setBuscandoCnpj(false); return; }
    const mun = await municipioIbgeDe(r.cidade, r.uf);
    setBuscandoCnpj(false);
    setAlterando((a) => ({
      ...a, nome: r.nome || a.nome, endereco: r.endereco || a.endereco,
      numero: r.numero || a.numero, bairro: r.bairro || a.bairro, cep: r.cep || a.cep,
      ...(mun ? { cidade: mun.nome, uf: mun.uf, cod_ibge: mun.codigo } : (r.cidade ? { cidade: r.cidade, uf: r.uf } : {})),
    }));
  }

  /**
   * CPF/CNPJ que já apareceu antes (nota anterior, mensalista, convênio;
   * CNPJ também na Receita — ver src/lib/tomador.js): preenche só os campos
   * ainda vazios, nunca apaga o que já foi digitado.
   */
  async function preencherTomadorCadastrado() {
    const doc = alterando?.cpf_cnpj || '';
    if (erroCpfCnpj(doc) || validarCpfCnpj(doc).vazio) return;
    const t = await buscarTomadorCadastrado(supabase, doc);
    if (!t) return;
    const { origem, ...dados } = t;
    setAlterando((a) => {
      if (!a || a.cpf_cnpj !== doc) return a;
      const preenchido = { ...a };
      for (const [campo, valor] of Object.entries(dados)) {
        if (valor && !String(a[campo] ?? '').trim()) preenchido[campo] = valor;
      }
      return preenchido;
    });
    setOrigemTomador(origem);
  }

  /** CEP completo (8 dígitos) preenche logradouro/bairro/cidade (ver src/lib/cep.js). */
  async function mudarCepAlterar(valor) {
    setAlterando((a) => ({ ...a, cep: valor }));
    setErroCep('');
    const cep = valor.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    const r = await buscarCep(cep);
    setBuscandoCep(false);
    if (r.erro) { setErroCep(r.erro); return; }
    setAlterando((a) => {
      if (!a || String(a.cep || '').replace(/\D/g, '') !== cep) return a;
      // CEP geral de cidade vem sem rua/bairro: não apaga o que já foi digitado.
      return {
        ...a, cidade: r.cidade, uf: r.uf, cod_ibge: r.cod_ibge,
        ...(r.endereco ? { endereco: r.endereco } : {}),
        ...(r.bairro ? { bairro: r.bairro } : {}),
      };
    });
  }

  async function salvarAlteracao(e) {
    e.preventDefault();
    setErro(''); setMsg(''); setSalvando(true);
    const a = alterando;
    const { error } = await atualizarNotaFiscal(supabase, a.id, {
      competencia: a.competencia, valor: a.valor, descricao: a.descricao,
      tomador: {
        cpf_cnpj: a.cpf_cnpj, nome: a.nome, endereco: a.endereco, numero: a.numero,
        bairro: a.bairro, cidade: a.cidade, uf: a.uf, cod_ibge: a.cod_ibge,
        cep: a.cep, email: a.email, telefone: a.telefone,
        issRetido: a.issRetido || null,
      },
    });
    setSalvando(false);
    if (error) { setErro(error); return; }
    // Memória por placa (ver src/lib/issRetido.js) — é aqui que o A/R
    // costuma ser descoberto de verdade (rejeição da prefeitura corrigida).
    // Guarda pra próxima visita dessa placa já vir certa, sem precisar
    // rejeitar de novo.
    if (a._placa && a.issRetido) {
      await salvarIssRetidoDaPlaca(supabase, perfil.filial_id, a._placa, ABRASF_PARA_AR[a.issRetido]);
    }
    setAlterando(null);
    setMsg(`RPS ${a.numero_rps} alterado — XML regerado e protocolo limpo. Envie de novo quando quiser.`);
    carregar();
  }

  /**
   * Roda a mesma chamada pra uma fila de notas, uma de cada vez (o webservice
   * da prefeitura não gosta de rajada, e cada envio consome um número de RPS)
   * e resume no fim quantas deram certo. Não recarrega a lista a cada item —
   * só no final, pra tela não ficar piscando.
   */
  async function rodarEmLote(acao, fila, executar) {
    setErro(''); setMsg('');
    setEmLote({ acao, feitos: 0, total: fila.length });
    let ok = 0;
    const falhas = [];
    for (const [i, nota] of fila.entries()) {
      try {
        const { sucesso, erro: e } = await executar(nota);
        if (sucesso) ok++;
        else falhas.push(`RPS ${nota.numero_rps}: ${e || 'falhou'}`);
      } catch (e) {
        falhas.push(`RPS ${nota.numero_rps}: ${e.message}`);
      }
      setEmLote({ acao, feitos: i + 1, total: fila.length });
    }
    setEmLote(null);
    setMsg(`${acao}: ${ok} de ${fila.length} com sucesso.`);
    if (falhas.length) setErro(`${falhas.length} com problema — ${falhas.slice(0, 5).join(' · ')}${falhas.length > 5 ? ' …' : ''}`);
    carregar();
  }

  const pendentesEnvio = notas.filter((n) => n.status === 'gerada' || n.status === 'erro');
  const pendentesConsulta = notas.filter((n) => n.status === 'enviada' && n.lote);
  const ehAbrasf = padrao === 'abrasf';
  const pendentesUninfe = notas.filter((n) => n.status === 'enviada' && ehNotaUninfe(n));
  const idsPendentesUninfe = pendentesUninfe.map((n) => n.id).join(',');

  // Pasta do UniNFe já escolhida antes neste navegador: reaproveita (a
  // permissão pode precisar de um clique pra confirmar — ver conectarPasta).
  useEffect(() => {
    if (!uninfeSuportado()) return;
    pastaGuardada().then(async (h) => {
      if (!h) return;
      setPastaUninfe(h);
      setPermUninfe(await permissaoPasta(h));
    });
  }, []);

  // Com nota esperando o UniNFe e a pasta liberada, olha o Retorno a cada 5 s.
  useEffect(() => {
    if (!idsPendentesUninfe || !pastaUninfe || permUninfe !== 'granted') return undefined;
    const timer = setInterval(async () => {
      if (verificandoRef.current) return;
      verificandoRef.current = true;
      try {
        let mudou = false;
        for (const nota of pendentesUninfe) {
          const r = await verificarRetorno({ raiz: pastaUninfe, nota });
          if (r.pronto) mudou = true;
        }
        if (mudou) carregar();
      } catch {
        // pasta indisponível agora (ex.: permissão revogada) — tenta de novo no próximo ciclo
      } finally {
        verificandoRef.current = false;
      }
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsPendentesUninfe, pastaUninfe, permUninfe]);

  return (
    <>
      <div className="card">
        <div className="card-cab">
          <div>
            <h2>NFS-e / RPS/DPS</h2>
            <p className="suave">
              Documentos gerados na saída do veículo ou no recebimento de mensalidade (menu ⋮ →
              "Gerar DPS"). "Enviar" assina e transmite no padrão configurado em Configurações →
              Fiscal. No ABRASF o envio é assíncrono: primeiro sai um protocolo (status "enviada"),
              depois é preciso "Consultar" pra saber se autorizou.
            </p>
          </div>
          <div className="linha-form">
            <button className="btn-primary" disabled={!!emLote || pendentesEnvio.length === 0}
              onClick={() => rodarEmLote('Enviar todos', pendentesEnvio, enviarNota)}>
              {emLote?.acao === 'Enviar todos'
                ? `Enviando ${emLote.feitos}/${emLote.total}…`
                : `Enviar todos (${pendentesEnvio.length})`}
            </button>
            {/* Só o ABRASF gera protocolo pra consultar (no Padrão Nacional o
                envio já volta autorizado). Continua aparecendo depois de a filial
                trocar de padrão enquanto sobrar lote ABRASF pendente. */}
            {(ehAbrasf || pendentesConsulta.length > 0) && (
              <button className="btn-primary" disabled={!!emLote || pendentesConsulta.length === 0}
                onClick={() => rodarEmLote('Consultar todos', pendentesConsulta, consultarNota)}>
                {emLote?.acao === 'Consultar todos'
                  ? `Consultando ${emLote.feitos}/${emLote.total}…`
                  : `Consultar todos (${pendentesConsulta.length})`}
              </button>
            )}
          </div>
        </div>
        {(usaUninfe || pendentesUninfe.length > 0) && (
          <div className="linha-form" style={{ alignItems: 'center', marginBottom: 8 }}>
            {!uninfeSuportado() ? (
              <span className="aviso">O envio pelo UniNFe precisa do Chrome ou do Edge neste computador.</span>
            ) : pastaUninfe && permUninfe === 'granted' ? (
              <span className="ok-txt">
                UniNFe: pasta <strong>{pastaUninfe.name}</strong> conectada
                {pendentesUninfe.length > 0 && ` — aguardando retorno de ${pendentesUninfe.length} nota(s)`}.
              </span>
            ) : (
              <>
                <span className="suave">UniNFe: {pastaUninfe ? 'confirme o acesso à pasta neste navegador.' : 'escolha a pasta do UniNFe (ex.: C:\\sisparkweb).'}</span>
                <button className="btn-ghost" onClick={conectarPasta}>
                  {pastaUninfe ? 'Permitir acesso à pasta' : 'Conectar pasta do UniNFe'}
                </button>
              </>
            )}
            {pastaUninfe && permUninfe === 'granted' && (
              <button className="btn-ghost" onClick={async () => { setPastaUninfe(null); setPermUninfe(null); await conectarPastaNova(); }}>
                Trocar pasta
              </button>
            )}
          </div>
        )}
        {erro && <div className="aviso">{erro}{erro.includes('notas_fiscais') && ' — rode a migration 0005_fiscal.sql.'}</div>}
        {msg && <div className="ok-txt">{msg}</div>}
      </div>

      <div className="card">
        <h2>Documentos ({notas.length})</h2>
        <div className="tabela-scroll">
          <table>
            <thead><tr><th>RPS/DPS</th><th>Série</th><th>Competência</th><th>Valor</th><th>ISS</th><th>Status</th><th>Chave/NFS-e</th><th></th></tr></thead>
            <tbody>
              {notas.map((n) => (
                <tr key={n.id}>
                  <td className="mono">{n.numero_rps}</td><td>{n.serie}</td>
                  <td className="mono">{fmtDataBR(n.competencia)}</td>
                  <td>{fmtBRL(Number(n.valor))}</td><td>{fmtBRL(Number(n.valor_iss))}</td>
                  <td><span className={'status status-' + n.status}>{n.status}</span></td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {n.numero_nfse || (n.status === 'enviada' && n.lote
                      ? (ehNotaUninfe(n) ? 'aguardando UniNFe' : `protocolo ${n.lote}`)
                      : '—')}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn-ghost" onClick={() => setXml(n.xml)}>XML</button>
                    <button className="btn-ghost" onClick={() => imprimirRps(n)}>Imprimir</button>
                    {n.retorno && <button className="btn-ghost" onClick={() => setRetorno(n.retorno)}>Retorno</button>}
                    {n.status !== 'autorizada' && n.status !== 'cancelada' && (
                      <button className="btn-ghost" disabled={!!emLote} onClick={() => abrirAlteracao(n)}>Alterar</button>
                    )}
                    {(n.status === 'gerada' || n.status === 'erro') && (
                      <button className="btn-primary" disabled={enviando === n.id || !!emLote} onClick={() => enviar(n.id)}>
                        {enviando === n.id ? 'Enviando…' : (n.status === 'erro' ? 'Reenviar' : 'Enviar')}
                      </button>
                    )}
                    {n.status === 'enviada' && (
                      <button className="btn-primary" disabled={consultando === n.id || !!emLote} onClick={() => consultar(n.id)}>
                        {consultando === n.id ? 'Consultando…' : 'Consultar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {notas.length === 0 && <tr><td colSpan={8} className="suave">Nenhum documento.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {ticket && (
        <TicketModal ticket={ticket} filial={filial} perfil={perfil} celular={celularTicket}
          onCelular={setCelularTicket} onFechar={() => setTicket(null)} />
      )}

      {alterando && (
        <div className="modal-bg" onClick={() => setAlterando(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520, maxHeight: '85vh', overflow: 'auto' }}>
            <h2>Alterar RPS/DPS {alterando.numero_rps}</h2>
            <p className="suave">
              Corrija os dados e grave: o XML é regerado e o protocolo é limpo, voltando a nota
              para "gerada" — aí é só enviar de novo. O número do RPS continua o mesmo (no ABRASF,
              reenviar o mesmo número é justamente como se retifica um RPS).
            </p>
            <form onSubmit={salvarAlteracao}>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ maxWidth: 160 }}>
                  <label>Competência</label>
                  <input type="date" value={alterando.competencia} required
                    onChange={(e) => setAlterando({ ...alterando, competencia: e.target.value })} />
                </div>
                <div className="campo" style={{ maxWidth: 120 }}>
                  <label>Valor</label>
                  <input type="number" step="0.01" min="0" value={alterando.valor} required
                    onChange={(e) => setAlterando({ ...alterando, valor: e.target.value })} />
                </div>
              </div>
              <div className="campo" style={{ marginBottom: 10 }}>
                <label>Descrição do serviço</label>
                <input value={alterando.descricao}
                  onChange={(e) => setAlterando({ ...alterando, descricao: e.target.value })} />
              </div>

              <h3 style={{ marginBottom: 4 }}>Tomador</h3>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ maxWidth: 180 }}>
                  <label>CPF/CNPJ</label>
                  <input className="mono" value={alterando.cpf_cnpj}
                    onChange={(e) => { setAlterando({ ...alterando, cpf_cnpj: e.target.value }); setErroCnpj(''); setOrigemTomador(''); }}
                    onBlur={preencherTomadorCadastrado} />
                  {erroCpfCnpj(alterando.cpf_cnpj) && (
                    <span className="aviso" style={{ fontSize: 11 }}>{erroCpfCnpj(alterando.cpf_cnpj)}</span>
                  )}
                </div>
                <div className="campo" style={{ flex: 1 }}>
                  <label>Nome / Razão social</label>
                  <input value={alterando.nome}
                    onChange={(e) => setAlterando({ ...alterando, nome: e.target.value })} />
                </div>
                {validarCpfCnpj(alterando.cpf_cnpj).tipo === 'CNPJ' && (
                  <button type="button" className="btn-ghost" disabled={buscandoCnpj} onClick={buscarDadosCnpj}>
                    {buscandoCnpj ? 'Buscando…' : 'Buscar dados'}
                  </button>
                )}
              </div>
              {erroCnpj && <p className="aviso" style={{ fontSize: 11 }}>{erroCnpj}</p>}
              {origemTomador && (
                <p className="suave" style={{ fontSize: 11, marginTop: -6 }}>Campos vazios preenchidos com dados de: {origemTomador}.</p>
              )}
              <div className="campo" style={{ marginBottom: 10, maxWidth: 260 }}>
                <label>ISS retido pelo tomador?</label>
                <select value={alterando.issRetido} onChange={(e) => setAlterando({ ...alterando, issRetido: e.target.value })}>
                  <option value="">Padrão da filial (Configurações → Fiscal)</option>
                  <option value="2">Não — o estacionamento recolhe</option>
                  <option value="1">Sim — o tomador retém</option>
                </select>
                <span className="suave" style={{ fontSize: 11 }}>
                  Obrigação de cada tomador (varia por lei municipal) — normalmente só se descobre
                  quando a prefeitura rejeita o RPS dizendo que este tomador retém. Vale só pra esta
                  nota, não muda o padrão da filial.
                </span>
              </div>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ flex: 2 }}>
                  <label>Endereço</label>
                  <input value={alterando.endereco}
                    onChange={(e) => setAlterando({ ...alterando, endereco: e.target.value })} />
                </div>
                <div className="campo" style={{ width: 90 }}>
                  <label>Número</label>
                  <input value={alterando.numero}
                    onChange={(e) => setAlterando({ ...alterando, numero: e.target.value })} />
                </div>
              </div>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ flex: 1 }}>
                  <label>Bairro</label>
                  <input value={alterando.bairro}
                    onChange={(e) => setAlterando({ ...alterando, bairro: e.target.value })} />
                </div>
                <div style={{ flex: 2 }}>
                  {/* key: o campo só lê `valor` ao montar — recria quando a busca por CPF/CNPJ preenche a cidade. */}
                  <CidadeBusca key={alterando.cod_ibge || 'sem-cidade'}
                    valor={alterando.cidade && alterando.uf ? `${alterando.cidade} - ${alterando.uf}` : (alterando.cidade || '')}
                    onSelecionar={(mun) => setAlterando({ ...alterando, cidade: mun.nome, uf: mun.uf, cod_ibge: mun.codigo })}
                  />
                </div>
                <div className="campo" style={{ width: 120 }}>
                  <label>CEP</label>
                  <input className="mono" value={alterando.cep} maxLength={9}
                    onChange={(e) => mudarCepAlterar(e.target.value)} />
                  {buscandoCep && <span className="suave" style={{ fontSize: 11 }}>Buscando CEP…</span>}
                  {erroCep && <span className="aviso" style={{ fontSize: 11 }}>{erroCep}</span>}
                </div>
              </div>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ flex: 1 }}>
                  <label>E-mail</label>
                  <input value={alterando.email}
                    onChange={(e) => setAlterando({ ...alterando, email: e.target.value })} />
                </div>
                <div className="campo" style={{ width: 150 }}>
                  <label>Telefone</label>
                  <input value={alterando.telefone}
                    onChange={(e) => setAlterando({ ...alterando, telefone: e.target.value })} />
                </div>
              </div>

              <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn-ghost" onClick={() => setAlterando(null)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={salvando || !!erroCpfCnpj(alterando.cpf_cnpj)}>
                  {salvando ? 'Gravando…' : 'Gravar e limpar protocolo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {xml && (
        <div className="modal-bg" onClick={() => setXml(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxHeight: '80vh', overflow: 'auto' }}>
            <h2>XML do RPS/DPS</h2>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{xml}</pre>
            <div className="linha-form" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setXml(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {retorno && (
        <div className="modal-bg" onClick={() => setRetorno(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxHeight: '80vh', overflow: 'auto' }}>
            <h2>Retorno do governo</h2>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{retorno}</pre>
            <div className="linha-form" style={{ justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setRetorno(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
