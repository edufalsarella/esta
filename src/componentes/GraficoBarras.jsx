import { useEffect, useRef, useState } from 'react';

// Gráfico de colunas de uma série só (SVG, sem biblioteca). Specs do guia de
// dataviz: coluna <= 24px com 2px de folga entre vizinhas, ponta superior
// arredondada (4px) e base reta, grade em linha fina sólida, número só no
// pico, tooltip por coluna (mouse e setas do teclado). Muitas faixas: rolagem
// horizontal em vez de colunas finas demais.

const MARGEM = { esq: 44, dir: 12, topo: 24, base: 30 };
const ALTURA_PLOT = 240;
const LARGURA_MIN_FAIXA = 6; // px por faixa, antes de rolar
const ESPACO_MIN_ROTULO = 46; // px entre rótulos do eixo X

/** Teto "redondo" do eixo Y e os ticks (0, 5, 10…). */
function escalaY(maximo) {
  if (maximo <= 0) return { teto: 1, ticks: [0, 1] };
  const bruto = maximo / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 5, 10].map((k) => k * potencia).find((p) => p >= bruto);
  const teto = Math.ceil(maximo / passo) * passo;
  const ticks = [];
  for (let v = 0; v <= teto + 1e-9; v += passo) ticks.push(Math.round(v * 1e6) / 1e6);
  return { teto, ticks };
}

/** Coluna com 4px arredondados em cima e base reta. */
function caminhoColuna(x, y, largura, altura) {
  if (altura <= 0) return '';
  const r = Math.min(4, largura / 2, altura);
  const base = y + altura;
  return `M${x},${base} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + largura - r},${y} `
    + `Q${x + largura},${y} ${x + largura},${y + r} L${x + largura},${base} Z`;
}

/**
 * faixas: [{ rotulo, quantidade }]. textoEixo(faixa, i): rótulo curto do eixo X
 * (ex.: "08h"). passoRotulo: de quantas em quantas faixas cabe um rótulo
 * "natural" (ex.: 4 faixas de 15 min = 1 hora). unidade: "veículos".
 */
export default function GraficoBarras({ faixas, textoEixo, passoRotulo = 1, unidade = 'veículos', descricao }) {
  const caixaRef = useRef(null);
  const [larguraCaixa, setLarguraCaixa] = useState(640);
  const [ativa, setAtiva] = useState(null); // índice da coluna com tooltip

  useEffect(() => {
    if (!caixaRef.current) return undefined;
    const obs = new ResizeObserver(([e]) => setLarguraCaixa(e.contentRect.width));
    obs.observe(caixaRef.current);
    return () => obs.disconnect();
  }, []);

  const n = faixas.length;
  const larguraFaixa = Math.max((larguraCaixa - MARGEM.esq - MARGEM.dir) / Math.max(n, 1), LARGURA_MIN_FAIXA);
  const larguraPlot = larguraFaixa * n;
  const larguraSvg = MARGEM.esq + larguraPlot + MARGEM.dir;
  const larguraColuna = Math.max(Math.min(24, larguraFaixa - 2), 1);
  const maximo = Math.max(0, ...faixas.map((f) => f.quantidade));
  const { teto, ticks } = escalaY(maximo);
  const yDe = (v) => MARGEM.topo + ALTURA_PLOT - (v / teto) * ALTURA_PLOT;
  const xDaFaixa = (i) => MARGEM.esq + i * larguraFaixa;
  const iPico = maximo > 0 ? faixas.findIndex((f) => f.quantidade === maximo) : -1;
  // Rótulos do eixo X: múltiplos do passo natural, espaçados o bastante.
  const passo = passoRotulo * Math.max(1, Math.ceil(ESPACO_MIN_ROTULO / (larguraFaixa * passoRotulo)));

  function teclado(e) {
    if (!n) return;
    const atual = ativa ?? (iPico >= 0 ? iPico : 0);
    if (e.key === 'ArrowRight') { e.preventDefault(); setAtiva(Math.min(n - 1, atual + 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setAtiva(Math.max(0, atual - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setAtiva(0); }
    else if (e.key === 'End') { e.preventDefault(); setAtiva(n - 1); }
  }

  const fAtiva = ativa != null ? faixas[ativa] : null;
  const xTooltip = ativa != null ? xDaFaixa(ativa) + larguraFaixa / 2 : 0;

  return (
    <div ref={caixaRef} style={{ position: 'relative', overflowX: 'auto', overflowY: 'hidden' }}>
      <svg width={larguraSvg} height={MARGEM.topo + ALTURA_PLOT + MARGEM.base} role="img" aria-label={descricao}
        tabIndex={0} onKeyDown={teclado} onFocus={() => setAtiva((a) => a ?? (iPico >= 0 ? iPico : 0))}
        onBlur={() => setAtiva(null)} onPointerLeave={() => setAtiva(null)} style={{ display: 'block', outline: 'none' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={MARGEM.esq} x2={MARGEM.esq + larguraPlot} y1={yDe(t)} y2={yDe(t)} stroke="var(--linha)" strokeWidth="1" shapeRendering="crispEdges" />
            <text x={MARGEM.esq - 6} y={yDe(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--suave)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t.toLocaleString('pt-BR')}
            </text>
          </g>
        ))}
        {faixas.map((f, i) => {
          const y = yDe(f.quantidade);
          const x = xDaFaixa(i) + (larguraFaixa - larguraColuna) / 2;
          return (
            <g key={i}>
              <path d={caminhoColuna(x, y, larguraColuna, MARGEM.topo + ALTURA_PLOT - y)} fill="var(--grafico-barra)"
                style={ativa === i ? { filter: 'brightness(1.25)' } : undefined} />
              {i % passo === 0 && (
                <text x={xDaFaixa(i) + larguraFaixa / 2} y={MARGEM.topo + ALTURA_PLOT + 16} textAnchor="middle" fontSize="11" fill="var(--suave)">
                  {textoEixo(f, i)}
                </text>
              )}
              {/* Alvo do mouse: a faixa inteira, mais alta e larga que a coluna. */}
              <rect x={xDaFaixa(i)} y={MARGEM.topo} width={larguraFaixa} height={ALTURA_PLOT} fill="transparent"
                onPointerEnter={() => setAtiva(i)} onPointerMove={() => setAtiva(i)} />
            </g>
          );
        })}
        {iPico >= 0 && (
          <text x={xDaFaixa(iPico) + larguraFaixa / 2} y={yDe(maximo) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--texto)">
            {maximo.toLocaleString('pt-BR')}
          </text>
        )}
      </svg>
      {fAtiva && (
        <div role="status" style={{
          position: 'absolute', top: 4, left: Math.min(Math.max(xTooltip - 70, 0), Math.max(larguraSvg - 150, 0)),
          width: 150, pointerEvents: 'none', background: 'var(--panel2)', border: '1px solid var(--linha)',
          borderRadius: 6, padding: '6px 8px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.25)',
        }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{fAtiva.quantidade.toLocaleString('pt-BR')} {unidade}</div>
          <div className="suave">{fAtiva.rotulo}</div>
        </div>
      )}
    </div>
  );
}
