// Vercel Function (Node.js) — confere a "senha do mês" (anti-calote do
// Eduardo/fornecedor, ver supabase/migrations/0026_senha_mes.sql e
// src/lib/senhaMes.js) e libera o login da filial pro mês corrente.
//
// O cálculo roda só aqui (nunca no navegador — ver o comentário no topo de
// senhaMes.js) e a resposta NUNCA inclui a senha certa, só bateu/não bateu.
//
// Variáveis de ambiente exigidas (mesmas de api/criar-usuario.js):
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
import { calcularSenhaMes } from '../src/lib/senhaMes.js';

function primeiroDiaMesISO(data) {
  return new Date(Date.UTC(data.getFullYear(), data.getMonth(), 1)).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Método não suportado.' }); return; }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ erro: 'Faça login no app.' }); return; }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ erro: 'Senha do mês não configurada (falta SUPABASE_SERVICE_ROLE_KEY nas Environment Variables do Vercel).' });
    return;
  }

  // Quem está pedindo, e qual filial ele opera — nunca vem do body.
  const comoUsuario = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: sessao, error: errSessao } = await comoUsuario.auth.getUser();
  if (errSessao || !sessao?.user) { res.status(401).json({ erro: 'Sessão inválida — faça login de novo.' }); return; }

  const { data: meuPerfil } = await comoUsuario.from('perfis')
    .select('filial_id, filial_ativa, papel, ativo').eq('id', sessao.user.id).maybeSingle();
  if (!meuPerfil?.ativo) { res.status(403).json({ erro: 'Usuário inativo.' }); return; }
  const filialId = meuPerfil.filial_ativa || meuPerfil.filial_id;

  const admin = createClient(process.env.VITE_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: filial } = await admin.from('filiais')
    .select('numero_cliente, senha_mes_liberada_em').eq('id', filialId).maybeSingle();
  if (!filial) { res.status(404).json({ erro: 'Filial não encontrada.' }); return; }

  const hoje = new Date();
  const mesCorrente = primeiroDiaMesISO(hoje);

  // Já liberado por outra pessoa que logou antes esse mês.
  if (filial.senha_mes_liberada_em === mesCorrente) {
    res.status(200).json({ liberado: true });
    return;
  }

  const esperada = calcularSenhaMes(filial.numero_cliente, hoje);

  // Espia o topo da fila (mais antiga primeiro) — cliente que pré-pagou
  // vários meses (fila cadastrada de uma vez) passa direto, sem perguntar
  // nada a ninguém.
  const { data: topoFila } = await admin.from('senhas_mes_fila')
    .select('id, senha').eq('filial_id', filialId).order('criado_em', { ascending: true }).limit(1).maybeSingle();

  if (topoFila && String(topoFila.senha).trim().toUpperCase() === esperada) {
    await admin.from('senhas_mes_fila').delete().eq('id', topoFila.id);
    await admin.from('filiais').update({ senha_mes_liberada_em: mesCorrente }).eq('id', filialId);
    res.status(200).json({ liberado: true });
    return;
  }

  // Fila vazia ou não bate com o mês corrente (é pra um mês futuro) —
  // precisa da senha digitada por quem estiver logando. `numeroCliente` vai
  // junto pra tela mostrar (Configurações → SenhaMesGate.jsx) — quem está
  // travado aqui precisa ligar/mandar mensagem pro fornecedor pedindo a
  // senha, e é bom já saber de cabeça o código do cliente pra falar.
  const { senhaDigitada } = req.body || {};
  if (!senhaDigitada) {
    res.status(200).json({ liberado: false, precisaSenha: true, numeroCliente: filial.numero_cliente || null });
    return;
  }

  if (String(senhaDigitada).trim().toUpperCase() !== esperada) {
    res.status(200).json({ liberado: false, precisaSenha: true, erro: 'Senha incorreta.', numeroCliente: filial.numero_cliente || null });
    return;
  }

  await admin.from('filiais').update({ senha_mes_liberada_em: mesCorrente }).eq('id', filialId);
  res.status(200).json({ liberado: true });
}
