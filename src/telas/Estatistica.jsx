import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { hojeISO, somarDias, fmtDataBR, diferencaEmDias } from '../lib/tempo.js';
import {
  minutosDePermanencia, distribuirNoDia, distribuirPermanencias, resumo, fmtDuracao,
} from '../lib/estatistica.js';
import GraficoBarras from '../componentes/GraficoBarras.jsx';

const TIPOS = {
  entrada: { rotulo: 'Entradas', verbo: 'entradas' },
  saida: { rotulo: 'Saídas', verbo: 'saídas' },
  permanencia: { rotulo: 'Permanência', verbo: 'permanências' },
};
const TAMANHO_PAGINA = 1000;

/** Todos os movimentos do período (o Supabase devolve no máximo 1000 por vez). */
async function buscarMovimentos(tipo, de, ate) {
  const colunaData = tipo === 'entrada' ? 'dt_entrada' : 'dt_saida';
  const colunas = tipo === 'entrada' ? 'id, hr_entrada'
    : tipo === 'saida' ? 'id, hr_saida'
      : 'id, dt_entrada, hr_entrada, dt_saida, hr_saida';
  const linhas = [];
  for (let desde = 0; ; desde += TAMANHO_PAGINA) {
    let q = supabase.from('movimentos').select(colunas)
      .gte(colunaData, de).lte(colunaData, ate).is('excluido_em', null);
    if (tipo !== 'entrada') q = q.not('dt_saida', 'is', null);
    const { data, error } = await q.order('id').range(desde, desde + TAMANHO_PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data || []));
    if (!data || data.length < TAMANHO_PAGINA) return linhas;
  }
}

function Kpi({ rotulo, valor, detalhe }) {
  return (
    <div className="kpi">
      <div className="kpi-rotulo">{rotulo}</div>
      <div className="kpi-valor">{valor}</div>
      {detalhe && <div className="suave" style={{ fontSize: 11 }}>{detalhe}</div>}
    </div>
  );
}

/**
 * Estatística: quantos veículos por faixa de horário (entradas ou saídas,
 * somando todos os dias do período num dia de 24 h) ou por faixa de
 * permanência (0 até a maior). Cálculos em src/lib/estatistica.js.
 */
