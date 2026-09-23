import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const INTERVALO_HEARTBEAT_MS = 45_000;
const INTERVALO_RETRY_BLOQUEADO_MS = 20_000;
const CHAVE_SESSAO_ID = 'esta_sessao_id';

/**
 * Id deste NAVEGADOR (não desta aba, nem desta pessoa) — em localStorage, que
 * sobrevive a recarregar e a fechar/reabrir o app.
 *
 * Era sessionStorage (um id por aba/janela) e isso furava o limite ao
 * contrário: cada vez que a cabine era reaberta nascia uma sessão NOVA, e a
 * anterior só sumia depois de expirar sem heartbeat (ver
 * MINUTOS_SEM_PING_EXPIRA em api/sessao-heartbeat.js) — reabrir o app duas
 * vezes seguidas estourava um limite de 2 usuários tendo só duas pessoas de
 * verdade. Foi o que aconteceu numa instalação, durante os testes de
 * impressão.
 *
 * Por perfil de navegador é também o que "usuário simultâneo" significa numa
 * licença: quantos POSTOS estão usando o sistema. Duas abas na mesma máquina
 * são um posto só; a cabine (que roda em perfil próprio, --user-data-dir) e o
 * celular continuam contando dois, cada um com seu id — que era o ponto da
 * 0046_sessao_por_dispositivo.sql.
 */
function sessaoId() {
  let id = localStorage.getItem(CHAVE_SESSAO_ID);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(CHAVE_SESSAO_ID, id); }
  return id;
}

/**
 * Devolve a vaga na hora, em vez de deixar o limite esperar a expiração de
 * 24h por falta de heartbeat (ver MINUTOS_SEM_PING_EXPIRA em
 * api/sessao-heartbeat.js) — chamado no "Sair" (ver Layout.jsx). Best-effort:
 * falhando, a expiração por falta de heartbeat resolve sozinha (só que bem
 * mais devagar).
 */
export async function liberarSessao() {
  try {
    const { data: sessaoAuth } = await supabase.auth.getSession();
    if (!sessaoAuth.session) return;
    await fetch('/api/sessao-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessaoAuth.session.access_token}` },
      body: JSON.stringify({ sessaoId: sessaoId(), liberar: true }),
      keepalive: true,
    });
  } catch { /* a expiração por heartbeat cobre */ }
}

/**
 * Trava o login quando a filial já está no limite de usuários simultâneos
 * (ver supabase/migrations/0032_limite_usuarios_simultaneos.sql e
 * api/sessao-heartbeat.js). Enquanto montado, manda um heartbeat periódico
 * pra manter a vaga — fechar a aba/perder rede libera sozinho depois de
 * alguns minutos, sem precisar de logout. Fornecedor nunca passa por aqui
 * (ver App.jsx).
 */
export default function SessoesGate({ children }) {
  const [estado, setEstado] = useState('carregando'); // carregando | liberado | bloqueado
  const [limite, setLimite] = useState(null);
  const intervaloRef = useRef(null);
  const retryRef = useRef(null);

  async function bater() {
    const { data: sessaoAuth } = await supabase.auth.getSession();
    if (!sessaoAuth.session) return; // deslogou nesse meio tempo — nada a fazer
    try {
      const resp = await fetch('/api/sessao-heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessaoAuth.session.access_token}` },
        body: JSON.stringify({ sessaoId: sessaoId() }),
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok || !dados.liberado) {
        setLimite(dados.limite ?? null);
        setEstado('bloqueado');
        return;
      }
      setEstado('liberado');
    } catch {
      // Falha de rede não derruba quem já está dentro — só não renova esse
      // ciclo; o próximo heartbeat resolve sozinho.
      setEstado((e) => (e === 'carregando' ? 'liberado' : e));
    }
  }

  useEffect(() => {
    bater();
    intervaloRef.current = setInterval(bater, INTERVALO_HEARTBEAT_MS);
    return () => clearInterval(intervaloRef.current);
    // eslint-disable-next-line
  }, []);

  // Bloqueado: tenta de novo sozinho — a vaga pode abrir a qualquer momento
  // sem precisar de ação de quem está esperando.
  useEffect(() => {
    if (estado !== 'bloqueado') { clearInterval(retryRef.current); return; }
    retryRef.current = setInterval(bater, INTERVALO_RETRY_BLOQUEADO_MS);
    return () => clearInterval(retryRef.current);
    // eslint-disable-next-line
  }, [estado]);

  if (estado === 'carregando') return <div className="centro">Carregando…</div>;
  if (estado === 'liberado') return children;

  return (
    <div className="centro">
      <div className="card" style={{ width: 380 }}>
        <h2>Limite de usuários atingido</h2>
        <p className="suave">
          {limite
            ? `Este estacionamento já tem ${limite} usuário${limite === 1 ? '' : 's'} conectado${limite === 1 ? '' : 's'} ao mesmo tempo.`
            : 'Este estacionamento já atingiu o limite de usuários conectados ao mesmo tempo.'}
          {' '}Assim que alguém sair, o acesso libera sozinho.
        </p>
        <div className="linha-form" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sair</button>
          <button className="btn-primary" onClick={bater}>Tentar novamente</button>
        </div>
      </div>
    </div>
  );
}
