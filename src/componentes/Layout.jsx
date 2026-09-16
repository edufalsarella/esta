import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { PAPEIS, podeAcessar, ehFornecedor, ehSupervisor, nfseAtivo as calcularNfseAtivo } from '../lib/acesso.js';
import { trocarFilialAtiva } from '../telas/EscolherFilial.jsx';
import { imprimePedidosDaCabine } from '../lib/preferenciasNavegador.js';
import { liberarSessao } from '../telas/SessoesGate.jsx';
import { imprimirTicket } from './Ticket.jsx';

const INTERVALO_VERIFICACAO_MS = 4000;

const GRUPOS = [
  { titulo: 'Operação', itens: [
    { to: '/', rotulo: 'Pátio', fim: true },
    { to: '/caixa', rotulo: 'Caixa' },
    { to: '/bi', rotulo: 'BI / Painel' },
    { to: '/relatorio-convenios', rotulo: 'Relatório de convênios' },
    { to: '/reservas', rotulo: 'Reservas de vaga' },
  ]},
  { titulo: 'Cadastros', itens: [
    { to: '/precos', rotulo: 'Tabelas de preço' },
    { to: '/convenios', rotulo: 'Convênios' },
    { to: '/mensalistas', rotulo: 'Mensalistas' },
    { to: '/formas', rotulo: 'Formas de pagamento' },
    { to: '/vagas', rotulo: 'Vagas/boxes' },
    { to: '/produtos', rotulo: 'Produtos' },
    { to: '/modelos', rotulo: 'Modelos' },
    { to: '/servicos', rotulo: 'Serviços' },
    { to: '/bonus', rotulo: 'Faixas de bônus' },
    { to: '/importar', rotulo: 'Importar do legado (.dbf)' },
  ]},
  { titulo: 'Fiscal', itens: [
    { to: '/fiscal', rotulo: 'NFS-e / RPS/DPS' },
  ]},
  { titulo: 'Configurações', itens: [
    { to: '/configuracoes', rotulo: 'Dados do estacionamento' },
    { to: '/usuarios', rotulo: 'Usuários' },
    { to: '/modelos-ticket', rotulo: 'Modelos de ticket' },
  ]},
  { titulo: 'Sobre', itens: [
    { to: '/sobre', rotulo: 'Sobre' },
  ]},
];

/** Número do cliente (Configurações → Dados do estacionamento) antes do nome. */
function rotuloFilial(f) {
  const nome = f?.nome_fantasia || f?.razao_social || '';
  return f?.numero_cliente ? `${f.numero_cliente} · ${nome}` : nome;
}

