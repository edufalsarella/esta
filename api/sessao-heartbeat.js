// Vercel Function (Node.js) — controla o limite de usuários simultâneos por
// filial (licenciamento do fornecedor, ver
// supabase/migrations/0032_limite_usuarios_simultaneos.sql). Chamada em loop
// pelo front (ver src/telas/SessoesGate.jsx): cada chamada é um "heartbeat"
// que renova a vaga da SESSÃO (ver 0046_sessao_por_dispositivo.sql — um id
// por aba/dispositivo, não por pessoa) e, se a filial já está no limite,
// barra vaga nova sem apagar a de quem já está dentro.
//
// Mesmo padrão de auth de api/conferir-senha-mes.js. Variáveis de ambiente
// exigidas:
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';

// 24h, não 2min: a vaga é por POSTO (ver SessoesGate.jsx), e um cliente
// costuma logar num Windows quase parado (fica minimizado/em segundo plano
// a maior parte do tempo, o funcionário usa mais o Android) — 2min derrubava
// esse posto sozinho, e se um terceiro dispositivo (ex.: o celular do dono,
// espiando o painel) pegava a vaga liberada nesse meio tempo, o funcionário
// tomava bloqueio no Windows sem nunca ter saído de propósito. Sessão
// realmente esquecida (PC travou, não deu pra clicar "Sair") só libera a
// vaga depois de 24h — até lá, quem precisar entrar pede pra alguém sair de
// um dos dispositivos (ver liberarSessao/"Sair" abaixo).
const MINUTOS_SEM_PING_EXPIRA = 24 * 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ erro: 'Método não suportado.' }); return; }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ erro: 'Faça login no app.' }); return; }

  // Gerado no navegador (sessionStorage — um por aba/dispositivo, ver
  // SessoesGate.jsx), não um segredo: só distingue "quantas conexões" de
  // "quantas pessoas" (ver 0046_sessao_por_dispositivo.sql).
  const sessaoId = String(req.body?.sessaoId || '').trim();
  if (!sessaoId) { res.status(400).json({ erro: 'Sessão sem id — recarregue a página.' }); return; }
  // "Sair" no app: devolve a vaga na hora em vez de esperar os 2 min de
  // expiração (ver liberarSessao em SessoesGate.jsx).
  const liberar = req.body?.liberar === true;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ erro: 'Controle de sessões não configurado (falta SUPABASE_SERVICE_ROLE_KEY nas Environment Variables do Vercel).' });
    return;
  }

  // Quem está pedindo, e qual filial ele opera — nunca vem do body.
  const comoUsuario = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: sessao, error: errSessao } = await comoUsuario.auth.getUser();
  if (errSessao || !sessao?.user) { res.status(401).json({ erro: 'Sessão inválida — faça login de novo.' }); return; }

  const { data: meuPerfil } = await comoUsuario.from('perfis')
    .select('id, filial_id, filial_ativa, ativo').eq('id', sessao.user.id).maybeSingle();
  if (!meuPerfil?.ativo) { res.status(403).json({ erro: 'Usuário inativo.' }); return; }
  const filialId = meuPerfil.filial_ativa || meuPerfil.filial_id;

  const admin = createClient(process.env.VITE_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (liberar) {
    await admin.from('sessoes_ativas').delete()
      .eq('filial_id', filialId).eq('perfil_id', meuPerfil.id).eq('sessao_id', sessaoId);
    res.status(200).json({ liberado: true });
    return;
  }

  const { data: filial } = await admin.from('filiais')
    .select('limite_usuarios_simultaneos').eq('id', filialId).maybeSingle();
  if (!filial) { res.status(404).json({ erro: 'Filial não encontrada.' }); return; }

  // Libera sozinho as vagas de quem parou de mandar heartbeat (fechou a
  // aba, perdeu internet, desligou o notebook) — sem precisar de logout.
  const limiar = new Date(Date.now() - MINUTOS_SEM_PING_EXPIRA * 60 * 1000).toISOString();
  await admin.from('sessoes_ativas').delete().eq('filial_id', filialId).lt('ultimo_ping', limiar);

  const agora = new Date().toISOString();

  if (!filial.limite_usuarios_simultaneos) {
    // Sem limite: sempre libera, só mantém o próprio ping em dia (caso um
    // limite seja configurado depois, a contagem já começa correta).
    await admin.from('sessoes_ativas')
      .upsert({ filial_id: filialId, perfil_id: meuPerfil.id, sessao_id: sessaoId, ultimo_ping: agora },
        { onConflict: 'filial_id,perfil_id,sessao_id' });
    res.status(200).json({ liberado: true });
    return;
  }

  const { data: minha } = await admin.from('sessoes_ativas')
    .select('id').eq('filial_id', filialId).eq('perfil_id', meuPerfil.id).eq('sessao_id', sessaoId).maybeSingle();
  if (minha) {
    // Já tem vaga própria (renovando o heartbeat desta mesma aba/dispositivo) — nunca barra quem já está dentro.
    await admin.from('sessoes_ativas').update({ ultimo_ping: agora }).eq('id', minha.id);
    res.status(200).json({ liberado: true });
    return;
  }

  const { count } = await admin.from('sessoes_ativas')
    .select('id', { count: 'exact', head: true }).eq('filial_id', filialId);
  if ((count || 0) >= filial.limite_usuarios_simultaneos) {
    res.status(200).json({ liberado: false, limite: filial.limite_usuarios_simultaneos });
    return;
  }

  await admin.from('sessoes_ativas').insert({ filial_id: filialId, perfil_id: meuPerfil.id, sessao_id: sessaoId, ultimo_ping: agora });
  res.status(200).json({ liberado: true });
}
