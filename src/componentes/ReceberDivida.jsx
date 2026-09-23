import { useState } from 'react';
import { fmtBRL } from '../lib/tempo.js';
import { buscarDividaDaPlaca, receberDivida } from '../lib/dividas.js';
import AbrirCaixaInline from './AbrirCaixaInline.jsx';

/** Placa -> busca o saldo devedor (clientes.saldo_devedor). */
function BuscarPlacaModal({ perfil, onEncontrado, onFechar }) {
  const [placa, setPlaca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState('');

  async function buscar(e) {
    e.preventDefault();
    setErro(''); setBuscando(true);
    const p = placa.trim().toUpperCase();
    const { error, clienteId, saldo } = await buscarDividaDaPlaca(p, perfil.filial_id);
    setBuscando(false);
    if (error) { setErro(error); return; }
    if (!(saldo > 0)) { setErro(`${p} não tem dívida registrada.`); return; }
    onEncontrado({ placa: p, clienteId, saldo });
  }

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(380px, 92vw)' }}>
        <h2>Receber dívida</h2>
        <p className="suave">Digite a placa pra ver o saldo devedor (ver Pátio, saídas na forma "Devedor").</p>
        <form onSubmit={buscar}>
          <div className="campo">
            <label>Placa</label>
            <input className="mono" style={{ textTransform: 'uppercase' }} value={placa}
              onChange={(e) => { setPlaca(e.target.value); setErro(''); }} autoFocus required />
          </div>
          {erro && <p className="aviso">{erro}</p>}
          <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={buscando || !placa.trim()}>
              {buscando ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Saldo encontrado -> valor (editável, nunca > saldo) + forma de pagamento. */
function ConfirmarRecebimentoModal({ achado, formas, semCaixa, perfil, onAbrirCaixa, onConfirmar, onFechar }) {
  const [valor, setValor] = useState(String(achado.saldo));
  const [forma, setForma] = useState(formas.find((f) => f.eh_dinheiro)?.codigo || formas[0]?.codigo || '');
  const valorNum = Number(valor) || 0;
  const valorInvalido = !(valorNum > 0) || valorNum > achado.saldo + 0.001;

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 92vw)' }}>
        <h2>Receber dívida — <span className="placa mono">{achado.placa}</span></h2>
        <p className="suave" style={{ marginTop: -4 }}>Saldo devedor: {fmtBRL(achado.saldo)}</p>
        {semCaixa ? (
          <>
            <AbrirCaixaInline perfil={perfil} onAberto={onAbrirCaixa} />
            <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
            </div>
          </>
        ) : (
        <form onSubmit={(e) => { e.preventDefault(); onConfirmar({ valor: valorNum, forma }); }}>
          <div className="linha-form" style={{ marginBottom: 10 }}>
            <div className="campo" style={{ flex: 1 }}>
              <label>Valor a receber</label>
              <input type="number" step="0.01" min="0.01" max={achado.saldo} value={valor}
                onChange={(e) => setValor(e.target.value)} required autoFocus />
            </div>
            <div className="campo" style={{ flex: 1 }}>
              <label>Forma de pagamento</label>
              <select value={forma} onChange={(e) => setForma(e.target.value)} required>
                {formas.map((f) => <option key={f.codigo} value={f.codigo}>{f.descricao}</option>)}
              </select>
            </div>
          </div>
          {valorInvalido && valorNum > achado.saldo && (
            <p className="aviso" style={{ fontSize: 12 }}>Não dá pra receber mais do que o saldo devedor.</p>
          )}
          <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={valorInvalido || !forma}>Confirmar recebimento</button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

/**
 * Fluxo completo, autocontido (mesmo espírito de VendaProdutosFluxo): busca
 * por placa -> confirmação (valor + forma) -> grava e devolve o ticket pro
 * chamador imprimir. Ticket sempre no formato simples (sem token
 * customizável) — quitação de dívida nunca gera RPS/NFS-e, a receita já foi
 * faturada na saída que gerou a dívida.
 */
export default function ReceberDividaFluxo({ perfil, formas, caixaAberto, onCaixaAberto, onConcluido, onFechar }) {
  const [achado, setAchado] = useState(null);
  const [erro, setErro] = useState('');

  async function confirmar({ valor, forma }) {
    setErro('');
    const { error, valorPago } = await receberDivida({
      perfil, clienteId: achado.clienteId, placa: achado.placa, saldoAtual: achado.saldo, valor, forma,
    });
    if (error) { setErro(error); return; }
    const formaDescricao = formas.find((f) => f.codigo === forma)?.descricao || forma;
    onConcluido({
      titulo: 'Recebimento de dívida',
      linhas: [
        ['Placa', achado.placa],
        ['Saldo devedor', fmtBRL(achado.saldo)],
        ['Vlr. recebido', fmtBRL(valorPago)],
        ['Forma de pagamento', formaDescricao],
        ['Operador', perfil.nome],
      ],
    });
  }

  if (!achado) {
    return <BuscarPlacaModal perfil={perfil} onEncontrado={setAchado} onFechar={onFechar} />;
  }
  return (
    <>
      {erro && <div className="modal-bg" onClick={() => setErro('')}>
        <div className="modal aviso" onClick={(e) => e.stopPropagation()}>{erro}</div>
      </div>}
      <ConfirmarRecebimentoModal achado={achado} formas={formas} semCaixa={!caixaAberto}
        perfil={perfil} onAbrirCaixa={onCaixaAberto}
        onConfirmar={confirmar} onFechar={onFechar} />
    </>
  );
}
