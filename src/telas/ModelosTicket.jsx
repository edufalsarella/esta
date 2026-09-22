import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { PreviaModelo } from '../componentes/Ticket.jsx';
import { MODELOS_PADRAO, TIPOS_TICKET } from '../lib/modelosPadrao.js';
import { ehSupervisor } from '../lib/acesso.js';

// Layout do comprovante por filial, no mesmo esquema do sistema legado: texto
// com tokens entre arrobas. Sem modelo salvo pra um tipo, o app usa o layout
// fixo antigo — dá pra migrar um tipo de cada vez.

/** Colinha por tipo: só os tokens que fazem sentido naquele comprovante. */
const TOKENS = {
  comuns: [
    ['@LOGO@', 'Logo do estabelecimento (Configurações → Dados do estacionamento) — vazio se nenhum logo foi importado'],
    ['@ER@', 'Nome do estacionamento'], ['@EF@', '(sem uso — sempre em branco)'], ['@EE@', 'Endereço'],
    ['@EC@', 'Cidade-UF'], ['@EG@', 'CNPJ'], ['@EI@', 'Telefone (uso legado — igual a @FONE@)'], ['@FONE@', 'Telefone do estacionamento'],
    ['@US@', 'Operador'], ['@ARROBA@', 'Imprime um "@"'],
    ['@P1@…@P9@', 'N linhas em branco'],
  ],
  movimento: [
    ['@C#@', 'Nº do controle'], ['@CC@', 'Placa'], ['@CV@', 'Veículo'],
    ['@TV@', 'Tabela'], ['@XBOX@', 'Box/vaga'], ['@AVISO@', 'Aviso do movimento'],
    ['@DE@', 'Data entrada'], ['@HE@', 'Hora entrada'],
    ['@DS@', 'Data saída'], ['@HS@', 'Hora saída'], ['@TH@', 'Permanência'],
    ['@V@', 'Valor'], ['@CO@', 'Convênio'], ['@VC@', 'Valor do convênio'],
    ['@SERVICOS@', 'Serviços'], ['@VALORSERVICOS@', 'Valor dos serviços'],
    ['@BONUS@', 'Bônus fidelidade'], ['@SALDOBONUS@', 'Saldo de pontos após usar o bônus (só quando algum foi usado nesta saída)'],
    ['@VD@', 'Saldo devedor'],
    ['@MENSALISTA@', 'Nome do mensalista'],
    ['@AVARIAS@', 'Avarias registradas na entrada'], ['@AVARIAS_NUM@', 'Testa se tem avaria digitada — use em @SE(AVARIAS_NUM)@'],
    ['@ANTECIPADO@', 'Valor pago antecipado na entrada'],
  ],
  mensalidade: [
    ['@MENSALISTA@', 'Nome'], ['@MCPF@', 'CPF/CNPJ'], ['@MEND@', 'Endereço'],
    ['@MCEP@', 'CEP'], ['@MCID@', 'Cidade-UF'], ['@MTR@', 'Telefone'],
    ['@MCEL@', 'Celular'], ['@MEMAIL@', 'E-mail'], ['@VAGAS@', 'Vagas contratadas'],
    ['@CC01@/@CV01@…', 'Placas/veículos do mensalista'],
    ['@DE@', 'Data do pagamento'], ['@DS@', 'Próximo vencimento'],
    ['@VM@', 'Valor da mensalidade'], ['@V@', 'Valor pago'],
    ['@MULTA@', 'Multa/juros'], ['@EXTRA@', 'Extras'], ['@MOEDA@', 'Forma de pagamento'],
  ],
  rps: [
    ['@MENSALIDADE@', 'Preenchido quando a nota veio de mensalidade (não do pátio)'],
    ['@COMPETENCIA@', 'Competência da nota'],
    ['@NNFE@', 'Número da nota/RPS'], ['@SERIERPS@', 'Série'],
    ['@RAZAORPS@', 'Razão social do prestador'], ['@IMRPS@', 'Inscrição municipal'],
    ['@RPSDESCR@', 'Descrição do serviço'], ['@ISS@', 'Valor do ISS'], ['@PERCISS@', '% ISS'],
    ['@CCPF@', 'CPF/CNPJ do tomador'], ['@CNOME@', 'Nome do tomador'],
    ['@CENDE@', 'Endereço'], ['@CNUM@', 'Número'], ['@CBAIRRO@', 'Bairro'],
    ['@CCEP@', 'CEP'], ['@CCID@', 'Cidade'], ['@CESTA@', 'UF'],
    ['@CFONE@', 'Telefone'], ['@CEMAIL@', 'E-mail'],
  ],
  reserva: [
    ['@CC@', 'Placa'], ['@CV@', 'Modelo do veículo'],
    ['@RTIPO@', 'Tipo de vaga (coberta/descoberta)'],
    ['@RDE@', 'Data início'], ['@RATE@', 'Data final'],
    ['@RNOME@', 'Nome de quem reservou'], ['@RFONE@', 'Telefone'],
    ['@ROBS@', 'Observações'],
    ['@PROPOSTO@', 'Valor proposto (estimado pela tabela de preço do prefixo da vaga)'],
    ['@ANTECIPADO@', 'Valor pago antecipado ao criar a reserva'],
  ],
  divida: [
    ['@CC@', 'Placa'], ['@CV@', 'Veículo'],
    ['@DS@', 'Data'], ['@HS@', 'Hora'],
    ['@DIVIDA@', 'Valor da dívida contraída nesta saída (forma "Devedor")'],
  ],
};