export default function Layout({ perfil }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [nomeFilial, setNomeFilial] = useState('');
  const [filiais, setFiliais] = useState([]); // só o fornecedor tem mais de uma
  const [avisoLimpeza, setAvisoLimpeza] = useState(null); // {elegiveis} ou null
  const [nfseAtivo, setNfseAtivo] = useState(true); // Fiscal > Configurações → "habilitada pela prefeitura?"
  const location = useLocation();

  // Avisa a cada login (só quem pode agir: supervisor/fornecedor) que tem
  // lançamento antigo esperando exclusão — ver Configurações → Limpeza de
  // lançamentos antigos e 0047_limpeza_lancamentos_antigos.sql. Uma vez por
  // carregamento do app é suficiente, não precisa repetir em loop.
  useEffect(() => {
    if (!ehSupervisor(perfil)) return;
    supabase.rpc('contar_lancamentos_antigos').single()
      .then(({ data }) => { if (data?.elegiveis > 0) setAvisoLimpeza(data); })
      .catch(() => {});
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    // Fornecedor enxerga todas as filiais (é o que alimenta o seletor); os
    // demais enxergam só a própria, então o maybeSingle continua valendo.
    if (ehFornecedor(perfil)) {
      supabase.from('filiais').select('id, nome_fantasia, razao_social, numero_cliente, config').order('razao_social')
        .then(({ data }) => {
          setFiliais(data || []);
          const atual = (data || []).find((f) => f.id === perfil.filial_ativa);
          setNomeFilial(atual ? rotuloFilial(atual) : '');
          setNfseAtivo(calcularNfseAtivo(atual));
        });
      return;
    }
    supabase.from('filiais').select('nome_fantasia, numero_cliente, config').maybeSingle()
      .then(({ data }) => {
        setNomeFilial(data ? rotuloFilial(data) : '');
        setNfseAtivo(calcularNfseAtivo(data));
      });
  }, [perfil]);

  /**
   * Pedidos de impressão vindos do celular (ver Ticket.jsx e
   * supabase/migrations/0023_print_jobs.sql). Só roda quando este navegador
   * marcou "imprime pedidos da cabine" em Configurações — normalmente só o
   * navegador kiosk fixo da cabine (ver docs/CABINE.md). Reaproveita o mesmo
   * imprimirTicket() que já imprime silencioso ali, nenhuma lógica nova de
   * impressão.
   */
  useEffect(() => {
    if (!imprimePedidosDaCabine()) return;
    let cancelado = false;
    let filial = null;

    async function verificar() {
      if (!filial) {
        const { data } = await supabase.from('filiais').select('nome_fantasia, endereco, cnpj')
          .eq('id', perfil.filial_id).maybeSingle();
        filial = data;
      }
      const { data: pendentes } = await supabase.from('print_jobs').select('*')
        .eq('filial_id', perfil.filial_id).eq('status', 'pendente').order('criado_em');
      for (const job of pendentes || []) {
        if (cancelado) return;
        // Reivindica antes de imprimir (update condicional): se por engano
        // duas abas tiverem a flag ligada, só uma imprime cada pedido.
        const { data: reivindicado } = await supabase.from('print_jobs')
          .update({ status: 'impresso', impresso_em: new Date().toISOString() })
          .eq('id', job.id).eq('status', 'pendente').select().maybeSingle();
        if (!reivindicado) continue;
        try {
          // `avisar: false`: um alert aqui travaria a fila esperando alguém
          // fechar — na cabine ninguém está olhando a tela. O retorno `false`
          // (pop-up bloqueado) precisa virar erro no pedido: antes o job era
          // dado como impresso e o papel nunca saía, sem deixar rastro.
          const imprimiu = imprimirTicket(job.ticket, filial, { avisar: false });
          if (!imprimiu) {
            await supabase.from('print_jobs').update({
              status: 'erro',
              erro: 'Navegador bloqueou a janela de impressão. Abra a cabine pelo pdv-cabine.bat (ou pdv-cabine-edge.bat), que já libera pop-up.',
            }).eq('id', job.id);
          }
        } catch (e) {
          await supabase.from('print_jobs').update({ status: 'erro', erro: e.message }).eq('id', job.id);
        }
      }
    }

    verificar();
    const id = setInterval(verificar, INTERVALO_VERIFICACAO_MS);
    return () => { cancelado = true; clearInterval(id); };
  }, [perfil.filial_id]);

  if (!podeAcessar(perfil, location.pathname)) {
    return <Navigate to="/" replace />;
  }

  const grupos = GRUPOS
    .map((g) => ({
      ...g,
      itens: g.itens.filter((i) => podeAcessar(perfil, i.to) && (i.to !== '/fiscal' || nfseAtivo)),
    }))
    .filter((g) => g.itens.length > 0);
  // Fornecedor-only: acesso.js não distingue supervisor de fornecedor (os
  // dois têm rotasDoPapel === null), então não dá pra colocar isso no
  // GRUPOS estático acima — entra à parte, só quando é o fornecedor.
  if (ehFornecedor(perfil)) {
    grupos.push({ titulo: 'Fornecedor', itens: [{ to: '/painel-fornecedor', rotulo: 'Painel de uso' }] });
  }

  return (
    <div className="app">
      <aside className={'lateral' + (menuAberto ? ' aberto' : '')}>
        <div className="marca">SisParkWeb <span className="ambar">·PDV</span></div>
        {grupos.map((g) => (
          <div key={g.titulo} className="nav-grupo">
            <div className="nav-titulo">{g.titulo}</div>
            {g.itens.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.fim}
                onClick={() => setMenuAberto(false)}
                className={({ isActive }) => 'nav-item' + (isActive ? ' ativo' : '')}>
                {i.rotulo}
              </NavLink>
            ))}
          </div>
        ))}
      </aside>
      {menuAberto && <div className="menu-fundo" onClick={() => setMenuAberto(false)} />}
      <main className="conteudo">
        {/* Pro fornecedor o nome do cliente vira seletor: é a informação mais
            importante da tela, já que ele opera vários estacionamentos. */}
        {ehFornecedor(perfil) ? (
          <div className="topo-filial">
            <select value={perfil.filial_ativa || ''} style={{ padding: '2px 8px', fontSize: 'inherit' }}
              onChange={(e) => trocarFilialAtiva(perfil.id, e.target.value)}>
              {filiais.map((f) => (
                <option key={f.id} value={f.id}>{rotuloFilial(f)}</option>
              ))}
            </select>
          </div>
        ) : (
          nomeFilial && <div className="topo-filial">{nomeFilial}</div>
        )}
        <header className="topo">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="menu-toggle btn-ghost" onClick={() => setMenuAberto((v) => !v)} aria-label="Menu">☰</button>
            <span className="filial-nome">{perfil.nome} · {PAPEIS[perfil.papel] || perfil.papel}</span>
            {/* Estado que antes era invisível: dava pra passar o dia achando
                que esta janela escutava os pedidos do celular sem escutar.
                Como a preferência vive no localStorage, ela é POR PERFIL do
                navegador — marcada numa janela normal, não vale na janela do
                pdv-cabine.bat, que roda em perfil próprio (--user-data-dir). */}
            {imprimePedidosDaCabine() && (
              <span className="suave" style={{ fontSize: 11 }}
                title="Esta janela imprime os pedidos de impressão vindos do celular (Configurações → Aparência).">
                🖨 cabine
              </span>
            )}
          </div>
          {/* Devolve a vaga do limite de usuários simultâneos antes de sair —
              senão ela ficaria presa até expirar por falta de heartbeat (2
              min), e quem entrasse em seguida podia levar "limite atingido"
              com o posto já livre. */}
          <button className="btn-ghost" onClick={async () => { await liberarSessao(); supabase.auth.signOut(); }}>Sair</button>
        </header>
        {avisoLimpeza && (
          <div className="aviso" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 10px' }}>
            <span>
              {avisoLimpeza.elegiveis} lançamento(s) antigo(s) já podem ser excluídos —{' '}
              <NavLink to="/configuracoes">ver em Configurações</NavLink>.
            </span>
            <button className="btn-ghost" onClick={() => setAvisoLimpeza(null)} aria-label="Dispensar aviso">✕</button>
          </div>
        )}
        <div className="container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
