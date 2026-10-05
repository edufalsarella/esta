import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TOPICOS } from '../ajuda/topicos.js';
import { normalizar } from '../lib/texto.js';
import { podeAcessar } from '../lib/acesso.js';

const textoDaSecao = (s) => [s.titulo, ...(s.texto || []), ...(s.itens || [])].join(' ');

/**
 * Ajuda: um tópico por tela (src/ajuda/topicos.js), com busca. Carregada sob
 * demanda (React.lazy em App.jsx) — não pesa nas outras telas.
 */
export default function Ajuda({ perfil }) {
  const [busca, setBusca] = useState('');

  const resultado = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    if (!termos.length) return TOPICOS;
    const casa = (texto) => { const t = normalizar(texto); return termos.every((termo) => t.includes(termo)); };
    return TOPICOS
      .map((t) => {
        const tituloCasa = casa(`${t.titulo} ${t.resumo}`);
        const secoes = tituloCasa ? t.secoes : t.secoes.filter((s) => casa(textoDaSecao(s)));
        return secoes.length ? { ...t, secoes } : null;
      })
      .filter(Boolean);
  }, [busca]);

  return (
    <>
      <div className="card">
        <h2>Ajuda</h2>
        <p className="suave">Como funciona cada tela. Digite uma palavra pra achar o assunto (ex.: "sangria", "CEP", "UniNFe").</p>
        <div className="campo" style={{ maxWidth: 420 }}>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na ajuda…" autoFocus />
        </div>
        {!busca && (
          <div className="linha-form" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {TOPICOS.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="btn-ghost" style={{ textDecoration: 'none' }}>{t.titulo}</a>
            ))}
          </div>
        )}
        {busca && resultado.length === 0 && <p className="suave">Nada encontrado para "{busca}".</p>}
      </div>

      {resultado.map((t) => (
        <div className="card" key={t.id} id={t.id}>
          <div className="card-cab">
            <div>
              <h2>{t.titulo}</h2>
              <p className="suave">{t.resumo}</p>
            </div>
            {t.rota && podeAcessar(perfil, t.rota) && (
              <Link to={t.rota} className="btn-ghost" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>Abrir a tela</Link>
            )}
          </div>
          {t.secoes.map((s) => (
            <div key={s.titulo} style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 4 }}>{s.titulo}</h3>
              {(s.texto || []).map((p, i) => <p key={i} style={{ margin: '4px 0' }}>{p}</p>)}
              {s.itens?.length > 0 && (
                <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                  {s.itens.map((item, i) => <li key={i} style={{ margin: '2px 0' }}>{item}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
