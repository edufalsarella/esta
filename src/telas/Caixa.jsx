import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { fmtBRL, dataHoraDe } from '../lib/tempo.js';
import { carregarRelatorioCaixa, imprimirRelatorioCaixa, textoRelatorioCaixa } from '../lib/caixaRelatorio.js';
import { ehGerente } from '../lib/acesso.js';

const fmtQuando = (d) => d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function Caixa({ perfil }) {
  const [caixa, setCaixa] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [movimentacoes, setMovimentacoes] = useState([]);
  const [erro, setErro] = useState('');
  const [abertura, setAbertura] = useState('0');
  const [sangria, setSangria] = useState({ valor: '', motivo: '' });
  const [contado, setContado] = useState('');
  const [filial, setFilial] = useState(null); // cabeçalho do relatório impresso
  const [caixaFechado, setCaixaFechado] = useState(null); // caixa recém-fechado — oferece "Imprimir relatório"
  const [historico, setHistorico] = useState([]);
  const [imprimindo, setImprimindo] = useState(null); // id do caixa sendo carregado pra impressão
  const [relatorioPreview, setRelatorioPreview] = useState(null); // { dados, reimpressao } — prévia na tela antes de imprimir/enviar

  useEffect(() => {
    supabase.from('filiais').select('nome_fantasia, cnpj').eq('id', perfil.filial_id).maybeSingle()
      .then(({ data }) => setFilial(data));
  }, [perfil.filial_id]);

  const carregar = useCallback(async () => {
    setErro('');
    const { data: c, error } = await supabase.from('caixas').select('*')
      .eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle();
    if (error) { setErro(error.message); return; }
    setCaixa(c);
    if (!c) { setResumo(null); setMovimentacoes([]); return; }

    const [{ data: movs }, { data: sangrias }, { data: formas }, { data: mensPagtos }, { data: antecipadosEntrada }, { data: antecipadosReserva }, { data: vendasProdutos }] = await Promise.all([
      supabase.from('movimentos').select('id,placa,modelo,valor,dt_saida,hr_saida').eq('caixa_id', c.id).not('dt_saida', 'is', null),
      supabase.from('sangrias').select('id,valor,motivo,created_at').eq('caixa_id', c.id),
      supabase.from('formas_pagamento').select('codigo,descricao,eh_dinheiro'),
      // Mensalidades recebidas neste turno (Mensalistas → Receber).
      supabase.from('mensalista_pagamentos').select('id,valor_pago,forma_pagamento,created_at,mensalistas(razao)').eq('caixa_id', c.id),
      // Valores antecipados recebidos na ENTRADA neste turno (ver 0039_valor_antecipado.sql)
      // — ligados direto pelo próprio caixa_id do pagamento, não pelo do movimento
      // (que só é gravado na saída, podendo ser um turno diferente).
      supabase.from('movimento_pagamentos').select('id,valor,forma_pagamento,created_at,movimentos(placa)').eq('caixa_id', c.id),
      // Valores antecipados recebidos ao CRIAR UMA RESERVA neste turno (ver
      // 0040_reserva_antecipado.sql) — mesmo raciocínio, caixa_id próprio.
      supabase.from('reservas').select('id,placa,nome,valor_antecipado,forma_antecipado,created_at').eq('caixa_id_antecipado', c.id),
      // Vendas de produto (balcão) neste turno (ver 0042_produtos.sql) — nunca
      // passa por movimentos/notas_fiscais, caixa_id próprio igual antecipado.
      supabase.from('vendas_produtos').select('id,quantidade,valor_total,forma_pagamento,criado_em,produtos(descricao)').eq('caixa_id', c.id),
    ]);
    const dinheiroCods = new Set((formas || []).filter((f) => f.eh_dinheiro).map((f) => f.codigo));
    const descForma = Object.fromEntries((formas || []).map((f) => [f.codigo, f.descricao]));
    let dinheiroSaidas = 0, total = 0;
    const ids = (movs || []).map((m) => m.id);
    total = (movs || []).reduce((s, m) => s + Number(m.valor || 0), 0);
    // Forma(s) de pagamento de cada saída, pro extrato abaixo — split (mais
    // de uma forma na mesma saída) junta com " + ".
    const formasPorMovimento = {};
    if (ids.length) {
      // Só pagamento de saída (caixa_id null) — o de antecipado tem o
      // próprio caixa_id e já é somado à parte (`antecipados` abaixo), senão
      // contaria o mesmo dinheiro duas vezes se saída e entrada caíssem no
      // mesmo turno.
      const { data: pg } = await supabase.from('movimento_pagamentos').select('*').in('movimento_id', ids).is('caixa_id', null);
      dinheiroSaidas = (pg || []).filter((p) => dinheiroCods.has(p.forma_pagamento)).reduce((s, p) => s + Number(p.valor || 0), 0);
      for (const p of pg || []) {
        (formasPorMovimento[p.movimento_id] ||= []).push(descForma[p.forma_pagamento] || p.forma_pagamento);
      }
    }
    const mensalidades = (mensPagtos || []).reduce((s, p) => s + Number(p.valor_pago || 0), 0);
    const dinheiroMensalidades = (mensPagtos || [])
      .filter((p) => dinheiroCods.has(p.forma_pagamento))
      .reduce((s, p) => s + Number(p.valor_pago || 0), 0);
    // Antecipado feito na entrada (movimento_pagamentos) + antecipado feito
    // ao criar a reserva (reservas) — mesma natureza (dinheiro recebido
    // antes da hora, contado neste turno), somados num "Antecipados" só.
    const reservasAntecip = (antecipadosReserva || []).filter((r) => Number(r.valor_antecipado) > 0);
    const antecipadosTotal = (antecipadosEntrada || []).reduce((s, p) => s + Number(p.valor || 0), 0)
      + reservasAntecip.reduce((s, r) => s + Number(r.valor_antecipado), 0);
    const dinheiroAntecipados = (antecipadosEntrada || [])
      .filter((p) => dinheiroCods.has(p.forma_pagamento))
      .reduce((s, p) => s + Number(p.valor || 0), 0)
      + reservasAntecip.filter((r) => dinheiroCods.has(r.forma_antecipado))
        .reduce((s, r) => s + Number(r.valor_antecipado), 0);
    const produtosTotal = (vendasProdutos || []).reduce((s, v) => s + Number(v.valor_total || 0), 0);
    const dinheiroProdutos = (vendasProdutos || [])
      .filter((v) => dinheiroCods.has(v.forma_pagamento))
      .reduce((s, v) => s + Number(v.valor_total || 0), 0);
    const dinheiro = dinheiroSaidas + dinheiroMensalidades + dinheiroAntecipados + dinheiroProdutos;
    const totalSangria = (sangrias || []).reduce((s, x) => s + Number(x.valor || 0), 0);

    // Extrato do turno, item a item — pra conferir na hora, não só o resumo
    // agregado dos Kpis acima. Mais recente primeiro (mesmo critério da lista
    // do pátio).
    const itens = [
      ...(movs || []).map((m) => ({
        id: `saida-${m.id}`, quando: dataHoraDe(m.dt_saida, Number(m.hr_saida)), tipo: 'Saída',
        descricao: `${m.placa}${m.modelo ? ` — ${m.modelo}` : ''}`,
        forma: (formasPorMovimento[m.id] || []).join(' + ') || null, valor: Number(m.valor || 0),
      })),
      ...(mensPagtos || []).map((p) => ({
        id: `mens-${p.id}`, quando: new Date(p.created_at), tipo: 'Mensalidade',
        descricao: p.mensalistas?.razao || '—', forma: descForma[p.forma_pagamento] || p.forma_pagamento,
        valor: Number(p.valor_pago || 0),
      })),
      ...(antecipadosEntrada || []).map((p) => ({
        id: `ant-${p.id}`, quando: new Date(p.created_at), tipo: 'Antecipado',
        descricao: p.movimentos?.placa ? `Entrada ${p.movimentos.placa}` : 'Entrada de veículo',
        forma: descForma[p.forma_pagamento] || p.forma_pagamento, valor: Number(p.valor || 0),
      })),
      ...reservasAntecip.map((r) => ({
        id: `res-${r.id}`, quando: new Date(r.created_at), tipo: 'Antecipado',
        descricao: `Reserva${r.placa ? ` ${r.placa}` : ''}${r.nome ? ` — ${r.nome}` : ''}`,
        forma: descForma[r.forma_antecipado] || r.forma_antecipado, valor: Number(r.valor_antecipado || 0),
      })),
      ...(vendasProdutos || []).map((v) => ({
        id: `prod-${v.id}`, quando: new Date(v.criado_em), tipo: 'Produto',
        descricao: `${v.produtos?.descricao || '—'} (${Number(v.quantidade)}x)`,
        forma: descForma[v.forma_pagamento] || v.forma_pagamento, valor: Number(v.valor_total || 0),
      })),
      ...(sangrias || []).map((s) => ({
        id: `sang-${s.id}`, quando: new Date(s.created_at), tipo: 'Sangria',
        descricao: s.motivo || '—', forma: null, valor: -Number(s.valor || 0),
      })),
    ].sort((a, b) => b.quando - a.quando);
    setMovimentacoes(itens);

    setResumo({
      qtd: (movs || []).length, total, dinheiro, sangrias: totalSangria,
      qtdMensalidades: (mensPagtos || []).length, mensalidades,
      qtdAntecipados: (antecipadosEntrada || []).length + reservasAntecip.length, antecipados: antecipadosTotal,
      qtdProdutos: (vendasProdutos || []).length, produtos: produtosTotal,
      esperadoCaixa: Number(c.valor_abertura) + dinheiro - totalSangria,
    });
  }, [perfil.id]);

  const carregarHistorico = useCallback(async () => {
    // Cada um vê os próprios caixas fechados; gerente/supervisor/fornecedor
    // vê os de todo mundo na filial (RLS já isola por filial — aqui é só
    // decidir se restringe também por operador).
    let q = supabase.from('caixas').select('*, perfis(nome)').eq('status', 'fechado')
      .order('numero', { ascending: false }).limit(30);
    if (!ehGerente(perfil)) q = q.eq('operador_id', perfil.id);
    const { data, error } = await q;
    if (error) { setErro(error.message); return; }
    setHistorico(data || []);
  }, [perfil]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarHistorico(); }, [carregarHistorico]);

  async function abrir() {
    const { error } = await supabase.from('caixas').insert({
      filial_id: perfil.filial_id, operador_id: perfil.id, valor_abertura: Number(abertura || 0),
    });
    if (error) setErro(error.message); else carregar();
  }
  async function lancarSangria(e) {
    e.preventDefault();
    const { error } = await supabase.from('sangrias').insert({
      filial_id: perfil.filial_id, caixa_id: caixa.id, operador_id: perfil.id,
      valor: Number(sangria.valor), motivo: sangria.motivo,
    });
    if (error) setErro(error.message); else { setSangria({ valor: '', motivo: '' }); carregar(); }
  }
  async function fechar() {
    if (!window.confirm('Fechar o caixa deste turno?')) return;
    const { data: fechado, error } = await supabase.from('caixas').update({
      status: 'fechado', fechado_em: new Date().toISOString(), valor_fechamento: Number(contado || 0),
    }).eq('id', caixa.id).select().single();
    if (error) { setErro(error.message); return; }
    setContado('');
    setCaixaFechado(fechado);
    carregar();
    carregarHistorico();
  }

  // Antes ia direto pra impressão; agora mostra a prévia na tela primeiro —
  // dali o operador escolhe Imprimir, Enviar por e-mail/WhatsApp ou Cancelar
  // (ver RelatorioCaixaModal).
  async function imprimir(c, reimpressao = false) {
    setErro(''); setImprimindo(c.id);
    try {
      const dados = await carregarRelatorioCaixa(c);
      setRelatorioPreview({ dados, reimpressao });
    } catch (e) {
      setErro(e.message);
    } finally {
      setImprimindo(null);
    }
  }

  const modalRelatorio = relatorioPreview && (
    <RelatorioCaixaModal dados={relatorioPreview.dados} filial={filial} reimpressao={relatorioPreview.reimpressao}
      onFechar={() => setRelatorioPreview(null)} />
  );

  if (erro) return <div className="card aviso">{erro}<p className="suave">Se a tabela não existir, rode a migration 0003_caixa.sql.</p></div>;

  if (!caixa) return (
    <>
      {caixaFechado && (
        <div className="card" style={{ maxWidth: 460, borderColor: 'var(--ok)' }}>
          <h2>Caixa Nº {caixaFechado.numero} fechado</h2>
          <p className="ok-txt">Turno encerrado com sucesso.</p>
          <div className="linha-form" style={{ justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={() => setCaixaFechado(null)}>Fechar aviso</button>
            <button className="btn-primary" disabled={imprimindo === caixaFechado.id} onClick={() => imprimir(caixaFechado)}>
              {imprimindo === caixaFechado.id ? 'Gerando…' : 'Imprimir relatório'}
            </button>
          </div>
        </div>
      )}
      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Abrir caixa</h2>
        <p className="suave">Nenhum caixa aberto para você. Informe o troco inicial.</p>
        <div className="campo" style={{ marginBottom: 12 }}>
          <label>Troco de abertura</label>
          <input type="number" step="0.01" value={abertura} onChange={(e) => setAbertura(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={abrir}>Abrir caixa</button>
      </div>
      <HistoricoCaixas historico={historico} imprimindo={imprimindo} onImprimir={imprimir} vendoTodos={ehGerente(perfil)} />
      {modalRelatorio}
    </>
  );

  const dif = resumo ? Number(contado || 0) - resumo.esperadoCaixa : 0;

  return (
    <>
      <div className="card">
        <div className="card-cab">
          <div>
            <h2>Caixa Nº {caixa.numero} aberto</h2>
            <p className="suave">
              Desde {new Date(caixa.aberto_em).toLocaleString('pt-BR')}
              {' · Troco de abertura: '}<strong>{fmtBRL(Number(caixa.valor_abertura || 0))}</strong>
            </p>
          </div>
        </div>
        {resumo && (
          <div className="kpis">
            <Kpi rotulo="Saídas no turno" valor={resumo.qtd} />
            <Kpi rotulo="Faturado (saídas)" valor={fmtBRL(resumo.total)} moeda />
            <Kpi rotulo={`Mensalidades (${resumo.qtdMensalidades})`} valor={fmtBRL(resumo.mensalidades)} moeda />
            <Kpi rotulo={`Antecipados (${resumo.qtdAntecipados})`} valor={fmtBRL(resumo.antecipados)} moeda />
            <Kpi rotulo={`Venda de produtos (${resumo.qtdProdutos})`} valor={fmtBRL(resumo.produtos)} moeda />
            <Kpi rotulo="Total do turno" valor={fmtBRL(resumo.total + resumo.mensalidades + resumo.antecipados + resumo.produtos)} moeda />
            <Kpi rotulo="Em dinheiro" valor={fmtBRL(resumo.dinheiro)} moeda />
            <Kpi rotulo="Sangrias" valor={fmtBRL(resumo.sangrias)} moeda />
            <Kpi rotulo="Esperado no caixa" valor={fmtBRL(resumo.esperadoCaixa)} destaque moeda />
          </div>
        )}
        <p className="suave">
          "Em dinheiro" e "Esperado no caixa" já incluem as mensalidades, os valores antecipados e
          as vendas de produtos recebidos neste turno.
        </p>
      </div>

      <div className="card">
        <h2>Movimentações do turno ({movimentacoes.length})</h2>
        <p className="suave">Tudo que entrou (e as sangrias que saíram) neste caixa, do mais recente pro mais antigo — pra conferir antes de fechar.</p>
        <div className="tabela-scroll">
          <table>
            <thead><tr><th>Quando</th><th>Tipo</th><th>Descrição</th><th>Forma</th><th>Valor</th></tr></thead>
            <tbody>
              {movimentacoes.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{fmtQuando(m.quando)}</td>
                  <td>{m.tipo}</td>
                  <td>{m.descricao}</td>
                  <td>{m.forma || '—'}</td>
                  <td style={m.valor < 0 ? { color: 'var(--erro)' } : undefined}>{fmtBRL(m.valor)}</td>
                </tr>
              ))}
              {movimentacoes.length === 0 && <tr><td colSpan={5} className="suave">Nada lançado neste turno ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Sangria</h2>
        <form className="linha-form" onSubmit={lancarSangria}>
          <div className="campo"><label>Valor</label><input type="number" step="0.01" value={sangria.valor} onChange={(e) => setSangria({ ...sangria, valor: e.target.value })} required /></div>
          <div className="campo"><label>Motivo</label><input value={sangria.motivo} onChange={(e) => setSangria({ ...sangria, motivo: e.target.value })} /></div>
          <button className="btn-primary" type="submit">Registrar</button>
        </form>
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Fechamento</h2>
        <div className="campo" style={{ marginBottom: 8 }}>
          <label>Dinheiro contado</label>
          <input type="number" step="0.01" value={contado} onChange={(e) => setContado(e.target.value)} />
        </div>
        {contado !== '' && (
          <p className={Math.abs(dif) < 0.005 ? 'ok-txt' : 'aviso'}>
            Diferença: {fmtBRL(dif)} {Math.abs(dif) < 0.005 ? '(fechado certo)' : dif > 0 ? '(sobra)' : '(falta)'}
          </p>
        )}
        <p className="suave" style={{ fontSize: 11 }}>
          Depois de fechar, o relatório fica pronto pra imprimir (bobina de 58mm) — dá pra
          reimprimir a qualquer momento na lista de "Caixas fechados" abaixo.
        </p>
        <button className="btn-primary" onClick={fechar}>Fechar caixa</button>
      </div>

      <HistoricoCaixas historico={historico} imprimindo={imprimindo} onImprimir={imprimir} vendoTodos={ehGerente(perfil)} />
      {modalRelatorio}
    </>
  );
}

/**
 * Prévia do relatório na tela — antes ia direto pra impressão (ver
 * comentário em `imprimir` acima). "Imprimir"/e-mail/WhatsApp não fecham a
 * prévia sozinhos (o operador pode querer mais de um canal do mesmo
 * fechamento); só "Cancelar" ou clicar fora fecha.
 */
function RelatorioCaixaModal({ dados, filial, reimpressao, onFechar }) {
  const { caixa } = dados;
  const texto = textoRelatorioCaixa(dados, filial, reimpressao);
  const linkWhatsApp = `https://wa.me/?text=${encodeURIComponent(texto)}`;
  const linkEmail = `mailto:?subject=${encodeURIComponent(`Fechamento de Caixa Nº ${caixa.numero}`)}&body=${encodeURIComponent(texto)}`;
  const formasEntries = Object.entries(dados.porForma);

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Fechamento de Caixa Nº {caixa.numero}</h2>
        <p className="suave" style={{ marginTop: -6 }}>
          De: {new Date(caixa.aberto_em).toLocaleString('pt-BR')}<br />
          Até: {caixa.fechado_em ? new Date(caixa.fechado_em).toLocaleString('pt-BR') : 'em aberto'}
        </p>

        <SecaoRelatorio titulo="Veículos">
          <div>Saídas no turno: {dados.qtdSaidas}</div>
          <div>&nbsp;&nbsp;Avulso: {dados.porTipo.avulso}</div>
          <div>&nbsp;&nbsp;Mensalista: {dados.porTipo.mensalista}</div>
          <div>Cancelados: {dados.qtdCancelados}</div>
          {!reimpressao && <div>Sem saída (no pátio): {dados.qtdSemSaida}</div>}
        </SecaoRelatorio>

        <SecaoRelatorio titulo="Faturamento">
          <div>Valor faturado: {fmtBRL(dados.valorFaturado)}</div>
          <div>Descontos (convênio): {fmtBRL(dados.descontos)}</div>
          <div>Mensalidades: {fmtBRL(dados.mensalidadesTotal)}</div>
          <div>Antecipados: {fmtBRL(dados.antecipadosTotal)}</div>
          <div>Venda de produtos: {fmtBRL(dados.produtosTotal)}</div>
          <div><strong>Total recebido: {fmtBRL(dados.totalRecebido)}</strong></div>
        </SecaoRelatorio>

        <SecaoRelatorio titulo="Caixa">
          <div>Troco de abertura: {fmtBRL(Number(caixa.valor_abertura || 0))}</div>
          <div>Sangrias: {fmtBRL(dados.sangriasTotal)}</div>
          {dados.sangrias.map((s) => <div key={s.id}>&nbsp;&nbsp;{s.motivo || 'Sangria'}: -{fmtBRL(s.valor)}</div>)}
          <div>Dinheiro recebido: {fmtBRL(dados.dinheiro)}</div>
          <div><strong>Esperado no caixa: {fmtBRL(dados.esperadoCaixa)}</strong></div>
          {caixa.valor_fechamento != null && <div>Dinheiro contado: {fmtBRL(Number(caixa.valor_fechamento))}</div>}
          {dados.diferenca != null && (
            <div className={Math.abs(dados.diferenca) < 0.005 ? 'ok-txt' : 'aviso-btn'}>
              Diferença: {dados.diferenca >= 0 ? '+' : ''}{fmtBRL(dados.diferenca)}
            </div>
          )}
        </SecaoRelatorio>

        <SecaoRelatorio titulo="Formas de pagamento">
          {formasEntries.length
            ? formasEntries.map(([k, v]) => <div key={k}>{dados.descForma[k] || k}: {fmtBRL(v)}</div>)
            : <div>Sem recebimentos: —</div>}
        </SecaoRelatorio>

        {Object.keys(dados.porConvenio).length > 0 && (
          <SecaoRelatorio titulo="Convênios">
            {Object.entries(dados.porConvenio).map(([k, v]) => (
              <div key={k}>{dados.descConvenio[k] || k} ({v.qtd}): {fmtBRL(v.desconto)}</div>
            ))}
          </SecaoRelatorio>
        )}

        {Object.keys(dados.porTabela).length > 0 && (
          <SecaoRelatorio titulo="Tabelas de preço">
            {Object.entries(dados.porTabela).map(([k, v]) => (
              <div key={k}>{dados.descTabela[k] || k} ({v.qtd}): {fmtBRL(v.valor)}</div>
            ))}
          </SecaoRelatorio>
        )}

        {dados.mensalidades.length > 0 && (
          <SecaoRelatorio titulo={`Mensalidades recebidas (${dados.mensalidades.length})`}>
            {dados.mensalidades.map((m) => <div key={m.id}>{m.nome}: {fmtBRL(m.valor)}</div>)}
          </SecaoRelatorio>
        )}

        {dados.produtos.length > 0 && (
          <SecaoRelatorio titulo={`Vendas de produtos (${dados.produtos.length})`}>
            {dados.produtos.map((p) => <div key={p.id}>{p.nome} ({p.quantidade}x): {fmtBRL(p.valor)}</div>)}
          </SecaoRelatorio>
        )}

        {dados.antecipados.length > 0 && (
          <SecaoRelatorio titulo={`Antecipados (${dados.antecipados.length})`}>
            {dados.antecipados.map((a) => <div key={a.id}>{a.ref}: {fmtBRL(a.valor)}</div>)}
          </SecaoRelatorio>
        )}

        <p className="suave" style={{ fontSize: 12, marginTop: 12 }}>Operador: {dados.operador}</p>

        <div className="linha-form" style={{ justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <a className="btn-ghost" href={linkEmail} target="_blank" rel="noopener noreferrer">Enviar por e-mail</a>
          <a className="btn-ghost" href={linkWhatsApp} target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a>
          <button className="btn-primary" onClick={() => imprimirRelatorioCaixa(dados, filial, reimpressao)}>Imprimir</button>
        </div>
      </div>
    </div>
  );
}

function SecaoRelatorio({ titulo, children }) {
  return (
    <>
      <h3 style={{ marginTop: 14, marginBottom: 4, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--suave)' }}>{titulo}</h3>
      <div className="mono" style={{ fontSize: 13, lineHeight: 1.5 }}>{children}</div>
    </>
  );
}

function HistoricoCaixas({ historico, imprimindo, onImprimir, vendoTodos }) {
  return (
    <div className="card">
      <h2>Caixas fechados</h2>
      <p className="suave">
        {vendoTodos ? 'Últimos 30 turnos fechados na filial, de todos os operadores.' : 'Seus últimos 30 turnos fechados.'}
      </p>
      <div className="tabela-scroll">
        <table>
          <thead><tr>
            <th>Nº</th>{vendoTodos && <th>Operador</th>}<th>Aberto em</th><th>Fechado em</th><th>Contado</th><th></th>
          </tr></thead>
          <tbody>
            {historico.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.numero}</td>
                {vendoTodos && <td>{c.perfis?.nome || '—'}</td>}
                <td className="mono">{new Date(c.aberto_em).toLocaleString('pt-BR')}</td>
                <td className="mono">{c.fechado_em ? new Date(c.fechado_em).toLocaleString('pt-BR') : '—'}</td>
                <td>{fmtBRL(Number(c.valor_fechamento || 0))}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn-ghost" disabled={imprimindo === c.id} onClick={() => onImprimir(c, true)}>
                    {imprimindo === c.id ? 'Gerando…' : 'Imprimir relatório'}
                  </button>
                </td>
              </tr>
            ))}
            {historico.length === 0 && <tr><td colSpan={vendoTodos ? 6 : 5} className="suave">Nenhum caixa fechado ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * `moeda`: tira o "R$" do valor (fica só o número) e mostra "(R$)" junto do
 * rótulo — igual BI.jsx: com valor grande, "R$ 1.039,50" não cabia na
 * largura do cartão; o número sozinho cabe bem mais.
 */
function Kpi({ rotulo, valor, destaque, moeda }) {
  const texto = moeda ? String(valor).replace('R$', '').trim() : valor;
  return (
    <div className={'kpi' + (destaque ? ' destaque' : '')}>
      <div className="kpi-rotulo">{rotulo}{moeda ? ' (R$)' : ''}</div>
      <div className="kpi-valor">{texto}</div>
    </div>
  );
}
