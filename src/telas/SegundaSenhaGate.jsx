import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Liberado nesta aba (sobrevive a um F5, não a uma aba nova nem ao "Sair").
const CHAVE = 'esta.fornecedor2aSenha';

function liberadoNestaAba(userId) {
  try { return sessionStorage.getItem(CHAVE) === userId; } catch { return false; }
}

/** Esquece a liberação — chamado no logout (ver App.jsx). */
export function esquecerSegundaSenha() {
  try { sessionStorage.removeItem(CHAVE); } catch { /* sem storage: nada a limpar */ }
}

/**
 * Segunda senha do fornecedor, pedida depois do login normal e antes de
 * escolher a filial. A conferência é no banco (hash bcrypt, ver
 * supabase/migrations/0062_fornecedor_segunda_senha.sql) — a senha não fica
 * no código do app.
 */
export default function SegundaSenhaGate({ userId, children }) {
  const [liberado, setLiberado] = useState(() => liberadoNestaAba(userId));
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  if (liberado) return children;

  async function confirmar(e) {
    e.preventDefault();
    setOcupado(true); setErro('');
    const { data, error } = await supabase.rpc('conferir_segunda_senha_fornecedor', { senha });
    setOcupado(false);
    if (error) { setErro(`Não deu pra conferir a senha: ${error.message}`); return; }
    if (!data) { setErro('Senha incorreta.'); setSenha(''); return; }
    try { sessionStorage.setItem(CHAVE, userId); } catch { /* sem storage: pede de novo no próximo F5 */ }
    setLiberado(true);
  }

  return (
    <div className="centro">
      <form className="card" style={{ width: 360 }} onSubmit={confirmar} autoComplete="off">
        <h2>Segunda senha</h2>
        <p className="suave">Acesso de fornecedor: digite a segunda senha para continuar.</p>
        <div className="campo" style={{ margin: '16px 0' }}>
          <label>Senha</label>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
            autoFocus autoComplete="off" />
        </div>
        {erro && <p className="aviso">{erro}</p>}
        <button className="btn-primary" style={{ width: '100%' }} disabled={ocupado || !senha}>
          {ocupado ? '…' : 'Entrar'}
        </button>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button type="button" className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </form>
    </div>
  );
}
