// Vercel Function (Node.js) — salva (POST) e consulta o status (GET) do
// certificado digital (.pfx) da filial de quem chama, em fiscal_certificados
// (ver 0054_fiscal_certificado.sql). Só o fornecedor usa (Configurações →
// Fiscal) — a tabela não tem NENHUMA policy de RLS pra `authenticated`, então
// mesmo o fornecedor da própria filial só alcança por aqui, nunca direto do
// navegador. A filial nunca vem do corpo da requisição: é sempre a do perfil
// de quem chamou (filial_ativa, se for fornecedor operando outro cliente).
//
// Variáveis de ambiente exigidas (Vercel -> Project Settings -> Environment
// Variables; nunca comitar, nunca colar num chat):
//   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY   (já configuradas pro app)
//   SUPABASE_SERVICE_ROLE_KEY                    (Supabase → Settings → API)
import { createClient } from '@supabase/supabase-js';
import { extrairChaveECertificado } from '../src/servidor/nfse.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não suportado.' });
    return;
  }

  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) { res.status(401).json({ erro: 'Faça login no app.' }); return; }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { res.status(500).json({ erro: 'Falta SUPABASE_SERVICE_ROLE_KEY nas Environment Variables do Vercel.' }); return; }

  const comoUsuario = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: sessao, error: errSessao } = await comoUsuario.auth.getUser();
  if (errSessao || !sessao?.user) { res.status(401).json({ erro: 'Sessão inválida — faça login de novo.' }); return; }

  const { data: meuPerfil } = await comoUsuario.from('perfis')
    .select('filial_id, filial_ativa, papel, ativo').eq('id', sessao.user.id).maybeSingle();
  if (!meuPerfil?.ativo || meuPerfil.papel !== 'fornecedor') {
    res.status(403).json({ erro: 'Só o fornecedor configura o certificado fiscal.' });
    return;
  }
  const filialId = meuPerfil.filial_ativa || meuPerfil.filial_id;

  const admin = createClient(process.env.VITE_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (req.method === 'GET') {
    const { data, error } = await admin.from('fiscal_certificados')
      .select('atualizado_em').eq('filial_id', filialId).maybeSingle();
    if (error) { res.status(500).json({ erro: error.message }); return; }
    res.status(200).json({ configurado: !!data, atualizadoEm: data?.atualizado_em || null });
    return;
  }

  // POST — salva/substitui o certificado desta filial.
  const { pfxB64, senha } = req.body || {};
  if (!pfxB64 || !senha) { res.status(400).json({ erro: 'Certificado (.pfx) e senha são obrigatórios.' }); return; }

  // Confere que o .pfx e a senha realmente abrem juntos ANTES de salvar — sem
  // isso, arquivo errado ou senha digitada errada só apareceria na hora de
  // emitir a primeira nota, bem mais difícil de associar ao erro.
  try {
    extrairChaveECertificado(Buffer.from(pfxB64, 'base64'), senha);
  } catch (e) {
    res.status(400).json({ erro: `Não consegui abrir o certificado com essa senha: ${String(e?.message || e)}` });
    return;
  }

  const { error } = await admin.from('fiscal_certificados').upsert({
    filial_id: filialId,
    pfx_b64: pfxB64,
    senha,
    atualizado_em: new Date().toISOString(),
    atualizado_por: sessao.user.id,
  });
  if (error) { res.status(500).json({ erro: error.message }); return; }
  res.status(200).json({ ok: true });
}
