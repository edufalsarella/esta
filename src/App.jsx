import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase, configurado } from './lib/supabase.js';
import Layout from './componentes/Layout.jsx';
import Patio from './telas/Patio.jsx';
import Caixa from './telas/Caixa.jsx';
import BI from './telas/BI.jsx';
import RelatorioConvenios from './telas/RelatorioConvenios.jsx';
import Reservas from './telas/Reservas.jsx';
import Precos from './telas/Precos.jsx';
import { Convenios, Formas, Vagas, Produtos, Modelos, Servicos, Bonus } from './telas/cadastros.jsx';
import Mensalistas from './telas/Mensalistas.jsx';
import { Receber, Pagar, Banco } from './telas/financeiro.jsx';
import Fiscal from './telas/Fiscal.jsx';
import Configuracoes from './telas/Configuracoes.jsx';
import Usuarios from './telas/Usuarios.jsx';
import ImportarDbf from './telas/ImportarDbf.jsx';
import ModelosTicket from './telas/ModelosTicket.jsx';
import Sobre from './telas/Sobre.jsx';

// Só é baixada quando alguém abre a Ajuda — não pesa nas outras telas.
const Ajuda = lazy(() => import('./telas/Ajuda.jsx'));
import PainelFornecedor from './telas/PainelFornecedor.jsx';
import EscolherFilial from './telas/EscolherFilial.jsx';
import SenhaMesGate from './telas/SenhaMesGate.jsx';
import SessoesGate from './telas/SessoesGate.jsx';
import { ehFornecedor } from './lib/acesso.js';

export default function App() {
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!configurado) { setCarregando(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSessao(data.session); setCarregando(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessao) { setPerfil(null); return; }
    // `filial_id` do perfil passa a significar "filial que estou operando": pro
    // fornecedor é a que ele escolheu, pros demais é a própria. Assim todas as
    // telas continuam usando `perfil.filial_id` sem saber que isso existe.
    supabase.from('perfis').select('*').eq('id', sessao.user.id).maybeSingle()
      .then(({ data }) => setPerfil(data && {
        ...data,
        filial_id: data.filial_ativa || data.filial_id,
        filial_propria: data.filial_id,
      }));
  }, [sessao]);

  if (!configurado) return <ConfigPendente />;
  if (carregando) return <div className="centro">Carregando…</div>;
  if (!sessao) return <Login />;
  if (!perfil) return (
    <div className="centro"><div className="card aviso" style={{ maxWidth: 520 }}>
      Usuário autenticado, mas sem <strong>perfil</strong> vinculado a uma filial.
      Crie um registro em <code>perfis</code> (id = id do usuário, filial_id da filial).
      <div style={{ marginTop: 12 }}><button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sair</button></div>
    </div></div>
  );
  if (!perfil.ativo) return (
    <div className="centro"><div className="card aviso" style={{ maxWidth: 520 }}>
      Este usuário está <strong>desativado</strong>. Fale com um supervisor para reativar.
      <div style={{ marginTop: 12 }}><button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sair</button></div>
    </div></div>
  );

  // Fornecedor atende vários clientes: escolhe qual acessar antes de entrar.
  if (ehFornecedor(perfil) && !perfil.filial_ativa) return <EscolherFilial perfil={perfil} />;

  // Trava o login até bater a senha do mês (ver SenhaMesGate.jsx) — exceto
  // pro fornecedor: ele é quem controla esse mecanismo, não pode ficar
  // trancado fora de uma filial inadimplente e sem conseguir nem ajudar o
  // cliente a resolver.
  if (!ehFornecedor(perfil)) {
    return <SenhaMesGate><SessoesGate><Rotas perfil={perfil} /></SessoesGate></SenhaMesGate>;
  }
  return <Rotas perfil={perfil} />;
}

