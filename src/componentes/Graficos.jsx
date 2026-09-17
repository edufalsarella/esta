import { useState } from 'react';

// Gráficos leves, sem biblioteca nenhuma — SVG puro pra tendência (linha) e
// divs simples pra comparação de categorias (barra), nas mesmas variáveis de
// cor do app (var(--ambar) etc., ver styles.css) — acompanham tema claro/escuro
// sozinhos, sem precisar de paleta própria (é sempre UMA série, nunca várias
// categorias coloridas juntas — não precisa de paleta categórica nem do
// validador de contraste, só serve pra isso).

/** Primeiro "passo" redondo (1/2/5×10ⁿ) maior ou igual a `n` — pros rótulos do eixo Y baterem em número limpo. */
function passoRedondo(n) {
  if (n <= 0) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const frac = n / exp;
  const passo = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return passo * exp;
}

/**
 * Linha + área — tendência de UMA série ao longo do tempo (ex.: faturado por
 * dia). `pontos`: [{ rotulo, valor }], já na ordem do eixo X.
 */
export function GraficoLinha({ pontos, formatarValor = (v) => String(v), formatarEixoX = (p) => p.rotulo }) {
  const [hover, setHover] = useState(null);
  if (!pontos?.length) return null;

  const W = 640, H = 200, PAD_L = 46, PAD_R = 10, PAD_T = 14, PAD_B = 24;
  const largura = W - PAD_L - PAD_R, altura = H - PAD_T - PAD_B;
  const maiorValor = Math.max(...pontos.map((p) => p.valor), 0);
  const maxEixo = passoRedondo(maiorValor * 1.15 || 10);
  const x = (i) => PAD_L + (pontos.length > 1 ? (i / (pontos.length - 1)) * largura : largura / 2);
  const y = (v) => PAD_T + altura - (maxEixo ? (v / maxEixo) * altura : 0);

  const linha = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.valor).toFixed(1)}`).join(' ');
  const area = `${linha} L ${x(pontos.length - 1).toFixed(1)} ${(PAD_T + altura).toFixed(1)}`
    + ` L ${x(0).toFixed(1)} ${(PAD_T + altura).toFixed(1)} Z`;

  // Só alguns rótulos no eixo X quando tem muito ponto (ex.: 31 dias) — senão empilha texto ilegível.
  const passoRotulo = Math.max(1, Math.ceil(pontos.length / 8));
  const ultimo = pontos.length - 1;

  function aoMover(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let idx = pontos.length > 1 ? Math.round(((px - PAD_L) / largura) * ultimo) : 0;
    idx = Math.max(0, Math.min(ultimo, idx));
    setHover(idx);
  }

  return (
    <div className="grafico-linha-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="grafico-svg" preserveAspectRatio="none"
        onMouseMove={aoMover} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD_L} x2={W - PAD_R} y1={(PAD_T + altura * (1 - f)).toFixed(1)} y2={(PAD_T + altura * (1 - f)).toFixed(1)} className="grafico-grade" />
            <text x={PAD_L - 8} y={(PAD_T + altura * (1 - f)).toFixed(1)} textAnchor="end" dominantBaseline="middle" className="grafico-eixo-texto">
              {formatarValor(maxEixo * f)}
            </text>
          </g>
        ))}
        {pontos.map((p, i) => (i % passoRotulo === 0 || i === ultimo) && (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="grafico-eixo-texto">{formatarEixoX(p)}</text>
        ))}
        <path d={area} className="grafico-area" />
        <path d={linha} className="grafico-linha" />
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + altura} className="grafico-crosshair" />
        )}
        {pontos.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.valor)} r={i === hover ? 5 : i === ultimo ? 4 : 0}
            className={i === hover ? 'grafico-ponto' : 'grafico-ponto-fim'} />
        ))}
        {/* Área invisível por cima de tudo, só pra capturar o hover — precisa
            vir depois das outras marcas no DOM pra "ganhar" o ponteiro. */}
        <rect x={PAD_L} y={PAD_T} width={largura} height={altura} fill="transparent"
          onMouseMove={aoMover} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="grafico-tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{formatarValor(pontos[hover].valor)}</strong>
          <span>{formatarEixoX(pontos[hover])}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Barras horizontais — comparação de magnitude entre poucas categorias (ex.:
 * faturado por operador). `itens`: [{ rotulo, valor }], já ordenado por quem chamou.
 */
export function GraficoBarras({ itens, formatarValor = (v) => String(v) }) {
  if (!itens?.length) return null;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return (
    <div className="grafico-barras">
      {itens.map((it) => (
        <div className="grafico-barra-linha" key={it.rotulo}>
          <span className="grafico-barra-rotulo">{it.rotulo}</span>
          <div className="grafico-barra-trilha">
            <div className="grafico-barra-fill" style={{ width: `${Math.max(2, (it.valor / max) * 100)}%` }} />
          </div>
          <span className="grafico-barra-valor">{formatarValor(it.valor)}</span>
        </div>
      ))}
    </div>
  );
}
