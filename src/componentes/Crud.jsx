import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import CidadeBusca from './CidadeBusca.jsx';

/**
 * CRUD genérico sobre uma tabela do Supabase (RLS isola por filial).
 * `colunas`: [{ campo, rotulo, tipo?('text'|'number'|'bool'|'hora'|'select'|'cidade'), opcoes?, obrigatorio?, naTabela?, noForm?, oculto? }]
 * `exclusivos`: grupos de campos que não podem conviver, ex.: [['perc_conv','vlr_conv','tab_horas']].
 *   Preencher um zera os outros do grupo — evita a regra silenciosa de qual
 *   deles vence quando mais de um está preenchido.
 * `tipo: 'cidade'` (busca por cidade → nome + UF + código IBGE, ver
 * CidadeBusca.jsx) precisa de mais dois `campo`s no array (o UF e o código
 * IBGE) pra `salvar` gravar os três — marque os dois com `oculto: true` pra
 * eles não ganharem sua própria linha no formulário (o widget já preenche os
 * três juntos). Mesmo padrão já usado à mão em Configuracoes/Fiscal/Mensalistas.
 */
export default function Crud({ perfil, titulo, subtitulo, tabela, colunas, ordem = 'created_at', ascending = true, aoMudar, exclusivos = [] }) {
  const [linhas, setLinhas] = useState([]);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(null); // objeto (edição) ou {} (novo)

  async function carregar() {
    const { data, error } = await supabase.from(tabela).select('*').order(ordem, { ascending });
    if (error) setErro(error.message);
    else { setLinhas(data); setErro(''); }
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [tabela]);

  async function salvar(obj) {
    setErro('');
    const payload = { filial_id: perfil.filial_id };
    for (const c of colunas) {
      if (c.noForm === false) continue;
      let v = obj[c.campo];
      if (v === '' || v === undefined) v = null;
      if (c.tipo === 'number' || c.tipo === 'hora') v = v === null ? null : Number(v);
      if (c.tipo === 'bool') v = Boolean(v);
      payload[c.campo] = v;
    }
    const res = obj.id
      ? await supabase.from(tabela).update(payload).eq('id', obj.id)
      : await supabase.from(tabela).insert(payload);
    if (res.error) setErro(res.error.message);
    else { setEditando(null); carregar(); aoMudar?.(); }
  }

  async function excluir(id) {
    if (!window.confirm('Excluir este registro?')) return;
    const { error } = await supabase.from(tabela).delete().eq('id', id);
    if (error) setErro(error.message); else carregar();
  }

  const colsTabela = colunas.filter((c) => c.naTabela !== false);

  return (
    <div className="card">
      <div className="card-cab">
        <div>
          <h2>{titulo}</h2>
          {subtitulo && <p className="suave">{subtitulo}</p>}
        </div>
        <button className="btn-primary" onClick={() => setEditando({})}>+ Novo</button>
      </div>
      {erro && <div className="aviso">{erro}</div>}
      <div className="tabela-scroll">
        <table>
          <thead>
            <tr>{colsTabela.map((c) => <th key={c.campo}>{c.rotulo}</th>)}<th></th></tr>
          </thead>
          <tbody>
            {linhas.map((r) => (
              <tr key={r.id}>
                {colsTabela.map((c) => <td key={c.campo}>{formatar(r[c.campo], c)}</td>)}
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn-ghost" onClick={() => setEditando(r)}>Editar</button>
                  <button className="btn-ghost aviso-btn" onClick={() => excluir(r.id)}>Excluir</button>
                </td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={colsTabela.length + 1} className="suave">Nenhum registro.</td></tr>}
          </tbody>
        </table>
      </div>
      {editando && (
        <FormModal colunas={colunas} inicial={editando} exclusivos={exclusivos} erro={erro}
          onSalvar={salvar} onFechar={() => setEditando(null)} titulo={titulo} />
      )}
    </div>
  );
}

function formatar(v, c) {
  if (v === null || v === undefined) return '';
  if (c.tipo === 'bool') return v ? 'Sim' : 'Não';
  if (c.tipo === 'select' && c.opcoes) return c.opcoes.find((o) => o.valor === v)?.rotulo ?? v;
  return String(v);
}

/** Campo "preenchido": zero e falso contam como vazio (é o que o motor ignora). */
function temValor(v) {
  if (v === null || v === undefined || v === '' || v === false) return false;
  if (v === true) return true;
  const n = Number(v);
  return Number.isNaN(n) ? String(v).trim() !== '' : n !== 0;
}

function FormModal({ colunas, inicial, exclusivos = [], erro, onSalvar, onFechar, titulo }) {
  const [obj, setObj] = useState(inicial);
  const campos = colunas.filter((c) => c.noForm !== false && !c.oculto);

  function set(campo, valor) {
    setObj((o) => {
      const novo = { ...o, [campo]: valor };
      // Preencheu um campo de um grupo exclusivo? Os outros do grupo zeram.
      if (temValor(valor)) {
        for (const grupo of exclusivos) {
          if (!grupo.includes(campo)) continue;
          for (const outro of grupo) {
            if (outro === campo) continue;
            // Zera com 0/false, não com vazio: as colunas numéricas do banco
            // costumam ser NOT NULL DEFAULT 0, e `salvar` manda '' como null.
            const tipo = colunas.find((c) => c.campo === outro)?.tipo;
            novo[outro] = tipo === 'bool' ? false : (tipo === 'number' || tipo === 'hora' ? 0 : '');
          }
        }
      }
      return novo;
    });
  }
  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: '85vh', overflow: 'auto' }}>
        <h2>{obj.id ? 'Editar' : 'Novo'} — {titulo}</h2>
        <form onSubmit={(e) => { e.preventDefault(); onSalvar(obj); }}>
          {campos.map((c) => (
            <div className="campo" key={c.campo} style={{ marginBottom: 10 }}>
              <label>{c.rotulo}{c.obrigatorio ? ' *' : ''}</label>
              {c.tipo === 'bool' ? (
                <input type="checkbox" checked={Boolean(obj[c.campo])} onChange={(e) => set(c.campo, e.target.checked)} />
              ) : c.tipo === 'cidade' ? (
                <CidadeBusca
                  valor={obj[c.campo] && obj.uf ? `${obj[c.campo]} - ${obj.uf}` : (obj[c.campo] || obj.cod_ibge || '')}
                  onSelecionar={(mun) => { set(c.campo, mun.nome); set('uf', mun.uf); set('cod_ibge', mun.codigo); }} />
              ) : c.tipo === 'select' ? (
                <select value={obj[c.campo] ?? ''} onChange={(e) => set(c.campo, e.target.value)} required={c.obrigatorio}>
                  <option value="">—</option>
                  {c.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
              ) : (
                <input type={c.tipo === 'number' || c.tipo === 'hora' ? 'number' : 'text'}
                  step={c.tipo === 'hora' ? '0.01' : c.tipo === 'number' ? 'any' : undefined}
                  value={obj[c.campo] ?? ''} onChange={(e) => set(c.campo, e.target.value)} required={c.obrigatorio} />
              )}
              {c.ajuda && <span className="suave" style={{ fontSize: 11 }}>{c.ajuda}</span>}
            </div>
          ))}
          {/* O erro de gravação precisa aparecer AQUI: o modal continua aberto
              quando o salvar falha, e a mensagem lá do card fica escondida
              atrás dele — dava a impressão de que tinha salvado. */}
          {erro && <div className="aviso">{erro}</div>}
          <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="btn-primary">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