function Rotas({ perfil }) {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout perfil={perfil} />}>
          <Route index element={<Patio perfil={perfil} />} />
          <Route path="caixa" element={<Caixa perfil={perfil} />} />
          <Route path="bi" element={<BI perfil={perfil} />} />
          <Route path="relatorio-convenios" element={<RelatorioConvenios perfil={perfil} />} />
          <Route path="reservas" element={<Reservas perfil={perfil} />} />
          <Route path="precos" element={<Precos perfil={perfil} />} />
          <Route path="convenios" element={<Convenios perfil={perfil} />} />
          <Route path="mensalistas" element={<Mensalistas perfil={perfil} />} />
          <Route path="formas" element={<Formas perfil={perfil} />} />
          <Route path="vagas" element={<Vagas perfil={perfil} />} />
          <Route path="produtos" element={<Produtos perfil={perfil} />} />
          <Route path="modelos" element={<Modelos perfil={perfil} />} />
          <Route path="servicos" element={<Servicos perfil={perfil} />} />
          <Route path="bonus" element={<Bonus perfil={perfil} />} />
          <Route path="receber" element={<Receber perfil={perfil} />} />
          <Route path="pagar" element={<Pagar perfil={perfil} />} />
          <Route path="banco" element={<Banco perfil={perfil} />} />
          <Route path="fiscal" element={<Fiscal perfil={perfil} />} />
          <Route path="configuracoes" element={<Configuracoes perfil={perfil} />} />
          <Route path="usuarios" element={<Usuarios perfil={perfil} />} />
          <Route path="modelos-ticket" element={<ModelosTicket perfil={perfil} />} />
          <Route path="importar" element={<ImportarDbf perfil={perfil} />} />
          <Route path="ajuda" element={<Suspense fallback={<div className="card suave">Carregando a ajuda…</div>}><Ajuda perfil={perfil} /></Suspense>} />
          <Route path="sobre" element={<Sobre />} />
          {/* Fornecedor-only: não existe em acesso.js um terceiro nível pra
              isso (supervisor e fornecedor têm rotasDoPapel === null, sem
              restrição), então o gate é direto aqui, igual EscolherFilial. */}
          <Route path="painel-fornecedor" element={ehFornecedor(perfil) ? <PainelFornecedor perfil={perfil} /> : <Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function entrar(e) {
    e.preventDefault(); setErro(''); setOcupado(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) { setErro(error.message); setOcupado(false); return; }
    // Contador do Painel de uso (ver 0033_painel_uso.sql) — best-effort,
    // uma falha aqui não pode travar o login de ninguém. `.rpc()` não
    // rejeita em erro do servidor (só resolve com `error` preenchido) — só
    // um `.catch()` deixaria isso passar em silêncio, sem aparecer nem no
    // console.
    supabase.rpc('registrar_acesso')
      .then(({ error }) => { if (error) console.error('registrar_acesso:', error.message); })
      .catch((e) => console.error('registrar_acesso:', e.message));
    setOcupado(false);
  }
  return (
    <div className="centro">
      {/* autoComplete="off": ajuda em navegadores que respeitam a flag
          (Firefox), mas Chrome/Edge ignoram isso de propósito em campo de
          senha desde 2014 — é assim que impedem um site de desligar o
          gerenciador de senhas do usuário. Pra login em máquina de
          terceiro (ex.: computador de cliente), o que resolve de verdade
          é abrir o app numa janela anônima (Ctrl+Shift+N): aí o Chrome
          nem oferece salvar, e nada fica gravado depois de fechar. */}
      <form className="card" style={{ width: 360 }} onSubmit={entrar} autoComplete="off">
        <h2>Entrar</h2>
        <div className="campo" style={{ marginBottom: 10 }}>
          <label>E-mail</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" />
        </div>
        <div className="campo" style={{ marginBottom: 16 }}>
          <label>Senha</label>
          <input value={senha} onChange={(e) => setSenha(e.target.value)} type="password" autoComplete="off" />
        </div>
        {erro && <p className="aviso">{erro}</p>}
        <button className="btn-primary" style={{ width: '100%' }} disabled={ocupado}>{ocupado ? '…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function ConfigPendente() {
  return (
    <div className="centro">
      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Configuração pendente</h2>
        <p>Defina as variáveis do Supabase em <code>.env.local</code> (copie de <code>.env.example</code>):</p>
        <pre className="mono">VITE_SUPABASE_URL=…{'\n'}VITE_SUPABASE_ANON_KEY=…</pre>
        <p className="suave">Depois reinicie o <code>npm run dev</code>.</p>
      </div>
    </div>
  );
}
