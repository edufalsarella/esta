import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { obterTema, aplicarTema } from '../lib/tema.js';
import { imprimePedidosDaCabine, definirImprimePedidosDaCabine } from '../lib/preferenciasNavegador.js';
import { conectarImpressoraBluetooth, impressoraBluetoothSalva, esquecerImpressoraBluetooth } from '../lib/bluetoothPrinter.js';
import { ehFornecedor, ehSupervisor, nfseAtivo } from '../lib/acesso.js';
import { converterLogo, refazerLogoComPercentual, LARGURA_PAPEL_DOTS, PERCENTUAL_PADRAO } from '../lib/logoTicket.js';
import CidadeBusca from '../componentes/CidadeBusca.jsx';

// Dados do estacionamento (nome/endereço/CNPJ/fiscal). Só o fornecedor altera:
// são dados com efeito legal e fiscal, e mexer neles é chamado de suporte. A
// trava não é só desta tela — a policy de UPDATE em `filiais` exige fornecedor
// (ver 0018_papeis_e_fornecedor.sql), então vale também fora do app.
export default function Configuracoes({ perfil }) {
  const [filial, setFilial] = useState(null);
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState(false);
  const [tema, setTema] = useState(obterTema());
  const [imprimeCabine, setImprimeCabine] = useState(imprimePedidosDaCabine());
  const [impressoraBt, setImpressoraBt] = useState(impressoraBluetoothSalva());
  const [pareandoBt, setPareandoBt] = useState(false);
  const [erroBt, setErroBt] = useState('');
  const suportaBluetooth = typeof navigator !== 'undefined' && !!navigator.bluetooth;
  const [previaLimpeza, setPreviaLimpeza] = useState(null);
  const [limpando, setLimpando] = useState(false);
  const [erroLimpeza, setErroLimpeza] = useState('');
  const [processandoLogo, setProcessandoLogo] = useState(false);
  const [erroLogo, setErroLogo] = useState('');
  const [certStatus, setCertStatus] = useState(null);
  const [certArquivo, setCertArquivo] = useState(null); // { nome, base64 }
  const [certSenha, setCertSenha] = useState('');
  const [salvandoCert, setSalvandoCert] = useState(false);
  const [erroCert, setErroCert] = useState('');
  const [msgCert, setMsgCert] = useState('');
  const podeEditar = ehFornecedor(perfil);
  const podeLimpar = ehSupervisor(perfil);

  function mudarTema(novoTema) {
    aplicarTema(novoTema);
    setTema(novoTema);
  }

  function mudarImprimeCabine(ligado) {
    definirImprimePedidosDaCabine(ligado);
    setImprimeCabine(ligado);
  }

  /**
   * Pareamento único da impressora Bluetooth deste navegador (ver
   * bluetoothPrinter.js) — feito aqui uma vez, o comprovante (Ticket.jsx →
   * "Imprimir Bluetooth") reconecta sozinho dali pra frente, sem abrir o
   * diálogo do navegador de novo a cada ticket. Só faz sentido nesta tela
   * porque, num cliente, normalmente só existe UMA impressora — não é uma
   * escolha por ticket.
   */
  async function parearBluetooth() {
    setErroBt(''); setPareandoBt(true);
    try {
      const impressora = await conectarImpressoraBluetooth();
      impressora.desconectar(); // só precisava do pareamento; a conexão de verdade é na hora de imprimir
      setImpressoraBt(impressoraBluetoothSalva());
    } catch (e) {
      // Usuário cancelou o diálogo de pareamento não é bem um "erro" — não assusta com aviso vermelho.
      if (e.name !== 'NotFoundError') setErroBt(e.message);
    } finally {
      setPareandoBt(false);
    }
  }

  /**
   * Logo do estabelecimento (@LOGO@, ver Modelos de ticket) — processado uma
   * vez aqui (canvas: redimensiona + gera o bitmap ESC/POS, ver
   * logoTicket.js) e fica só em `filial.config.logo`, junto com o resto da
   * config fiscal/patio/etc. Salva no mesmo botão "Salvar" de sempre — não
   * grava sozinho, pra não fugir do padrão de "um Salvar só" desta tela.
   */
  async function escolherLogo(e) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErroLogo(''); setProcessandoLogo(true);
    try {
      const logo = await converterLogo(arquivo);
      setFilial((f) => ({ ...f, config: { ...f.config, logo } }));
    } catch (err) {
      setErroLogo(err.message);
    } finally {
      setProcessandoLogo(false);
    }
  }

  // Só muda o tamanho — refaz o bitmap a partir da imagem já salva, sem
  // precisar escolher o arquivo de novo. Ao soltar o controle (não a cada
  // pixel do arrasto) pra não regenerar bitmap toda hora.
  async function mudarTamanhoLogo(percentual) {
    setErroLogo(''); setProcessandoLogo(true);
    try {
      const logo = await refazerLogoComPercentual(filial.config.logo, percentual);
      setFilial((f) => ({ ...f, config: { ...f.config, logo } }));
    } catch (err) {
      setErroLogo(err.message);
    } finally {
      setProcessandoLogo(false);
    }
  }

  function removerLogo() {
    setFilial((f) => ({ ...f, config: { ...f.config, logo: null } }));
  }

  function esquecerBluetooth() {
    esquecerImpressoraBluetooth();
    setImpressoraBt(null);
  }

  async function carregar() {
    const { data, error } = await supabase.from('filiais').select('*').eq('id', perfil.filial_id).maybeSingle();
    if (error) setErro(error.message); else setFilial(data);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, []);

  /**
   * Certificado fiscal (.pfx) da filial atual — pra fornecedor que troca de
   * filial (EscolherFilial), refaz a consulta a cada troca. Vive em
   * fiscal_certificados (api/certificado-fiscal.js), nunca em `filiais` —
   * ver 0054_fiscal_certificado.sql pro porquê.
   */
  async function carregarStatusCertificado() {
    if (!podeEditar) return;
    const { data: sessao } = await supabase.auth.getSession();
    const resp = await fetch('/api/certificado-fiscal', {
      headers: { Authorization: `Bearer ${sessao.session?.access_token}` },
    });
    const dados = await resp.json();
    if (resp.ok) setCertStatus(dados);
  }
  useEffect(() => { carregarStatusCertificado(); /* eslint-disable-next-line */ }, [perfil.filial_id]);

  function escolherArquivoCertificado(e) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setErroCert(''); setMsgCert('');
    const leitor = new FileReader();
    leitor.onload = () => {
      // readAsDataURL já devolve base64 (depois de "base64,") — mais simples
      // que montar o base64 na mão a partir do ArrayBuffer.
      const base64 = String(leitor.result).split(',')[1] || '';
      setCertArquivo({ nome: arquivo.name, base64 });
    };
    leitor.onerror = () => setErroCert('Não consegui ler o arquivo.');
    leitor.readAsDataURL(arquivo);
  }

  async function salvarCertificado() {
    setErroCert(''); setMsgCert('');
    if (!certArquivo) { setErroCert('Escolha o arquivo .pfx primeiro.'); return; }
    if (!certSenha) { setErroCert('Digite a senha do certificado.'); return; }
    setSalvandoCert(true);
    try {
      const { data: sessao } = await supabase.auth.getSession();
      const resp = await fetch('/api/certificado-fiscal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session?.access_token}` },
        body: JSON.stringify({ pfxB64: certArquivo.base64, senha: certSenha }),
      });
      const dados = await resp.json();
      if (!resp.ok) { setErroCert(dados.erro || `Falha ao salvar (${resp.status}).`); return; }
      setMsgCert('Certificado salvo.');
      setCertArquivo(null); setCertSenha('');
      carregarStatusCertificado();
    } finally {
      setSalvandoCert(false);
    }
  }

  async function salvar(e) {
    e.preventDefault();
    setErro(''); setSalvo(false);
    const { error } = await supabase.from('filiais').update({
      numero_cliente: filial.numero_cliente || null,
      limite_usuarios_simultaneos: filial.limite_usuarios_simultaneos || null,
      dias_guarda_lancamentos: filial.dias_guarda_lancamentos || null,
      nome_fantasia: filial.nome_fantasia || null,
      endereco: filial.endereco || null,
      numero: filial.numero || null,
      bairro: filial.bairro || null,
      cidade: filial.cidade || null,
      uf: filial.uf || null,
      cep: filial.cep || null,
      cnpj: filial.cnpj || null,
      razao_social: filial.razao_social || null,
      inscricao_mun: filial.inscricao_mun || null,
      inscricao_est: filial.inscricao_est || null,
      cod_ibge: filial.cod_ibge || null,
      config: filial.config || {},
    }).eq('id', filial.id);
    if (error) setErro(error.message); else setSalvo(true);
  }

  /**
   * Exclusão definitiva de movimentos encerrados há mais dias do que
   * `dias_guarda_lancamentos` (ver 0047_limpeza_lancamentos_antigos.sql) —
   * RPS/DPS ainda sem número de NFS-e (não finalizado com a prefeitura)
   * nunca entra, mesmo vencido. Prévia primeiro, sempre: nada some sem o
   * supervisor ver antes quantos registros seriam afetados.
   */
  async function verificarLimpeza() {
    setErroLimpeza(''); setPreviaLimpeza(null);
    const { data, error } = await supabase.rpc('contar_lancamentos_antigos').single();
    if (error) { setErroLimpeza(error.message); return; }
    setPreviaLimpeza(data);
  }

  async function confirmarLimpeza() {
    if (!window.confirm(
      `Excluir definitivamente ${previaLimpeza.elegiveis} movimento(s)? Não tem como desfazer.`
    )) return;
    setLimpando(true); setErroLimpeza('');
    const { data, error } = await supabase.rpc('limpar_lancamentos_antigos');
    setLimpando(false);
    if (error) { setErroLimpeza(error.message); return; }
    setPreviaLimpeza(null);
    window.alert(`${data} movimento(s) excluído(s).`);
  }

  function setPatio(campo, valor) {
    setFilial((f) => ({ ...f, config: { ...f.config, patio: { ...(f.config?.patio || {}), [campo]: valor } } }));
  }

  function setInfinitePay(campo, valor) {
    setFilial((f) => ({ ...f, config: { ...f.config, infinitepay: { ...(f.config?.infinitepay || {}), [campo]: valor } } }));
  }

  function setSemParar(campo, valor) {
    setFilial((f) => ({ ...f, config: { ...f.config, semparar: { ...(f.config?.semparar || {}), [campo]: valor } } }));
  }

  function setNfse(campo, valor) {
    setFilial((f) => ({ ...f, config: { ...f.config, nfse: { ...(f.config?.nfse || {}), [campo]: valor } } }));
  }

  function setNfseAbrasf(campo, valor) {
    setFilial((f) => ({
      ...f,
      config: {
        ...f.config,
        nfse: {
          ...(f.config?.nfse || {}),
          abrasf: { ...(f.config?.nfse?.abrasf || {}), [campo]: valor },
        },
      },
    }));
  }

  return (
    <>
      <div className="card">
        <h2>Aparência</h2>
        <p className="suave">Preferência pessoal deste navegador — não afeta outros usuários/dispositivos.</p>
        <div className="campo" style={{ maxWidth: 220, marginBottom: 14 }}>
          <label>Tema</label>
          <select value={tema} onChange={(e) => mudarTema(e.target.value)}>
            <option value="escuro">Escuro</option>
            <option value="claro">Claro</option>
          </select>
        </div>
        <label className="campo-check">
          <input type="checkbox" checked={imprimeCabine} onChange={(e) => mudarImprimeCabine(e.target.checked)} />
          Este navegador imprime os pedidos vindos do celular
        </label>
        <p className="suave" style={{ fontSize: 11, marginTop: 4 }}>
          Ligue só no navegador fixo da cabine (o mesmo do <code>pdv-cabine.bat</code>, ver{' '}
          <code>docs/CABINE.md</code>) — ele passa a checar a cada poucos segundos se algum
          celular pediu pra imprimir e manda pra impressora daqui, sem passar pelo diálogo do
          sistema. Recarregue a página depois de mudar esta opção.
        </p>
        <p className="aviso" style={{ fontSize: 11, marginTop: 4 }}>
          Marque esta opção <strong>dentro da janela aberta pelo <code>pdv-cabine.bat</code></strong>.
          Ela fica guardada no navegador, e o <code>.bat</code> roda num perfil separado — marcada
          numa janela comum, a janela da cabine continua sem escutar os pedidos do celular.
          Quando estiver valendo, aparece <strong>🖨 cabine</strong> no topo da tela.
        </p>

        {suportaBluetooth && (
          <>
            <label style={{ display: 'block', marginTop: 16 }}>Impressora Bluetooth</label>
            <p className="suave" style={{ marginTop: 2 }}>
              {impressoraBt
                ? <>Pareada neste navegador: <strong>{impressoraBt.nome || 'Impressora Bluetooth'}</strong></>
                : 'Nenhuma impressora pareada neste navegador ainda.'}
            </p>
            {erroBt && <div className="aviso">{erroBt}</div>}
            <div className="linha-form">
              <button className="btn-ghost" onClick={parearBluetooth} disabled={pareandoBt}>
                {pareandoBt ? 'Pareando…' : impressoraBt ? 'Trocar impressora' : 'Parear impressora'}
              </button>
              {impressoraBt && <button className="btn-ghost aviso-btn" onClick={esquecerBluetooth}>Esquecer</button>}
            </div>
            <p className="suave" style={{ fontSize: 11, marginTop: 4 }}>
              Pareando uma vez aqui, o botão "Imprimir Bluetooth" do comprovante reconecta
              sozinho nela dali pra frente — sem abrir esse diálogo de novo a cada ticket. Como
              num cliente normalmente só existe uma impressora, o pareamento vale pra todos os
              tickets deste navegador, até você trocar ou esquecer.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Dados do estacionamento</h2>
        <p className="suave">Aparecem no cabeçalho impresso dos tickets de entrada e saída.</p>
        {erro && <div className="aviso">{erro}</div>}
        {!filial ? 'Carregando…' : (
          <>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ maxWidth: 160 }}>
                  <label>Núm. Cliente</label>
                  <input value={filial.numero_cliente || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, numero_cliente: e.target.value })} />
                  <span className="suave" style={{ fontSize: 11 }}>Aparece antes do nome no cabeçalho da tela.</span>
                </div>
                <div className="campo" style={{ maxWidth: 220 }}>
                  <label>Limite de usuários simultâneos</label>
                  <input type="number" min="1" value={filial.limite_usuarios_simultaneos || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, limite_usuarios_simultaneos: e.target.value ? Number(e.target.value) : null })} />
                  <span className="suave" style={{ fontSize: 11 }}>Em branco = sem limite. Login extra fica bloqueado até alguém sair.</span>
                </div>
                <div className="campo" style={{ maxWidth: 220 }}>
                  <label>Guardar lançamentos por (dias)</label>
                  <input type="number" min="1" value={filial.dias_guarda_lancamentos || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, dias_guarda_lancamentos: e.target.value ? Number(e.target.value) : null })} />
                  <span className="suave" style={{ fontSize: 11 }}>
                    Em branco = limpeza desligada. O supervisor exclui em "Limpeza de lançamentos
                    antigos" abaixo — RPS/DPS ainda sem NFS-e nunca é excluído.
                  </span>
                </div>
              </div>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ flex: 1, maxWidth: 420 }}>
                  <label>Nome</label>
                  <input value={filial.nome_fantasia || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, nome_fantasia: e.target.value })} />
                  <span className="suave" style={{ fontSize: 11 }}>
                    Aparece no cabeçalho do ticket, BI e menu. Se ficar grande demais na
                    impressora de 58mm, encurte aqui ou tire o destaque grande do @ER@ em
                    Modelos de ticket.
                  </span>
                </div>
                <div className="campo" style={{ flex: 1, maxWidth: 420 }}>
                  <label>Razão social</label>
                  <input value={filial.razao_social || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, razao_social: e.target.value })} />
                  <span className="suave" style={{ fontSize: 11 }}>
                    Só usada no RPS/DPS (nome do prestador na nota fiscal) — não aparece no
                    ticket nem no menu.
                  </span>
                </div>
              </div>
              {podeEditar && (
                <div className="linha-form" style={{ alignItems: 'flex-end', marginBottom: 10 }}>
                  <div className="campo">
                    <label>Logo do estabelecimento</label>
                    <input type="file" accept="image/*" onChange={escolherLogo} disabled={processandoLogo} />
                    <span className="suave" style={{ fontSize: 11 }}>
                      Fica disponível como o token <code>@LOGO@</code> em Modelos de ticket — não
                      entra sozinho em nenhum comprovante, só onde você adicionar o token. Salva
                      junto com o botão "Salvar" desta tela.
                    </span>
                  </div>
                  {processandoLogo && <span className="suave">Processando…</span>}
                  {filial.config?.logo && !processandoLogo && (
                    <>
                      <img src={filial.config.logo.dataUrl} alt="Logo atual" style={{ maxWidth: 100, maxHeight: 60, border: '1px solid var(--linha)', borderRadius: 6 }} />
                      <div className="campo" style={{ maxWidth: 240 }}>
                        <label>
                          Tamanho: {filial.config.logo.percentual ?? PERCENTUAL_PADRAO}%
                          {' '}(≈ {Math.round(LARGURA_PAPEL_DOTS * (filial.config.logo.percentual ?? PERCENTUAL_PADRAO) / 100 / 8)} mm de largura)
                        </label>
                        <input type="range" min="10" max="100" step="5"
                          key={filial.config.logo.percentual ?? PERCENTUAL_PADRAO}
                          defaultValue={filial.config.logo.percentual ?? PERCENTUAL_PADRAO}
                          onPointerUp={(e) => mudarTamanhoLogo(Number(e.target.value))}
                          onKeyUp={(e) => mudarTamanhoLogo(Number(e.target.value))} />
                        <span className="suave" style={{ fontSize: 11 }}>
                          100% = largura toda da bobina de 58mm. Maior demora mais pra sair no Bluetooth.
                        </span>
                      </div>
                      <button type="button" className="btn-ghost" onClick={removerLogo}>Remover logo</button>
                    </>
                  )}
                </div>
              )}
              {erroLogo && <div className="aviso" style={{ marginBottom: 10 }}>{erroLogo}</div>}
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ flex: 2 }}>
                  <label>Endereço</label>
                  <input value={filial.endereco || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, endereco: e.target.value })} />
                </div>
                <div className="campo" style={{ width: 90 }}>
                  <label>Número</label>
                  <input value={filial.numero || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, numero: e.target.value })} />
                </div>
              </div>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ flex: 2 }}>
                  <label>Bairro</label>
                  <input value={filial.bairro || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, bairro: e.target.value })} />
                </div>
                <div className="campo" style={{ width: 70 }}>
                  <label>UF</label>
                  <input className="mono" style={{ textTransform: 'uppercase' }} maxLength={2}
                    value={filial.uf || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, uf: e.target.value.toUpperCase() })} />
                </div>
                <div className="campo" style={{ width: 130 }}>
                  <label>CEP</label>
                  <input value={filial.cep || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, cep: e.target.value })} />
                </div>
              </div>
              <div className="linha-form" style={{ marginBottom: 10 }}>
                <div className="campo" style={{ flex: 2, maxWidth: 300 }}>
                  <label>CNPJ</label>
                  <input value={filial.cnpj || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, cnpj: e.target.value })} />
                </div>
                <div className="campo" style={{ maxWidth: 200 }}>
                  <label>Fone</label>
                  <input value={filial.inscricao_est || ''} disabled={!podeEditar}
                    onChange={(e) => setFilial({ ...filial, inscricao_est: e.target.value })} />
                  <span className="suave" style={{ fontSize: 11 }}>Aparece no cabeçalho impresso (token @FONE@).</span>
                </div>
              </div>
              <label className="campo-check" style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={filial.config?.patio?.imprimeTicketMensalista ?? true} disabled={!podeEditar}
                  onChange={(e) => setPatio('imprimeTicketMensalista', e.target.checked)} />
                Imprime ticket para mensalista/hóspede?
              </label>
              <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
                Desmarcado, a entrada e a saída de mensalistas/hóspedes não param na tela do
                comprovante. Quem entra/sai cobrado como avulso (fora do vencimento, vaga
                esgotada, fora do horário contratado) continua sempre mostrando o ticket.
              </p>
              <label className="campo-check" style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={filial.config?.patio?.usaLeituraPlaca ?? true} disabled={!podeEditar}
                  onChange={(e) => setPatio('usaLeituraPlaca', e.target.checked)} />
                Usa leitura de placa por foto (câmera)?
              </label>
              <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
                Desmarcado, o botão de câmera (📷) some da tela de Entrada de veículo e do
                cadastro de veículo do mensalista — digitar a placa continua funcionando normal.
              </p>
              <label className="campo-check" style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={filial.config?.patio?.usaDitadoPlaca ?? false} disabled={!podeEditar}
                  onChange={(e) => setPatio('usaDitadoPlaca', e.target.checked)} />
                Usa entrada de placa por voz (microfone)?
              </label>
              <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
                Recurso novo, desligado por padrão — liga o botão de microfone (🎤) na tela de
                Entrada de veículo. Usa o reconhecimento de voz do próprio navegador (só funciona
                no Chrome/Android; sem custo, sem servidor); nunca preenche a placa sozinho —
                sempre mostra o texto reconhecido pra conferir/corrigir antes de usar.
              </p>
              <label className="campo-check" style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={filial.config?.patio?.usaReservas ?? true} disabled={!podeEditar}
                  onChange={(e) => setPatio('usaReservas', e.target.checked)} />
                Usa reservas de vaga?
              </label>
              <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
                Desmarcado, o item "Reservas de vaga" some do menu principal — pra quem não
                trabalha com reserva antecipada, evita uma tela sem uso.
              </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Cobrança por aproximação (InfiniteTap)</h2>
        <p className="suave">
          O celular do operador vira a maquininha: o cliente aproxima o cartão no próprio
          aparelho, sem leitor separado. Ligado, aparece um botão <strong>"Cobrar no
          celular"</strong> na saída do pátio quando a forma de pagamento é cartão — ele abre
          o app da InfinitePay já com o valor preenchido. Só cartão (crédito/débito); Pix não
          faz parte dessa integração.
        </p>
        {!filial ? 'Carregando…' : (
          <>
            <label className="campo-check" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={!!filial.config?.infinitepay?.ativo} disabled={!podeEditar}
                onChange={(e) => setInfinitePay('ativo', e.target.checked)} />
              Usa o InfiniteTap nesta filial
            </label>
            <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              Exige o app da InfinitePay instalado e logado no mesmo celular, com a conta do
              estacionamento. O botão só aparece no celular — no PC da cabine não, porque a
              leitura é pelo NFC do aparelho. Marque quais formas são crédito/débito em
              Cadastros → Formas de pagamento.
            </p>
            <div className="campo" style={{ marginBottom: 10, maxWidth: 260 }}>
              <label>Handle da conta InfinitePay (opcional)</label>
              <input value={filial.config?.infinitepay?.handle || ''} disabled={!podeEditar}
                placeholder="nome_da_conta" onChange={(e) => setInfinitePay('handle', e.target.value.trim())} />
              <span className="suave" style={{ fontSize: 11 }}>
                Serve pro app conferir que está logado na conta certa antes de cobrar. O CNPJ
                usado nessa checagem é o do cadastro acima — não precisa digitar de novo.
              </span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Sem Parar</h2>
        <p className="suave">
          Pagamento por placa: na entrada o esta pergunta ao Sem Parar se o veículo pode pagar
          assim aqui; se puder, na saída aparece marcada a forma "Sem Parar" (ver Cadastros →
          Formas de pagamento) — só cobra se o operador escolher essa forma. Ver{' '}
          <code>docs/SEMPARAR.md</code>.
        </p>
        {!filial ? 'Carregando…' : (
          <>
            <label className="campo-check" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={!!filial.config?.semparar?.ativo} disabled={!podeEditar}
                onChange={(e) => setSemParar('ativo', e.target.checked)} />
              Usa o Sem Parar nesta filial
            </label>
            <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              A chave da integradora (x-api-key) é uma só pra todos os clientes do esta e fica só
              nas variáveis de ambiente do Vercel — nunca aqui. Código e hash abaixo são só desta
              filial, o Sem Parar entrega os dois juntos.
            </p>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ maxWidth: 200 }}>
                <label>Código do estabelecimento</label>
                <input value={filial.config?.semparar?.codigoEstabelecimento || ''} disabled={!podeEditar}
                  onChange={(e) => setSemParar('codigoEstabelecimento', e.target.value.trim())} />
              </div>
              <div className="campo" style={{ maxWidth: 320 }}>
                <label>Hash do estabelecimento</label>
                <input className="mono" value={filial.config?.semparar?.hash || ''} disabled={!podeEditar}
                  onChange={(e) => setSemParar('hash', e.target.value.trim())} />
              </div>
            </div>
          </>
        )}
      </div>

      {podeLimpar && (
        <div className="card">
          <h2>Limpeza de lançamentos antigos</h2>
          <p className="suave">
            Exclui definitivamente (sem recuperação) movimentos do pátio já encerrados
            há mais dias do que o configurado ao lado — junto com pagamentos, serviços
            e a nota fiscal (RPS/DPS) ligados a eles. RPS/DPS gerado mas ainda sem
            número de NFS-e (não finalizado com a prefeitura) nunca é excluído, mesmo
            vencido.
          </p>
          {erroLimpeza && <div className="aviso">{erroLimpeza}</div>}
          {!filial ? 'Carregando…' : !filial.dias_guarda_lancamentos ? (
            <p className="suave">
              Dias de guarda não configurado — peça pro suporte definir em "Dados do
              estacionamento" (só o fornecedor mexe nisso).
            </p>
          ) : (
            <>
              <button className="btn-ghost" onClick={verificarLimpeza}>Verificar o que seria excluído</button>
              {previaLimpeza && (
                <p className="suave" style={{ marginTop: 10 }}>
                  <strong>{previaLimpeza.elegiveis}</strong> movimento(s) anterior(es) a{' '}
                  {previaLimpeza.dias} dias
                  {previaLimpeza.notas_junto > 0 && <>, incluindo <strong>{previaLimpeza.notas_junto}</strong> nota(s) fiscal(is) já finalizada(s)</>}.
                  {previaLimpeza.protegidos > 0 && (
                    <> {previaLimpeza.protegidos} ficam de fora por ainda terem RPS/DPS sem número de NFS-e.</>
                  )}
                  {previaLimpeza.elegiveis > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn-primary aviso-btn" onClick={confirmarLimpeza} disabled={limpando}>
                        {limpando ? 'Excluindo…' : 'Excluir definitivamente'}
                      </button>
                    </div>
                  )}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>Fiscal (NFS-e)</h2>
        <p className="suave">
          Necessários pra gerar e enviar o DPS/NFS-e (Sistema Nacional NFS-e). Sem eles
          o documento é rejeitado mesmo assinado corretamente.
        </p>

        {podeEditar && (
          <div style={{ border: '1px solid var(--linha)', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>Certificado digital (.pfx) desta filial</label>
            <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 8 }}>
              Assina e autentica o envio do RPS/DPS pra prefeitura — cada filial (CNPJ) tem o seu
              próprio, nunca compartilhado com outra. Depois de salvo, o arquivo e a senha não
              aparecem mais aqui, nem em lugar nenhum do app — só é possível trocar por outro.
            </p>
            {certStatus && (
              <p className="suave" style={{ marginBottom: 8 }}>
                {certStatus.configurado
                  ? <>Certificado configurado — atualizado em {new Date(certStatus.atualizadoEm).toLocaleString('pt-BR')}.</>
                  : 'Nenhum certificado configurado ainda pra esta filial.'}
              </p>
            )}
            <div className="linha-form" style={{ alignItems: 'flex-end', marginBottom: 6 }}>
              <div className="campo">
                <label>Arquivo .pfx</label>
                <input type="file" accept=".pfx,.p12" onChange={escolherArquivoCertificado} />
                {certArquivo && <p className="suave" style={{ fontSize: 11, margin: '4px 0 0' }}>{certArquivo.nome}</p>}
              </div>
              <div className="campo" style={{ maxWidth: 200 }}>
                <label>Senha do certificado</label>
                <input type="password" value={certSenha} onChange={(e) => setCertSenha(e.target.value)} />
              </div>
              <button type="button" className="btn-ghost" onClick={salvarCertificado} disabled={salvandoCert}>
                {salvandoCert ? 'Salvando…' : 'Salvar certificado'}
              </button>
            </div>
            {erroCert && <p className="aviso">{erroCert}</p>}
            {msgCert && <p className="ok-txt">{msgCert}</p>}
          </div>
        )}

        {!filial ? 'Carregando…' : (
          <form onSubmit={salvar}>
            <label className="campo-check" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={nfseAtivo(filial)} disabled={!podeEditar}
                onChange={(e) => setNfse('habilitado', e.target.checked)} />
              Esta filial está habilitada pela prefeitura pra emitir NFS-e/RPS/DPS?
            </label>
            <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              Desmarcado, a opção "NFS-e / RPS/DPS" some do menu principal e o botão "Gerar DPS"
              some da saída do pátio — evita mexer numa rotina fiscal que o cliente ainda não usa.
              Os campos abaixo continuam aqui, prontos pra quando a liberação da prefeitura sair.
            </p>
            <label className="campo-check" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={!!filial.config?.nfse?.emitirTodaSaida} disabled={!podeEditar}
                onChange={(e) => setNfse('emitirTodaSaida', e.target.checked)} />
              Emitir RPS/DPS em todas as saídas de veículo?
            </label>
            <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              Marcado, a tela de saída do pátio já abre sozinha pedindo o CPF/CNPJ do tomador
              (pode deixar em branco pra emitir sem identificação) sempre que houver valor certo
              a cobrar — sem precisar lembrar de ir em "Mais opções → Gerar DPS" toda vez. Dá pra
              cancelar esse pedido numa saída específica sem perder o valor calculado; só não
              gera o documento fiscal daquela vez.
            </p>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ maxWidth: 220 }}>
                <label>Inscrição municipal</label>
                <input value={filial.inscricao_mun || ''} disabled={!podeEditar}
                  onChange={(e) => setFilial({ ...filial, inscricao_mun: e.target.value })} />
              </div>
              <div style={{ maxWidth: 260 }}>
                <CidadeBusca disabled={!podeEditar} label="Cidade (código IBGE)"
                  valor={filial.cidade && filial.uf ? `${filial.cidade} - ${filial.uf}` : (filial.cod_ibge || '')}
                  onSelecionar={(mun) => setFilial({ ...filial, cidade: mun.nome, uf: mun.uf, cod_ibge: mun.codigo })} />
              </div>
              <div className="campo" style={{ maxWidth: 120 }}>
                <label>Série do DPS</label>
                <input value={filial.config?.nfse?.serie || ''} disabled={!podeEditar}
                  onChange={(e) => setNfse('serie', e.target.value)} />
              </div>
            </div>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ maxWidth: 220 }}>
                <label>Código de tributação nacional</label>
                <input value={filial.config?.nfse?.codTribNacional || ''} disabled={!podeEditar}
                  maxLength={6} onChange={(e) => setNfse('codTribNacional', e.target.value)} />
                <span className="suave" style={{ fontSize: 11 }}>
                  6 dígitos, lista da LC 116/2003 — confirme com o contador ou veja o que o
                  sistema antigo (DSF) já usava. Não é o CNAE.
                </span>
              </div>
              <div className="campo" style={{ maxWidth: 160 }}>
                <label>Código de tributação municipal</label>
                <input value={filial.config?.nfse?.codTribMunicipal || ''} disabled={!podeEditar}
                  maxLength={4} onChange={(e) => setNfse('codTribMunicipal', e.target.value)} />
                <span className="suave" style={{ fontSize: 11 }}>
                  4 dígitos, exigido por Campinas além do código nacional — confirme com o contador.
                </span>
              </div>
              <div className="campo" style={{ maxWidth: 120 }}>
                <label>% ISS</label>
                <input type="number" step="0.0001" min="0" value={filial.config?.nfse?.perc_iss ?? ''} disabled={!podeEditar}
                  onChange={(e) => setNfse('perc_iss', e.target.value)} />
              </div>
              <div className="campo" style={{ maxWidth: 200 }}>
                <label>Ambiente de envio</label>
                <select value={filial.config?.nfse?.ambiente || 'homologacao'} disabled={!podeEditar}
                  onChange={(e) => setNfse('ambiente', e.target.value)}>
                  <option value="homologacao">Homologação (teste)</option>
                  <option value="producao">Produção (nota de verdade)</option>
                </select>
                <span className="suave" style={{ fontSize: 11 }}>Só mude pra Produção depois de validar em Homologação.</span>
              </div>
            </div>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ maxWidth: 300 }}>
                <label>Padrão de envio</label>
                <select value={filial.config?.nfse?.padrao || 'padrao_nacional_campinas'} disabled={!podeEditar}
                  onChange={(e) => setNfse('padrao', e.target.value)}>
                  <option value="padrao_nacional">Padrão Nacional</option>
                  <option value="padrao_nacional_campinas">Padrão Nacional Campinas</option>
                  <option value="abrasf">ABRASF</option>
                </select>
                <span className="suave" style={{ fontSize: 11 }}>
                  Hoje Campinas emite em produção pelo ABRASF — é o que deve ficar
                  selecionado (campos específicos dele logo abaixo). Padrão Nacional
                  Campinas o esta também sabe gerar/enviar, mas ainda não entrou em
                  operação na prefeitura. Padrão Nacional (ADN compartilhado) é pra
                  quando Campinas migrar pra lá — sem previsão, envio bloqueado.
                </span>
              </div>
              <div className="campo" style={{ maxWidth: 300 }}>
                <label>Regime tributário (Simples Nacional)</label>
                <select value={filial.config?.nfse?.opSimpNac || ''} disabled={!podeEditar}
                  onChange={(e) => setNfse('opSimpNac', e.target.value)}>
                  <option value="">— confirme com o contador —</option>
                  <option value="1">Não optante</option>
                  <option value="2">Optante — Microempresa municipal/ME/EPP</option>
                  <option value="3">Optante — Outros</option>
                </select>
                <span className="suave" style={{ fontSize: 11 }}>
                  Exigido pelo governo no DPS. Confirme com o contador antes de enviar — errar
                  isso classifica errado o regime tributário da empresa.
                </span>
              </div>
            </div>

            <h3 style={{ marginTop: 4 }}>ABRASF (Campinas)</h3>
            <p className="suave" style={{ marginTop: -6, marginBottom: 10 }}>
              Só usados quando "Padrão de envio" acima é ABRASF — é diferente do Padrão
              Nacional (não usa código de tributação municipal, por exemplo).
            </p>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ maxWidth: 160 }}>
                <label>CNAE (Campinas)</label>
                <input value={filial.config?.nfse?.abrasf?.codigoCnae || ''} disabled={!podeEditar}
                  maxLength={9} onChange={(e) => setNfseAbrasf('codigoCnae', e.target.value)} />
                <span className="suave" style={{ fontSize: 11 }}>
                  9 dígitos, tabela própria de Campinas (drm-codae.campinas.sp.gov.br/cnae.php) —
                  não é o CNAE do IBGE (7 dígitos).
                </span>
              </div>
              <div className="campo" style={{ maxWidth: 140 }}>
                <label>Item lista serviço</label>
                <input value={filial.config?.nfse?.abrasf?.itemListaServico || ''} disabled={!podeEditar}
                  placeholder="11.01" onChange={(e) => setNfseAbrasf('itemListaServico', e.target.value)} />
                <span className="suave" style={{ fontSize: 11 }}>LC 116/2003 — "11.01" é Guarda e estacionamento de veículos.</span>
              </div>
              <div className="campo" style={{ maxWidth: 120 }}>
                <label>% tributos (Lei 12.741)</label>
                <input type="number" step="0.01" min="0" value={filial.config?.nfse?.abrasf?.percTributosLei12741 ?? ''} disabled={!podeEditar}
                  onChange={(e) => setNfseAbrasf('percTributosLei12741', e.target.value)} />
                <span className="suave" style={{ fontSize: 11 }}>Vai no texto de discriminação da nota (aviso da Lei 12.741/2012).</span>
              </div>
              <div className="campo" style={{ maxWidth: 100 }}>
                <label>Série RPS</label>
                <input value={filial.config?.nfse?.abrasf?.serie || ''} disabled={!podeEditar}
                  placeholder="99" onChange={(e) => setNfseAbrasf('serie', e.target.value)} />
              </div>
            </div>
            <div className="linha-form" style={{ marginBottom: 10 }}>
              <div className="campo" style={{ maxWidth: 200 }}>
                <label>Optante Simples Nacional</label>
                <select value={filial.config?.nfse?.abrasf?.optanteSimplesNacional || '1'} disabled={!podeEditar}
                  onChange={(e) => setNfseAbrasf('optanteSimplesNacional', e.target.value)}>
                  <option value="1">Sim</option>
                  <option value="2">Não</option>
                </select>
              </div>
              <div className="campo" style={{ maxWidth: 160 }}>
                <label>Incentivo fiscal</label>
                <select value={filial.config?.nfse?.abrasf?.incentivoFiscal || '2'} disabled={!podeEditar}
                  onChange={(e) => setNfseAbrasf('incentivoFiscal', e.target.value)}>
                  <option value="1">Sim</option>
                  <option value="2">Não</option>
                </select>
              </div>
              <div className="campo" style={{ maxWidth: 160 }}>
                <label>ISS retido pelo tomador</label>
                <select value={filial.config?.nfse?.abrasf?.issRetido || '2'} disabled={!podeEditar}
                  onChange={(e) => setNfseAbrasf('issRetido', e.target.value)}>
                  <option value="1">Sim</option>
                  <option value="2">Não</option>
                </select>
              </div>
            </div>

            <p className="suave" style={{ fontSize: 11, marginTop: 0, marginBottom: 10 }}>
              Este botão grava de uma vez tudo desta tela — Dados do estacionamento, InfiniteTap,
              Sem Parar e Fiscal.
            </p>
            {erro && <div className="aviso">{erro}</div>}
            {salvo && <p className="ok-txt">Salvo.</p>}
            {podeEditar
              ? <button className="btn-primary" type="submit">Salvar</button>
              : <p className="suave">Somente leitura — esses dados só são alterados pelo fornecedor do sistema.</p>}
          </form>
        )}
      </div>
    </>
  );
}
