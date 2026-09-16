import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { hojeISO, proximoVencimento, primeiroVencimento, diferencaEmDias, dentroDoVencimento, fmtDataBR, fmtBRL } from '../lib/tempo.js';
import { receberMensalidade, ticketRecebimentoComModelo, descricaoForma } from '../lib/mensalidade.js';
import { criarNotaFiscal } from '../lib/notaFiscal.js';
import { AR_PARA_ABRASF } from '../lib/issRetido.js';
import { nfseAtivo } from '../lib/acesso.js';
import { carregarModelosTicket } from '../lib/dados.js';
import { montarTicketRps } from '../lib/dadosTicket.js';
import AbrirCaixaInline from './AbrirCaixaInline.jsx';

/**
 * Recebimento da mensalidade: valor sugerido pelo cadastro, forma de pagamento e
 * próximo pagamento calculado com o dia de vencimento fixo do cadastro (não no
 * dia do pagamento). Primeira mensalidade (sem vencimento anterior no
 * cadastro): o primeiro vencimento cai na próxima ocorrência do dia fixo, e o
 * valor sugerido é proporcional aos dias até lá.
 */
export function ReceberModal({ mensalista, formas, semCaixa, perfil, filial, onAbrirCaixa, onConfirmar, onFechar }) {
  const hoje = hojeISO();
  const primeiraMensalidade = !mensalista.proximo_pagamento;
  // Base do próximo vencimento: a data que está no cadastro (a competência que
  // está sendo paga); sem ela (primeira mensalidade), a data do pagamento.
  const base = mensalista.proximo_pagamento || hoje;
  const proximoInicial = primeiraMensalidade
    ? primeiroVencimento(base, mensalista.dia_venc)
    : proximoVencimento(base, mensalista.dia_venc);
  const diasProporcionaisIniciais = primeiraMensalidade && mensalista.dia_venc
    ? diferencaEmDias(base, proximoInicial) : null;
  const valorInicial = diasProporcionaisIniciais != null
    ? Number(((Number(mensalista.valor_mensalidade || 0) / 30) * diasProporcionaisIniciais).toFixed(2))
    : Number(mensalista.valor_mensalidade || 0);

  const [dtPagamento, setDtPagamento] = useState(hoje);
  const [valor, setValor] = useState(String(valorInicial));
  const [forma, setForma] = useState('');
  const [proximo, setProximo] = useState(proximoInicial);
  const [observacao, setObservacao] = useState('');
  const [gerarNota, setGerarNota] = useState(nfseAtivo(filial) && !!mensalista.cpf_cnpj);

  // Forma padrão = dinheiro (como na saída do pátio).
  useEffect(() => {
    if (!forma && formas.length) setForma(formas.find((f) => f.eh_dinheiro)?.codigo || formas[0].codigo);
    // eslint-disable-next-line
  }, [formas]);

  const semFormas = formas.length === 0;
  const valorInvalido = !(Number(valor) > 0);

  // Sugestão ao vivo (segue a "Data do pagamento" digitada) — só informativa;
  // "Data do pagamento" e "Próximo pagamento" continuam livres pra editar.
  const sugestaoAoVivo = primeiraMensalidade && mensalista.dia_venc
    ? (() => {
        const proximoVivo = primeiroVencimento(dtPagamento, mensalista.dia_venc);
        const dias = diferencaEmDias(dtPagamento, proximoVivo);
        const valorVivo = Number(((Number(mensalista.valor_mensalidade || 0) / 30) * dias).toFixed(2));
        return { proximo: proximoVivo, dias, valor: valorVivo };
      })()
    : null;

  function usarSugestao() {
    setProximo(sugestaoAoVivo.proximo);
    setValor(String(sugestaoAoVivo.valor));
  }

  return (
    <div className="modal-bg" onClick={onFechar}>
      {/* min(...) + maxHeight: em tela estreita (celular na cabine) o modal
          encolhe e rola, em vez de cortar os botões de baixo. */}
      <div className="modal" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 92vw)', maxHeight: '85vh', overflow: 'auto' }}>
        <h2>Receber mensalidade — {mensalista.razao}</h2>
        <p className="suave" style={{ marginTop: -4 }}>
          {primeiraMensalidade
            ? `Primeira mensalidade${mensalista.dia_venc ? ` · vencimento fixo dia ${mensalista.dia_venc}, período até lá cobrado proporcional` : ''}`
            : `Vencimento no cadastro: ${fmtDataBR(mensalista.proximo_pagamento)}`}
          {!mensalista.dia_venc && ' · sem "Dia vencimento" no cadastro (o próximo cai no mesmo dia do mês seguinte)'}
        </p>
        {semCaixa ? (
          <>
            <AbrirCaixaInline perfil={perfil} onAberto={onAbrirCaixa} />
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
            </div>
          </>
        ) : (
        <form onSubmit={(e) => { e.preventDefault(); onConfirmar({ mensalista, dtPagamento, valor, forma, proximo, observacao, gerarNota }); }}>
          <div className="linha-form" style={{ marginBottom: 10 }}>
            <div className="campo" style={{ flex: "1 1 180px", minWidth: 0 }}>
              <label>Data do pagamento</label>
              <input type="date" value={dtPagamento} onChange={(e) => setDtPagamento(e.target.value)} required />
            </div>
            <div className="campo" style={{ flex: "1 1 180px", minWidth: 0 }}>
              <label>Valor pago</label>
              <input type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} required />
              {Number(mensalista.valor_mensalidade || 0) > 0 && (
                <span className="suave" style={{ fontSize: 11 }}>Cadastro: {fmtBRL(Number(mensalista.valor_mensalidade))}</span>
              )}
            </div>
          </div>
          <div className="linha-form" style={{ marginBottom: 10 }}>
            <div className="campo" style={{ flex: "1 1 180px", minWidth: 0 }}>
              <label>Forma de pagamento</label>
              <select value={forma} onChange={(e) => setForma(e.target.value)} required>
                {formas.map((f) => <option key={f.codigo} value={f.codigo}>{f.descricao}</option>)}
              </select>
              {semFormas && <span className="suave" style={{ fontSize: 11 }}>Nenhuma forma ativa — cadastre em Cadastros.</span>}
            </div>
            <div className="campo" style={{ flex: "1 1 180px", minWidth: 0 }}>
              <label>Próximo pagamento</label>
              <input type="date" value={proximo} onChange={(e) => setProximo(e.target.value)} required />
              {!dentroDoVencimento(proximo, 0) && (
                <span className="suave" style={{ fontSize: 11 }}>Continua vencido (pagamento em atraso).</span>
              )}
            </div>
          </div>
          {/* Sugestão da 1ª mensalidade fica junto dos campos que ela altera. */}
          {sugestaoAoVivo && (sugestaoAoVivo.proximo !== proximo || String(sugestaoAoVivo.valor) !== valor) && (
            <p className="suave" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>
              Pela data acima: {sugestaoAoVivo.dias} dia(s) até {fmtDataBR(sugestaoAoVivo.proximo)},
              {' '}proporcional {fmtBRL(sugestaoAoVivo.valor)}.{' '}
              <button type="button" className="btn-ghost" onClick={usarSugestao} style={{ padding: '2px 8px' }}>Usar</button>
            </p>
          )}
          <div className="campo" style={{ marginBottom: 10 }}>
            <label>Observação (opcional)</label>
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          {nfseAtivo(filial) && (
            <label className="campo-check" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={gerarNota} onChange={(e) => setGerarNota(e.target.checked)} />
              Gerar nota fiscal (DPS)
              {!mensalista.cpf_cnpj && <span className="suave"> — mensalista sem CPF/CNPJ, sai sem identificação</span>}
            </label>
          )}
          {valorInvalido && <p className="aviso">Informe o valor pago.</p>}
          <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={semFormas || valorInvalido}>Confirmar recebimento</button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

/** Lista de mensalistas ativos em ordem alfabética, com busca por nome/código. */
function SelecionarMensalistaModal({ onSelecionar, onFechar }) {
  const [lista, setLista] = useState([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    supabase.from('mensalistas').select('*').eq('ativo', true).order('razao')
      .then(({ data }) => { setLista(data || []); setCarregando(false); });
  }, []);

  const alvo = busca.trim().toLowerCase();
  const filtrada = alvo
    ? lista.filter((m) => m.razao.toLowerCase().includes(alvo) || m.codigo.toLowerCase().includes(alvo))
    : lista;

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: '85vh', overflow: 'auto' }}>
        <h2>Receber mensalidade</h2>
        <p className="suave">Selecione o mensalista (ordem alfabética).</p>
        <div className="campo" style={{ marginBottom: 10 }}>
          <label>Buscar</label>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código…" autoFocus />
        </div>
        <div className="tabela-scroll">
          <table>
            <tbody>
              {filtrada.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.razao}
                    {!dentroDoVencimento(m.proximo_pagamento, m.tolerancia_dias) && (
                      <span className="status status-cancelada" style={{ marginLeft: 6 }}>Vencida</span>
                    )}
                    <div className="suave" style={{ fontSize: 12 }}>
                      {m.codigo} · próx. pagamento {fmtDataBR(m.proximo_pagamento)}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-primary" onClick={() => onSelecionar(m)}>Receber</button>
                  </td>
                </tr>
              ))}
              {!carregando && filtrada.length === 0 && (
                <tr><td colSpan={2} className="suave">Nenhum mensalista encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Fluxo completo de recebimento, autocontido: lista alfabética de mensalistas
 * -> formulário de recebimento -> grava e devolve o ticket pro chamador
 * imprimir/mostrar (o chamador já tem seu próprio modal de ticket, ex.: Pátio
 * e Mensalistas). `onConcluido(ticket, celularSugerido)` fecha o fluxo.
 */
export default function ReceberMensalidadeFluxo({ perfil, formas, caixaAberto, onCaixaAberto, onConcluido, onFechar, filial }) {
  const [mensalista, setMensalista] = useState(null); // null = ainda escolhendo na lista
  const [erro, setErro] = useState('');

  async function confirmar({ mensalista: m, dtPagamento, valor, forma, proximo, observacao, gerarNota }) {
    setErro('');
    const { error, pagamento } = await receberMensalidade({ perfil, mensalista: m, dtPagamento, valor, forma, proximo, observacao });
    if (error) { setErro(error); return; }
    let ticketRps = null;
    if (gerarNota && nfseAtivo(filial)) {
      // Best-effort (mesmo espírito da fidelidade no Pátio): o pagamento já
      // está gravado, uma falha aqui não pode travar o comprovante — se der
      // errado, a nota simplesmente não aparece em Fiscal.
      try {
        const { nota, filial } = await criarNotaFiscal(supabase, {
          filialId: perfil.filial_id, competencia: dtPagamento, valor,
          descricao: 'Recebimento de Mensalista',
          tomador: {
            cpf_cnpj: m.cpf_cnpj, nome: m.razao, endereco: m.endereco, numero: m.numero,
            bairro: m.bairro, cidade: m.cidade, uf: m.uf, cep: m.cep, cod_ibge: m.cod_ibge,
            telefone: m.telefone, email: m.email,
            issRetido: m.iss_retido ? AR_PARA_ABRASF[m.iss_retido] : null,
          },
        });
        if (nota) {
          const modelos = await carregarModelosTicket();
          ticketRps = montarTicketRps({ nota, filial, modelo: modelos.rps });
        }
      } catch { /* nota fiscal é best-effort aqui */ }
    }
    const ticket = await ticketRecebimentoComModelo({
      mensalista: m, dtPagamento, valor, proximo, recibo: pagamento?.id,
      formaDescricao: descricaoForma(formas, forma), operador: perfil.nome,
    });
    // Com nota gerada, o comprovante ganha o botão "Imprimir RPS".
    onConcluido({ ...ticket, ticketRps }, m.celular || '');
  }

  if (!mensalista) {
    return <SelecionarMensalistaModal onSelecionar={setMensalista} onFechar={onFechar} />;
  }
  return (
    <>
      {erro && <div className="modal-bg" onClick={() => setErro('')}>
        <div className="modal aviso" onClick={(e) => e.stopPropagation()}>{erro}</div>
      </div>}
      <ReceberModal mensalista={mensalista} formas={formas} semCaixa={!caixaAberto}
        perfil={perfil} filial={filial} onAbrirCaixa={onCaixaAberto}
        onConfirmar={confirmar} onFechar={onFechar} />
    </>
  );
}