export default function Estatistica() {
  const [de, setDe] = useState(() => somarDias(hojeISO(), -29));
  const [ate, setAte] = useState(hojeISO);
  const [tipo, setTipo] = useState('entrada');
  const [intervalo, setIntervalo] = useState(30);
  const [dados, setDados] = useState(null); // { tipo, de, ate, valores }
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [verTabela, setVerTabela] = useState(false);
  const pedido = useRef(0);

  // Período ou tipo mudou: busca de novo (o gráfico anterior fica esmaecido
  // até chegar, sem piscar). Intervalo só reagrupa o que já veio.
  useEffect(() => {
    if (!de || !ate || de > ate) return;
    const meu = ++pedido.current;
    setCarregando(true); setErro('');
    buscarMovimentos(tipo, de, ate)
      .then((linhas) => {
        if (meu !== pedido.current) return;
        const valores = tipo === 'entrada' ? linhas.map((l) => Number(l.hr_entrada))
          : tipo === 'saida' ? linhas.map((l) => Number(l.hr_saida))
            : linhas.map((l) => minutosDePermanencia(l.dt_entrada, Number(l.hr_entrada), l.dt_saida, Number(l.hr_saida)));
        setDados({ tipo, de, ate, valores });
      })
      .catch((e) => { if (meu === pedido.current) setErro(e.message); })
      .finally(() => { if (meu === pedido.current) setCarregando(false); });
  }, [tipo, de, ate]);

  const calc = useMemo(() => {
    if (!dados) return null;
    const ehPermanencia = dados.tipo === 'permanencia';
    const faixas = ehPermanencia ? distribuirPermanencias(dados.valores, intervalo) : distribuirNoDia(dados.valores, intervalo);
    return { faixas, r: resumo(faixas, ehPermanencia ? dados.valores : null), ehPermanencia };
  }, [dados, intervalo]);

  const dias = de && ate && de <= ate ? diferencaEmDias(de, ate) + 1 : 0;
  const periodoTxt = dados ? `${fmtDataBR(dados.de)} a ${fmtDataBR(dados.ate)} (${diferencaEmDias(dados.de, dados.ate) + 1} dia(s))` : '';
  const porHora = 60 / intervalo;

  return (
    <>
      <div className="card">
        <h2>Estatística</h2>
        <p className="suave">
          Quantidade de veículos por faixa de horário (entradas ou saídas — todos os dias do período somados
          num dia de 24 h) ou por faixa de permanência. Avulsos e mensalistas; entradas canceladas ficam de fora.
        </p>
        <div className="linha-form" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="campo"><label>De</label><input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} /></div>
          <div className="campo"><label>Até</label><input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} /></div>
          <div className="campo">
            <label>Relatório</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="entrada">Entradas</option>
              <option value="saida">Saídas</option>
              <option value="permanencia">Período (permanência)</option>
            </select>
          </div>
          <div className="campo">
            <label>Intervalo</label>
            <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))}>
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={60}>60 minutos</option>
            </select>
          </div>
          {[7, 30, 90].map((n) => (
            <button key={n} type="button" className="btn-ghost" onClick={() => { setAte(hojeISO()); setDe(somarDias(hojeISO(), -(n - 1))); }}>
              Últimos {n} dias
            </button>
          ))}
        </div>
        {de > ate && <p className="aviso">A data inicial está depois da final.</p>}
        {erro && <p className="aviso">{erro}</p>}
      </div>

      {calc && (
        <div style={{ opacity: carregando ? 0.5 : 1, transition: 'opacity .2s' }}>
          <div className="kpis">
            <Kpi rotulo={`Total de ${TIPOS[dados.tipo].verbo}`} valor={calc.r.total.toLocaleString('pt-BR')} detalhe={periodoTxt} />
            {calc.r.pico && calc.r.pico.quantidade > 0 && (
              <Kpi rotulo={calc.ehPermanencia ? 'Permanência mais comum' : 'Faixa de pico'} valor={calc.r.pico.rotulo}
                detalhe={`${calc.r.pico.quantidade.toLocaleString('pt-BR')} veículo(s)`} />
            )}
            {!calc.ehPermanencia && dias > 0 && (
              <Kpi rotulo="Média por dia" valor={(calc.r.total / (diferencaEmDias(dados.de, dados.ate) + 1)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} />
            )}
            {calc.ehPermanencia && calc.r.media != null && (
              <>
                <Kpi rotulo="Permanência média" valor={fmtDuracao(calc.r.media)} detalhe={`mediana: ${fmtDuracao(calc.r.mediana)}`} />
                <Kpi rotulo="Maior permanência" valor={fmtDuracao(calc.r.maior)} />
              </>
            )}
          </div>

          <div className="card">
            <div className="card-cab">
              <div>
                <h2>
                  {calc.ehPermanencia ? `Permanência em faixas de ${intervalo} min` : `${TIPOS[dados.tipo].rotulo} por faixa de ${intervalo} min`}
                </h2>
                <p className="suave">
                  {calc.ehPermanencia ? 'Quantos veículos ficaram cada tempo (saídas no período)' : 'Todos os dias do período somados'} — {periodoTxt}
                </p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setVerTabela((v) => !v)}>
                {verTabela ? 'Ver gráfico' : 'Ver como tabela'}
              </button>
            </div>
            {calc.r.total === 0 ? (
              <p className="suave">Nenhum veículo no período.</p>
            ) : verTabela ? (
              <div className="tabela-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>{calc.ehPermanencia ? 'Permanência' : 'Horário'}</th><th style={{ textAlign: 'right' }}>Veículos</th></tr></thead>
                  <tbody>
                    {calc.faixas.filter((f) => !calc.ehPermanencia || f.quantidade > 0).map((f) => (
                      <tr key={f.inicio}>
                        <td>{f.rotulo}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{f.quantidade.toLocaleString('pt-BR')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <GraficoBarras
                faixas={calc.faixas}
                unidade="veículo(s)"
                passoRotulo={porHora}
                textoEixo={(f) => (calc.ehPermanencia ? fmtDuracao(f.inicio) : `${String(f.inicio / 60).padStart(2, '0')}h`)}
                descricao={`${calc.ehPermanencia ? 'Permanência' : TIPOS[dados.tipo].rotulo} por faixa de ${intervalo} minutos, ${periodoTxt}. Total ${calc.r.total}.`}
              />
            )}
            {!verTabela && calc.r.total > 0 && (
              <p className="suave" style={{ fontSize: 11, marginTop: 4 }}>
                Passe o mouse (ou use as setas do teclado) numa coluna pra ver a quantidade.
                {calc.ehPermanencia && calc.faixas.length * 6 > 900 && ' Role para o lado pra ver as permanências mais longas.'}
              </p>
            )}
          </div>
        </div>
      )}
      {!calc && carregando && <div className="card suave">Carregando…</div>}
    </>
  );
}
