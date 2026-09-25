import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { carregarModelosVeiculo } from '../lib/dados.js';
import { normalizar, REGEX_PLACA } from '../lib/texto.js';
import { erroCpfCnpj, validarCpfCnpj } from '../lib/documento.js';
import { buscarCnpj, municipioIbgeDe } from '../lib/cnpj.js';
import { dentroDoVencimento, fmtDataBR, fmtBRL } from '../lib/tempo.js';
import { receberMensalidade, ticketRecebimentoComModelo, descricaoForma } from '../lib/mensalidade.js';
import { TicketModal } from '../componentes/Ticket.jsx';
import { ReceberModal } from '../componentes/ReceberMensalidade.jsx';
import CapturaPlaca from '../componentes/CapturaPlaca.jsx';
import CidadeBusca from '../componentes/CidadeBusca.jsx';

// Mensalistas/hóspedes + os veículos de cada um (1:N) e a quantidade de vagas
// contratadas simultâneas. Se mais veículos do que isso estiverem no pátio ao
// mesmo tempo, os excedentes entram como avulso (checado em Patio.jsx).
// O botão "Receber" grava o pagamento da mensalidade (mensalista_pagamentos),
// avança o próximo pagamento um mês no cadastro e imprime o comprovante.
export default function Mensalistas({ perfil }) {
  const [lista, setLista] = useState([]);
  const [ordenarPor, setOrdenarPor] = useState('codigo'); // 'codigo' (placa) | 'razao' (nome, A-Z)
  const [sel, setSel] = useState(null); // mensalista cujos veículos aparecem embaixo
  const [editando, setEditando] = useState(null); // objeto no modal de cabeçalho (null = fechado)
  const [recebendo, setRecebendo] = useState(null); // mensalista no modal de recebimento
  const [formas, setFormas] = useState([]);
  const [filial, setFilial] = useState(null); // cabeçalho do comprovante
  const [caixaAberto, setCaixaAberto] = useState(null); // só pra avisar no modal de recebimento
  const [ticket, setTicket] = useState(null);
  const [celularTicket, setCelularTicket] = useState('');
  const [erro, setErro] = useState('');

  async function carregar() {
    const { data, error } = await supabase.from('mensalistas').select('*').order('codigo');
    if (error) setErro(error.message); else setLista(data);
  }
  useEffect(() => { carregar(); }, []);

  // Ordenação em memória (a lista inteira já está carregada) — troca na hora,
  // sem ida ao banco. 'codigo' é a placa do veículo principal na maioria dos
  // cadastros (ver importação do legado), daí valer como "por placa".
  const listaOrdenada = useMemo(() => {
    const cmp = ordenarPor === 'razao'
      ? (a, b) => a.razao.localeCompare(b.razao, 'pt-BR', { sensitivity: 'base' })
      : (a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { sensitivity: 'base', numeric: true });
    return [...lista].sort(cmp);
  }, [lista, ordenarPor]);

  useEffect(() => {
    supabase.from('formas_pagamento').select('*').eq('ativo', true).order('codigo')
      .then(({ data }) => setFormas(data || []));
    supabase.from('filiais').select('nome_fantasia, endereco, cnpj, config').eq('id', perfil.filial_id).maybeSingle()
      .then(({ data }) => setFilial(data));
    supabase.from('caixas').select('id').eq('operador_id', perfil.id).eq('status', 'aberto').maybeSingle()
      .then(({ data }) => setCaixaAberto(data));
  }, [perfil.filial_id, perfil.id]);

  async function salvar(m) {
    setErro('');
    const payload = {
      filial_id: perfil.filial_id, codigo: m.codigo, razao: m.razao,
      tipo_mens: m.tipo_mens || 'I', telefone: m.telefone || null, celular: m.celular || null,
      email: m.email || null, box: m.box || null, cpf_cnpj: m.cpf_cnpj || null,
      endereco: m.endereco || null, numero: m.numero || null, bairro: m.bairro || null,
      cidade: m.cidade || null, uf: m.uf || null, cep: m.cep || null, cod_ibge: m.cod_ibge || null,
      iss_retido: m.iss_retido || null,
      dia_venc: m.dia_venc ? Number(m.dia_venc) : null,
      tolerancia_dias: Number(m.tolerancia_dias || 0), qte_vagas: Number(m.qte_vagas || 1),
      valor_mensalidade: Number(m.valor_mensalidade || 0),
      proximo_pagamento: m.proximo_pagamento || null,
      // Dia/turno contratado (RESTRM/T/N) — vazio = sem restrição (todo dia
      // liberado, o comportamento de sempre). Período em branco vira 0, que o
      // motor lê como "usa o padrão 6h/12h/18h" (ver restricaoMensalista.js).
      restr_manha: m.restr_manha || null, restr_tarde: m.restr_tarde || null, restr_noite: m.restr_noite || null,
      periodo1: Number(m.periodo1 || 0), periodo2: Number(m.periodo2 || 0), periodo3: Number(m.periodo3 || 0),
      // "Aceita Extra?" (HORAEXTRA do legado) — aparece na lista de quem pode
      // receber dívida de avulso na saída (Pátio → Devedor → Mensalista, ver
      // 0057_mensalista_extras.sql).
      hora_extra: m.hora_extra ?? false,
      ativo: m.ativo ?? true,
    };
    const res = m.id
      ? await supabase.from('mensalistas').update(payload).eq('id', m.id).select().single()
      : await supabase.from('mensalistas').insert(payload).select().single();
    if (res.error) { setErro(res.error.message); return; }
    setEditando(null); setSel(res.data); carregar();
  }

  async function excluir(id) {
    if (!window.confirm('Excluir este mensalista? Os veículos cadastrados dele também são removidos.')) return;
    setErro('');
    const { error } = await supabase.from('mensalistas').delete().eq('id', id);
    if (error) { setErro(error.message); return; }
    setEditando(null); setSel(null); carregar();
  }

  // Grava o evento de recebimento e avança o próximo pagamento no cadastro.
  async function receber({ mensalista, dtPagamento, valor, forma, proximo, observacao, extrasIds, valorExtra }) {
    setErro('');
    const { error, pagamento } = await receberMensalidade({
      perfil, mensalista, dtPagamento, valor, forma, proximo, observacao, extrasIds, valorExtra,
    });
    if (error) { setErro(error); return; }
    // Reflete a nova data no selecionado (recarrega o histórico logo abaixo).
    setSel((s) => (s && s.id === mensalista.id ? { ...s, proximo_pagamento: proximo } : s));

    setTicket(await ticketRecebimentoComModelo({
      mensalista, dtPagamento, valor, proximo, recibo: pagamento?.id,
      formaDescricao: descricaoForma(formas, forma), operador: perfil.nome,
    }));
    setCelularTicket(mensalista.celular || '');
    setRecebendo(null);
    carregar();
  }

  return (
    <>
      <div className="card">
        <div className="card-cab">
          <div><h2>Mensalistas</h2>
            <p className="suave">Mensalistas/hóspedes, com os veículos e a quantidade de vagas contratadas simultâneas.</p></div>
          <div className="linha-form" style={{ alignItems: 'flex-end' }}>
            <div className="campo" style={{ minWidth: 170 }}>
              <label>Ordenar por</label>
              <select value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value)}>
                <option value="codigo">Placa/código</option>
                <option value="razao">Nome (A-Z)</option>
              </select>
            </div>
            <button className="btn-primary" onClick={() => setEditando({ novo: true })}>+ Novo</button>
          </div>
        </div>
        {erro && <div className="aviso">{erro}</div>}
        <div className="tabela-scroll">
          <table>
            <thead><tr>
              <th>Código</th><th>Nome</th><th>Tipo</th><th>Box</th><th>Vagas</th>
              <th>Mensalidade</th><th>Próx. pagamento</th><th>Ativo</th><th></th>
            </tr></thead>
            <tbody>
              {listaOrdenada.map((m) => (
                <Fragment key={m.id}>
                  <tr className={'linha-clicavel' + (sel?.id === m.id ? ' linha-selecionada' : '')}
                    onClick={() => setSel((s) => (s?.id === m.id ? null : m))}
                    title="Clique pra ver os veículos e recebimentos deste mensalista">
                    <td className="mono">{m.codigo}</td>
                    <td>{m.razao}</td>
                    <td>{rotuloTipoMens(m.tipo_mens)}</td>
                    <td>{m.box || '—'}</td>
                    <td>{m.qte_vagas}</td>
                    <td>{Number(m.valor_mensalidade || 0) > 0 ? fmtBRL(Number(m.valor_mensalidade)) : '—'}</td>
                    <td className="mono">
                      {fmtDataBR(m.proximo_pagamento)}
                      {!dentroDoVencimento(m.proximo_pagamento, m.tolerancia_dias) && (
                        <span className="status status-cancelada" style={{ marginLeft: 6 }} title="Fora da tolerância — entra como avulso no pátio">Vencida</span>
                      )}
                    </td>
                    <td>{m.ativo ? 'Sim' : 'Não'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost" onClick={(e) => { e.stopPropagation(); setSel(m); setEditando(m); }}>Editar</button>
                      <button className="btn-primary" onClick={(e) => { e.stopPropagation(); setSel(m); setRecebendo(m); }}>Receber</button>
                    </td>
                  </tr>
                  {sel?.id === m.id && (
                    <tr>
                      <td colSpan={9} className="linha-expandida">
                        <Veiculos perfil={perfil} mensalista={sel} filial={filial} />
                        <Recebimentos mensalista={sel} formas={formas}
                          onReimprimir={async (p) => {
                            setTicket(await ticketRecebimentoComModelo({
                              mensalista: sel, dtPagamento: p.dt_pagamento, valor: p.valor_pago,
                              proximo: p.proximo_pagamento, formaDescricao: descricaoForma(formas, p.forma_pagamento),
                              operador: perfil.nome, reimpressao: true, recibo: p.id,
                            }));
                            setCelularTicket(sel.celular || '');
                          }} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {lista.length === 0 && <tr><td colSpan={9} className="suave">Nenhum mensalista.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <HeaderModal inicial={editando.novo ? {} : editando} onSalvar={salvar}
          onExcluir={editando.id ? () => excluir(editando.id) : null}
          onFechar={() => setEditando(null)} />
      )}

      {recebendo && (
        <ReceberModal mensalista={recebendo} formas={formas} semCaixa={!caixaAberto}
          perfil={perfil} onAbrirCaixa={setCaixaAberto}
          onConfirmar={receber} onFechar={() => setRecebendo(null)} />
      )}

      {ticket && (
        <TicketModal ticket={ticket} filial={filial} perfil={perfil} celular={celularTicket}
          onCelular={setCelularTicket} onFechar={() => setTicket(null)} />
      )}
    </>
  );
}

function rotuloTipoMens(t) {
  return { I: 'Mensalista', P: 'Pacote', H: 'Hóspede' }[t] || t;
}

// Histórico de recebimentos do mensalista selecionado (com reimpressão do recibo).
function Recebimentos({ mensalista, formas, onReimprimir }) {
  const [pagamentos, setPagamentos] = useState([]);

  useEffect(() => {
    supabase.from('mensalista_pagamentos').select('*')
      .eq('mensalista_id', mensalista.id)
      .order('dt_pagamento', { ascending: false }).order('created_at', { ascending: false })
      .limit(12)
      .then(({ data }) => setPagamentos(data || []));
  }, [mensalista.id, mensalista.proximo_pagamento]);

  return (
    <div className="card">
      <h2>Recebimentos — {mensalista.razao}</h2>
      <table>
        <thead><tr><th>Pagamento</th><th>Valor</th><th>Forma</th><th>Próximo</th><th></th></tr></thead>
        <tbody>
          {pagamentos.map((p) => (
            <tr key={p.id}>
              <td className="mono">{fmtDataBR(p.dt_pagamento)}</td>
              <td>{fmtBRL(Number(p.valor_pago))}</td>
              <td>{descricaoForma(formas, p.forma_pagamento)}</td>
              <td className="mono">{fmtDataBR(p.proximo_pagamento)}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn-ghost" onClick={() => onReimprimir(p)}>Reimprimir</button>
              </td>
            </tr>
          ))}
          {pagamentos.length === 0 && <tr><td colSpan={5} className="suave">Nenhum recebimento registrado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function HeaderModal({ inicial, onSalvar, onExcluir, onFechar }) {
  const [m, setM] = useState(inicial);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [erroCnpj, setErroCnpj] = useState('');
  const set = (k, v) => setM((o) => ({ ...o, [k]: v }));

  /**
   * Preenche nome/endereço a partir do CNPJ (dado público — ver
   * src/lib/cnpj.js). Só vale pra CNPJ: CPF não tem consulta pública
   * equivalente (protegido por sigilo fiscal).
   */
  async function buscarDadosCnpj() {
    setErroCnpj(''); setBuscandoCnpj(true);
    const r = await buscarCnpj(m.cpf_cnpj);
    if (r.erro) { setErroCnpj(r.erro); setBuscandoCnpj(false); return; }
    const mun = await municipioIbgeDe(r.cidade, r.uf);
    setBuscandoCnpj(false);
    setM((o) => ({
      ...o, razao: r.nome || o.razao, endereco: r.endereco || o.endereco,
      numero: r.numero || o.numero, bairro: r.bairro || o.bairro, cep: r.cep || o.cep,
      ...(mun ? { cidade: mun.nome, uf: mun.uf, cod_ibge: mun.codigo } : (r.cidade ? { cidade: r.cidade, uf: r.uf } : {})),
    }));
  }

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: '85vh', overflow: 'auto' }}>
        <h2>{m.id ? 'Editar' : 'Novo'} mensalista</h2>
        <form onSubmit={(e) => { e.preventDefault(); onSalvar(m); }}>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Código *</label>
            <input value={m.codigo || ''} onChange={(e) => set('codigo', e.target.value)} required />
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Nome *</label>
            <input value={m.razao || ''} onChange={(e) => set('razao', e.target.value)} required />
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Tipo</label>
            <select value={m.tipo_mens || 'I'} onChange={(e) => set('tipo_mens', e.target.value)}>
              <option value="I">Mensalista</option>
              <option value="P">Pacote</option>
              <option value="H">Hóspede</option>
            </select>
          </div>
          <div className="linha-form" style={{ marginBottom: 10, alignItems: 'flex-end' }}>
            <div className="campo" style={{ flex: 1 }}>
              <label>CPF/CNPJ</label>
              <input className="mono" value={m.cpf_cnpj || ''} onChange={(e) => { set('cpf_cnpj', e.target.value); setErroCnpj(''); }} />
              {erroCpfCnpj(m.cpf_cnpj)
                ? <span className="aviso" style={{ fontSize: 11 }}>{erroCpfCnpj(m.cpf_cnpj)}</span>
                : <span className="suave" style={{ fontSize: 11 }}>Usado como tomador na nota fiscal do recebimento da mensalidade.</span>}
            </div>
            {validarCpfCnpj(m.cpf_cnpj).tipo === 'CNPJ' && (
              <button type="button" className="btn-ghost" disabled={buscandoCnpj} onClick={buscarDadosCnpj}>
                {buscandoCnpj ? 'Buscando…' : 'Buscar dados'}
              </button>
            )}
          </div>
          {erroCnpj && <p className="aviso" style={{ fontSize: 11 }}>{erroCnpj}</p>}
          <div className="campo" style={{ marginBottom: 10, maxWidth: 320 }}>
            <label>Recolhimento do ISS</label>
            <select value={m.iss_retido || ''} onChange={(e) => set('iss_retido', e.target.value)}>
              <option value="">Padrão da filial (Configurações → Fiscal)</option>
              <option value="A">A — Normal (o estacionamento recolhe)</option>
              <option value="R">R — Retido (o tomador recolhe)</option>
            </select>
            <span className="suave" style={{ fontSize: 11 }}>
              Usado na nota fiscal do recebimento da mensalidade. Normalmente só se descobre quando
              a prefeitura rejeita um RPS dizendo que este mensalista retém.
            </span>
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Telefone</label>
            <input value={m.telefone || ''} onChange={(e) => set('telefone', e.target.value)} />
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Celular</label>
            <input value={m.celular || ''} onChange={(e) => set('celular', e.target.value)} />
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>E-mail</label>
            <input value={m.email || ''} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="linha-form" style={{ marginBottom: 10 }}>
            <div className="campo" style={{ flex: 2 }}>
              <label>Endereço</label>
              <input value={m.endereco || ''} onChange={(e) => set('endereco', e.target.value)} />
            </div>
            <div className="campo" style={{ width: 90 }}>
              <label>Número</label>
              <input value={m.numero || ''} onChange={(e) => set('numero', e.target.value)} />
            </div>
          </div>
          <div className="linha-form" style={{ marginBottom: 10 }}>
            <div className="campo" style={{ flex: 2 }}>
              <label>Bairro</label>
              <input value={m.bairro || ''} onChange={(e) => set('bairro', e.target.value)} />
            </div>
            <div className="campo" style={{ width: 110 }}>
              <label>CEP</label>
              <input value={m.cep || ''} onChange={(e) => set('cep', e.target.value)} />
            </div>
            <div className="campo" style={{ width: 90 }}>
              <label>Box</label>
              <input maxLength={5} value={m.box || ''} onChange={(e) => set('box', e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <CidadeBusca
              valor={m.cidade && m.uf ? `${m.cidade} - ${m.uf}` : (m.cidade || '')}
              onSelecionar={(mun) => { set('cidade', mun.nome); set('uf', mun.uf); set('cod_ibge', mun.codigo); }}
            />
            {!m.cod_ibge && <p className="suave" style={{ fontSize: 11, marginTop: 2 }}>
              {m.cidade ? 'Cadastro antigo, sem código IBGE — busque e selecione a cidade de novo na lista.' : 'Busque e selecione a cidade na lista pra o RPS/DPS sair certo.'}
            </p>}
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Valor da mensalidade</label>
            <input type="number" step="0.01" min="0" value={m.valor_mensalidade ?? ''}
              onChange={(e) => set('valor_mensalidade', e.target.value)} />
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Data do próximo pagamento</label>
            <input type="date" value={m.proximo_pagamento || ''} onChange={(e) => set('proximo_pagamento', e.target.value)} />
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Dia vencimento</label>
            <input type="number" min="1" max="31" value={m.dia_venc ?? ''} onChange={(e) => set('dia_venc', e.target.value)} />
            <span className="suave" style={{ fontSize: 11 }}>Dia fixo do vencimento em todos os meses (ex.: 10 → sempre dia 10, mesmo se o pagamento atrasar).</span>
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Tolerância (dias)</label>
            <input type="number" min="0" value={m.tolerancia_dias ?? ''} onChange={(e) => set('tolerancia_dias', e.target.value)} />
            <span className="suave" style={{ fontSize: 11 }}>Dias de carência após o vencimento em que ainda pode entrar como mensalista. Depois disso, entra como avulso.</span>
          </div>
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Vagas contratadas (veículos simultâneos)</label>
            <input type="number" min="1" value={m.qte_vagas ?? 1} onChange={(e) => set('qte_vagas', e.target.value)} required />
          </div>
          <RestricaoTurnos m={m} set={set} />
          <label className="campo-check" style={{ marginBottom: 4 }}>
            <input type="checkbox" checked={m.hora_extra ?? false} onChange={(e) => set('hora_extra', e.target.checked)} /> Aceita Extra?
          </label>
          <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
            Aparece na lista pra receber dívida de avulso na saída do pátio (forma "Devedor" →
            "Mensalista") — o valor fica pendente até a próxima mensalidade dele ser recebida.
          </p>
          <label className="campo-check" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={m.ativo ?? true} onChange={(e) => set('ativo', e.target.checked)} /> Ativo
          </label>
          <div className="linha-form" style={{ justifyContent: 'space-between', marginTop: 12 }}>
            {onExcluir ? <button type="button" className="btn-ghost aviso-btn" onClick={onExcluir}>Excluir mensalista</button> : <span />}
            <div className="linha-form">
              <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={!!erroCpfCnpj(m.cpf_cnpj)}>Salvar</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TURNOS = [
  { campo: 'restr_manha', rotulo: 'Manhã', periodo: 'periodo1', padrao: '6.00' },
  { campo: 'restr_tarde', rotulo: 'Tarde', periodo: 'periodo2', padrao: '12.00' },
  { campo: 'restr_noite', rotulo: 'Noite', periodo: 'periodo3', padrao: '18.00' },
];

/**
 * Dias/turnos contratados pelo mensalista (RESTRM/T/N do legado) + os
 * horários que começam cada turno (PERIODO1/2/3). Campo vazio = sem
 * restrição, contratado todo dia — é o padrão de quem nunca mexer aqui.
 */
function RestricaoTurnos({ m, set }) {
  function diaContratado(campo, i) {
    const valor = m[campo];
    return valor ? valor.toUpperCase()[i] === 'S' : true; // vazio = liberado
  }
  function alternarDia(campo, i) {
    // Primeira mudança materializa "tudo liberado" (SSSSSSS) antes de marcar
    // o dia clicado como não-contratado — assim o operador só precisa
    // desmarcar os dias que faltam, não montar a string inteira.
    const atual = (m[campo] || 'SSSSSSS').toUpperCase().padEnd(7, 'S').split('');
    atual[i] = atual[i] === 'S' ? 'N' : 'S';
    set(campo, atual.join(''));
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <label>Dias e turnos contratados</label>
      <p className="suave" style={{ fontSize: 11, marginTop: -2, marginBottom: 6 }}>
        Desmarque só o que NÃO está contratado. Tudo marcado (o padrão) entra em qualquer dia/turno, como hoje.
      </p>
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr><th></th>{DIAS_SEMANA.map((d) => <th key={d} style={{ textAlign: 'center' }}>{d}</th>)}<th>A partir de</th></tr>
          </thead>
          <tbody>
            {TURNOS.map((t) => (
              <tr key={t.campo}>
                <td>{t.rotulo}</td>
                {DIAS_SEMANA.map((_, i) => (
                  <td key={i} style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={diaContratado(t.campo, i)}
                      onChange={() => alternarDia(t.campo, i)} />
                  </td>
                ))}
                <td>
                  <input type="number" step="0.01" min="0" style={{ width: 80 }}
                    placeholder={t.padrao} value={m[t.periodo] || ''}
                    onChange={(e) => set(t.periodo, e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="suave" style={{ fontSize: 11 }}>
        Horário HH.MM (ex.: 8.30 = 8h30) em que cada turno começa — termina no início do próximo.
        Em branco usa o padrão 6h/12h/18h.
      </span>
    </div>
  );
}

function Veiculos({ perfil, mensalista, filial }) {
  const [veiculos, setVeiculos] = useState([]);
  const [placa, setPlaca] = useState('');
  const [tipoVeic, setTipoVeic] = useState('');
  const [erro, setErro] = useState('');
  const [confirmPlaca, setConfirmPlaca] = useState(null); // placa fora do formato, aguardando confirmação

  // Busca de modelo no catálogo — mesmo comportamento da Entrada (Pátio).
  const [modelos, setModelos] = useState([]);
  const [buscaModelo, setBuscaModelo] = useState('');
  const [modeloSelecionado, setModeloSelecionado] = useState(null);
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);

  const sugestoes = useMemo(() => {
    const alvo = normalizar(buscaModelo);
    if (alvo.length < 2) return [];
    return modelos.filter((m) => normalizar(m.nome).includes(alvo)).slice(0, 8);
  }, [buscaModelo, modelos]);

  useEffect(() => { carregarModelosVeiculo().then(setModelos); }, []);

  async function carregar() {
    const { data } = await supabase.from('mensalista_veiculos')
      .select('*').eq('mensalista_id', mensalista.id).order('placa');
    setVeiculos(data || []);
  }
  useEffect(() => { carregar(); }, [mensalista.id]);

  function onBuscaModeloChange(v) {
    const up = v.toUpperCase();
    setBuscaModelo(up);
    setMostrarSugestoes(true);
    setModeloSelecionado((m) => (m && normalizar(up) !== normalizar(m.nome)) ? null : m);
  }

  function selecionarModelo(m) {
    setModeloSelecionado(m);
    setBuscaModelo(m.nome);
    setMostrarSugestoes(false);
    if (m.tabela_tipo) setTipoVeic(m.tabela_tipo);
  }

  function limparForm() {
    setPlaca(''); setTipoVeic(''); setConfirmPlaca(null);
    setBuscaModelo(''); setModeloSelecionado(null); setMostrarSugestoes(false);
  }

  async function inserirVeiculo(p) {
    setErro('');
    const { error } = await supabase.from('mensalista_veiculos').insert({
      filial_id: perfil.filial_id, mensalista_id: mensalista.id,
      placa: p, modelo: buscaModelo.trim() || null,
      tipo_veic: tipoVeic.trim().toUpperCase() || null,
    });
    if (error) { setErro(error.code === '23505' ? 'Essa placa já está cadastrada (nesta ou noutra filial).' : error.message); setConfirmPlaca(null); return; }
    limparForm();
    carregar();
  }

  async function adicionar(e) {
    e.preventDefault();
    const p = placa.trim().toUpperCase();
    if (!p) return;
    if (!REGEX_PLACA.test(p)) { setConfirmPlaca(p); return; }
    await inserirVeiculo(p);
  }

  async function excluir(id) { await supabase.from('mensalista_veiculos').delete().eq('id', id); carregar(); }

  return (
    <div className="card">
      <h2>Veículos — {mensalista.razao}</h2>
      <p className="suave">
        Contratou {mensalista.qte_vagas} vaga(s) simultânea(s). Se mais veículos do que isso
        estiverem no pátio ao mesmo tempo, os excedentes entram como avulso.
      </p>
      {erro && <div className="aviso">{erro}</div>}
      <table>
        <thead><tr><th>Placa</th><th>Modelo</th><th>Tabela</th><th></th></tr></thead>
        <tbody>
          {veiculos.map((v) => (
            <tr key={v.id}>
              <td className="mono">{v.placa}</td>
              <td>{v.modelo || '—'}</td>
              <td className="mono">{v.tipo_veic || '—'}</td>
              <td style={{ textAlign: 'right' }}><button className="btn-ghost aviso-btn" onClick={() => excluir(v.id)}>Excluir</button></td>
            </tr>
          ))}
          {veiculos.length === 0 && <tr><td colSpan={4} className="suave">Nenhum veículo cadastrado.</td></tr>}
        </tbody>
      </table>
      <form className="linha-form" onSubmit={adicionar} style={{ marginTop: 10 }}>
        <div className="campo">
          <label>Placa</label>
          <input className="mono" style={{ textTransform: 'uppercase', width: 140 }}
            value={placa} onChange={(e) => { setPlaca(e.target.value); setConfirmPlaca(null); }}
            placeholder="ABC1D23" required />
        </div>
        {(filial?.config?.patio?.usaLeituraPlaca ?? true) && (
          <CapturaPlaca onConfirmar={(p) => { setPlaca(p); setConfirmPlaca(null); }} />
        )}
        <div className="campo campo-busca" style={{ minWidth: 200 }}>
          <label>Modelo</label>
          <input value={buscaModelo}
            onChange={(e) => onBuscaModeloChange(e.target.value)}
            onFocus={() => setMostrarSugestoes(true)}
            onBlur={() => setTimeout(() => setMostrarSugestoes(false), 150)}
            placeholder="Digite o modelo…" style={{ width: '100%' }} />
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
        </div>
        <div className="campo">
          <label>Tabela</label>
          <input className="mono" style={{ width: 80, textTransform: 'uppercase' }}
            value={tipoVeic} onChange={(e) => setTipoVeic(e.target.value)} />
        </div>
        <button className="btn-primary" type="submit">+ Veículo</button>
        {modeloSelecionado && <span className="badge-mens">Tabela: {modeloSelecionado.tabela_tipo}</span>}
      </form>

      {confirmPlaca && (
        <div className="modal-bg" onClick={() => setConfirmPlaca(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Confirmar placa</h2>
            <p className="suave">Essa placa não parece ter um formato válido (ex.: ABC1234 ou ABC1D23).</p>
            <div className="grande mono">{confirmPlaca}</div>
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setConfirmPlaca(null)}>Não, corrigir</button>
              <button className="btn-primary" onClick={() => inserirVeiculo(confirmPlaca)}>Sim, está correta</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
