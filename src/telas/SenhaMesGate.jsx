import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

/**
 * Trava o login inteiro (filial atual) até bater a "senha do mês" — ver
 * supabase/migrations/0026_senha_mes.sql e api/conferir-senha-mes.js. O
 * cálculo roda só no servidor; aqui só chama a function e mostra o
 * resultado. Fornecedor nunca passa por aqui (ver App.jsx).
 */
export default function SenhaMesGate({ children }) {
  const [estado, setEstado] = useState('carregando'); // carregando | liberado | bloqueado
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [numeroCliente, setNumeroCliente] = useState(null);

  async function conferir(senhaDigitada) {
    const { data: sessao } = await supabase.auth.getSession();
    const resp = await fetch('/api/conferir-senha-mes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session?.access_token}` },
      body: JSON.stringify(senhaDigitada ? { senhaDigitada } : {}),
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) { setErro(dados.erro || 'Não deu pra conferir a senha do mês.'); setEstado('bloqueado'); return; }
    if (dados.liberado) { setEstado('liberado'); return; }
    setErro(dados.erro || '');
    // Pra quem ficou travado aqui poder ligar/mandar mensagem pro fornecedor
    // já sabendo de cabeça o código do cliente (ver conferir-senha-mes.js).
    setNumeroCliente(dados.numeroCliente || null);
    setEstado('bloqueado');
  }

  useEffect(() => { conferir(); }, []);

  async function confirmar(e) {
    e.preventDefault();
    setOcupado(true); setErro('');
    await conferir(senha);
    setOcupado(false);
  }

  if (estado === 'carregando') return <div className="centro">Carregando…</div>;
  if (estado === 'liberado') return children;

  return (
    <div className="centro">
      <form className="card" style={{ width: 360 }} onSubmit={confirmar}>
        <h2>
          Senha do mês
          {numeroCliente && <span className="suave" style={{ fontWeight: 400 }}> — Cliente Nº {numeroCliente}</span>}
        </h2>
        <p className="suave">
          Digite a senha do mês que você recebeu — sem ela o sistema não libera. Ligando pro
          fornecedor pra pedir, informe o número do cliente acima.
        </p>
        <div className="campo" style={{ margin: '16px 0' }}>
          <label>Senha do Mês</label>
          <input
            value={senha}
            onChange={(e) => setSenha(e.target.value.toUpperCase())}
            maxLength={5}
            autoFocus
            style={{ textTransform: 'uppercase', letterSpacing: 2 }}
          />
        </div>
        {erro && <p className="aviso">{erro}</p>}
        <button className="btn-primary" style={{ width: '100%' }} disabled={ocupado || !senha}>
          {ocupado ? '…' : 'Confirmar'}
        </button>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button type="button" className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </form>
    </div>
  );
}