function tokensDoTipo(tipo) {
  if (tipo === 'mensalidade') return [...TOKENS.comuns, ...TOKENS.mensalidade];
  if (tipo === 'rps') return [...TOKENS.comuns, ...TOKENS.movimento, ...TOKENS.rps];
  if (tipo === 'reserva') return [...TOKENS.comuns, ...TOKENS.reserva];
  if (tipo === 'divida') return [...TOKENS.comuns, ...TOKENS.divida];
  return [...TOKENS.comuns, ...TOKENS.movimento];
}

/** Dados de exemplo pra pré-visualização — nada real, só pro operador ver o formato. */
const LOGO_EXEMPLO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="50">'
  + '<rect width="120" height="50" fill="#ddd"/>'
  + '<text x="60" y="30" font-size="13" text-anchor="middle" fill="#888">LOGO</text></svg>';

const EXEMPLO = {
  LOGO: { dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(LOGO_EXEMPLO_SVG)}` },
  ER: 'ESTACIONAMENTO MODELO', EF: '', EE: 'Rua General Osorio, 939',
  EC: 'Campinas-SP', EG: '00.000.000/0001-00', EI: '(19) 3241-4920', FONE: '(19) 3241-4920',
  'C#': 'A1B2C3D4', CC: 'ABC1D23', CV: 'FIESTA', TV: 'P', XBOX: '12',
  DE: '10/08/2026', HE: '10:43', DS: '10/08/2026', HS: '14:20', TH: '03:37',
  V: 'R$ 15,00', V_NUM: 15, CO: 'CONV01', VC: 'R$ 5,00', VC_NUM: 5,
  SERVICOS: 'LAVAGEM', VALORSERVICOS: 'R$ 30,00', VALORSERVICOS_NUM: 30,
  BONUS: 'R$ 10,00', BONUS_NUM: 10, SALDOBONUS: '37', SALDOBONUS_NUM: 37,
  VD: '', VD_NUM: 0, AVISO: '', AVARIAS: 'Risco na porta direita', AVARIAS_NUM: 1,
  ANTECIPADO: 'R$ 200,00', ANTECIPADO_NUM: 200,
  MENSALISTA: 'JOSE DA SILVA', MCPF: '529.982.247-25', MEND: 'Rua das Flores, 100',
  MCEP: '13010-111', MCID: 'Campinas-SP', MTR: '(19) 3241-4920', MCEL: '(19) 99999-9999',
  MEMAIL: 'jose@exemplo.com.br', VAGAS: '2', CC01: 'ABC1D23', CV01: 'FIESTA',
  CC02: 'XYZ9W87', CV02: 'GOL', VM: 'R$ 160,00', MULTA: '', MULTA_NUM: 0,
  EXTRA: '', EXTRA_NUM: 0, MOEDA: 'DINHEIRO',
  MENSALIDADE: '', COMPETENCIA: '10/08/2026', // exemplo = nota vinda do pátio
  NNFE: '716', SERIERPS: '1', RAZAORPS: 'ESTACIONAMENTO MODELO LTDA', IMRPS: '123456',
  RPSDESCR: 'Estacionamento de veículo', ISS: 'R$ 0,30', PERCISS: '2',
  CCPF: '529.982.247-25', CNOME: 'JOSE DA SILVA', CENDE: 'Rua das Flores',
  CNUM: '100', CBAIRRO: 'Centro', CCEP: '13010-111', CCID: 'Campinas', CESTA: 'SP',
  CFONE: '(19) 3241-4920', CEMAIL: 'jose@exemplo.com.br',
  RTIPO: 'Coberta', RDE: '04/08/2026', RATE: '20/08/2026',
  RNOME: 'Jose da Silva', RFONE: '(19) 99999-9999', ROBS: 'Chegada por volta das 6h',
  PROPOSTO: 'R$ 800,00', PROPOSTO_NUM: 800,
  US: 'Eduardo',
};

export default function ModelosTicket({ perfil }) {
  const [tipo, setTipo] = useState('entrada');
  const [conteudo, setConteudo] = useState('');
  const [salvos, setSalvos] = useState({}); // tipo -> conteúdo gravado
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);
  const podeEditar = ehSupervisor(perfil);

  async function carregar() {
    setErro('');
    const { data, error } = await supabase.from('modelos_ticket').select('tipo, conteudo');
    if (error) { setErro(error.message); return; }
    const porTipo = Object.fromEntries((data || []).map((m) => [m.tipo, m.conteudo]));
    setSalvos(porTipo);
    setConteudo(porTipo[tipo] ?? MODELOS_PADRAO[tipo]);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  function trocarTipo(novo) {
    setTipo(novo); setMsg('');
    setConteudo(salvos[novo] ?? MODELOS_PADRAO[novo]);
  }

  async function salvar() {
    setErro(''); setMsg(''); setSalvando(true);
    const { error } = await supabase.from('modelos_ticket')
      .upsert({ filial_id: perfil.filial_id, tipo, conteudo }, { onConflict: 'filial_id,tipo' });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setSalvos((s) => ({ ...s, [tipo]: conteudo }));
    setMsg('Modelo salvo — os próximos comprovantes desse tipo já saem nesse layout.');
  }

  async function voltarAoFixo() {
    if (!window.confirm('Apagar o modelo desta filial? O comprovante volta ao layout padrão do sistema.')) return;
    setErro(''); setMsg('');
    const { error } = await supabase.from('modelos_ticket').delete().eq('tipo', tipo);
    if (error) { setErro(error.message); return; }
    setSalvos((s) => { const c = { ...s }; delete c[tipo]; return c; });
    setConteudo(MODELOS_PADRAO[tipo]);
    setMsg('Modelo removido — esse comprovante volta ao layout fixo do sistema.');
  }

  const rotulo = TIPOS_TICKET.find((t) => t.tipo === tipo)?.rotulo || tipo;
  const alterado = conteudo !== (salvos[tipo] ?? MODELOS_PADRAO[tipo]);

  return (
    <>
      <div className="card">
        <div className="card-cab">
          <div>
            <h2>Modelos de ticket</h2>
            <p className="suave">
              O layout de cada comprovante é um texto com tokens entre arrobas (<code>@CC@</code> = placa),
              como no sistema antigo — dá pra colar um modelo .txt do legado aqui. Sem modelo salvo,
              o comprovante sai no layout fixo do sistema.
            </p>
          </div>
          <div className="campo" style={{ minWidth: 240 }}>
            <label>Tipo de comprovante</label>
            <select value={tipo} onChange={(e) => trocarTipo(e.target.value)}>
              {TIPOS_TICKET.map((t) => (
                <option key={t.tipo} value={t.tipo}>
                  {t.rotulo}{salvos[t.tipo] ? ' ✓' : ''}
                </option>
              ))}
            </select>
            <span className="suave" style={{ fontSize: 11 }}>✓ = já tem modelo próprio nesta filial.</span>
          </div>
        </div>
        {erro && <div className="aviso">{erro}{erro.includes('modelos_ticket') && ' — rode a migration 0017_modelos_ticket.sql.'}</div>}
        {msg && <div className="ok-txt">{msg}</div>}
      </div>

      <div className="linha-form" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="card" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <h2>{rotulo}</h2>
          <textarea className="mono" rows={26} style={{ width: '100%', fontSize: 12, lineHeight: 1.35 }}
            value={conteudo} disabled={!podeEditar} onChange={(e) => setConteudo(e.target.value)} />
          <div className="linha-form" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <button className="btn-ghost" disabled={!podeEditar}
              onClick={() => setConteudo(MODELOS_PADRAO[tipo])}>Restaurar modelo padrão</button>
            <div className="linha-form">
              {salvos[tipo] && (
                <button className="btn-ghost aviso-btn" disabled={!podeEditar} onClick={voltarAoFixo}>
                  Voltar ao layout fixo
                </button>
              )}
              <button className="btn-primary" disabled={!podeEditar || salvando || !alterado} onClick={salvar}>
                {salvando ? 'Salvando…' : 'Salvar modelo'}
              </button>
            </div>
          </div>
          {!podeEditar && <p className="suave">Só supervisores podem editar.</p>}
        </div>

        <div className="card" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h2>Pré-visualização</h2>
          <p className="suave">Com dados de exemplo — não precisa gerar um movimento de verdade.</p>
          <div style={{ background: 'var(--panel2)', padding: 12, borderRadius: 8 }}>
            <PreviaModelo modelo={conteudo} dados={EXEMPLO} />
          </div>

          <h3 style={{ marginBottom: 4 }}>Tokens deste comprovante</h3>
          <p className="suave" style={{ fontSize: 11, marginTop: 0 }}>
            Condicional: <code>@SE(CAMPO)@</code> imprime a linha só se o campo tiver conteúdo, e
            <code>@SE(#CAMPO)@</code> só se estiver vazio. Também vale <code>@SE(CAMPO=valor)@</code> e
            <code>@SE(CAMPO&lt;&gt;valor)@</code> — o <code>#</code> serve como <code>&lt;&gt;</code>, igual no Clipper.
            Formatação: <code>@PG+@…@PG-@</code> grande, <code>@PE+@</code> negrito,
            <code>@PP+@</code> pequeno, <code>@PI+@</code> itálico, <code>@PS+@</code> sublinhado.
          </p>
          <div className="tabela-scroll" style={{ maxHeight: 260 }}>
            <table>
              <tbody>
                {tokensDoTipo(tipo).map(([token, desc]) => (
                  <tr key={token}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{token}</td>
                    <td className="suave">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
