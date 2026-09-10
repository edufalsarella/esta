// Comprovante/ticket compartilhado (entrada, saída, exclusão, mensalidade).
// Um ticket é `{ titulo, linhas: [[rotulo, valor], ...] }`.
//
// Quando a filial tem modelo cadastrado pro tipo (tabela `modelos_ticket`), o
// ticket vem com `modelo` (o texto com tokens) e `dados` (o mapa token→valor),
// e é ele que manda no layout — nos três destinos: modal, impressão e
// WhatsApp. Sem modelo, cai no layout fixo de `linhas`, como sempre foi.
import { useEffect, useState } from 'react';
import { renderizarModelo, modeloParaTexto } from '../lib/modeloTicket.js';
import { modeloParaEscPos } from '../lib/escpos.js';
import { conectarImpressoraBluetooth } from '../lib/bluetoothPrinter.js';
import { MODELOS_PADRAO } from '../lib/modelosPadrao.js';
import { supabase } from '../lib/supabase.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Estilos do modelo (@PG+@ etc.) viram classes — ver CSS na janela de impressão. */
const CLASSE_ESTILO = {
  grande: 't-grande', pequeno: 't-pequeno', negrito: 't-negrito',
  italico: 't-italico', sublinhado: 't-sublinhado', usuario: 't-usuario',
};

function modeloParaHtml(modelo, dados) {
  return renderizarModelo(modelo, dados)
    .map((trechos) => {
      if (!trechos.length) return '<div class="linha">&nbsp;</div>';
      const conteudo = trechos.map((t) => {
        const classes = t.estilos.map((e) => CLASSE_ESTILO[e]).filter(Boolean).join(' ');
        const texto = escapeHtml(t.texto);
        return classes ? `<span class="${classes}">${texto}</span>` : texto;
      }).join('');
      return `<div class="linha">${conteudo}</div>`;
    })
    .join('');
}

// Token @B@ dentro do MODELO (não é um token de dado — some sozinho em
// qualquer outro destino, ver valorDoToken em modeloTicket.js): em vez de
// virar comando de corte (só daria pra mandar via Bluetooth/ESC-POS, ver
// escpos.js), corta o TICKET em pedaços e imprime cada um como um print()
// separado — em impressora com guilhotina automática (corta sozinha ao
// terminar cada trabalho de impressão), o efeito na prática é o mesmo corte
// no meio do ticket, sem precisar saber o código de corte daquela impressora
// específica. Teste do Eduardo, ver conversa de 2026-08-31.
const TOKEN_CORTE = /@b@/i;

// Respiro entre escrever o documento e mandar imprimir (ver imprimirEmSequencia).
const ESPERA_ENTRE_PRINTS_MS = 400;

const ESTILO_TICKET = `
      /* Bobina de 58mm (a impressora de hoje) — ajustar aqui se algum outro
         cliente tiver bobina de outra largura (80mm é o outro padrão comum).
         "auto" na altura é o que evita a impressora saltar um monte de linha
         em branco no fim: sem isso o navegador imprimia em tamanho de folha
         cheia (Carta/A4) e a impressora "completava a página" com bobina. */
      @page { size: 58mm auto; margin: 0; }
      body { font-family: system-ui, Arial, sans-serif; color: #000; margin: 0; padding: 2mm 3mm; box-sizing: border-box; }
      .nome { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
      .linha-end { font-size: 11px; color: #333; margin-bottom: 2px; }
      hr { border: none; border-top: 1px dashed #999; margin: 10px 0; }
      h2 { font-size: 14px; margin: 0 0 8px; }
      p { font-size: 13px; margin: 4px 0; }
      /* Modelo com tokens: mesma fonte do padrão (body) — só a formatação
         (negrito/tamanho) vem dos estilos do modelo, sem trocar de fonte. */
      .linha { font-size: 12px; white-space: pre-wrap; line-height: 1.35; }
      .t-grande { font-size: 17px; font-weight: 700; }
      .t-pequeno { font-size: 10px; }
      .t-negrito { font-weight: 700; }
      .t-italico { font-style: italic; }
      .t-sublinhado { text-decoration: underline; }
`;

/**
 * Abre UMA janela e imprime `corpos` em sequência — um `print()` por vez, só
 * avança pro próximo depois do `afterprint` do anterior. Importante ser a
 * MESMA janela sempre: abrir uma janela nova a cada pedaço (como era antes)
 * esbarra no bloqueio de pop-up mesmo com o site liberado nas configurações
 * do navegador — `window.open()` chamado de dentro de um callback
 * assíncrono (`afterprint`) não conta como gesto direto do usuário pra
 * boa parte dos navegadores, então só o PRIMEIRO print (o clique real do
 * operador) abre janela sem drama; os demais pedaços reaproveitam essa
 * mesma janela já aberta, sem precisar de outro `window.open()`.
 */
function imprimirEmSequencia(titulo, cabecalho, corpos, avisar) {
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) {
    // Quem imprime sozinho (pedido vindo do celular, ver Layout.jsx) não pode
    // parar num alert que ninguém vai fechar na cabine — só recebe o `false`
    // e registra o erro no pedido.
    if (avisar) {
      window.alert(
        'O navegador bloqueou a janela de impressão. Clique no ícone de pop-up '
        + 'bloqueado na barra de endereço e escolha "Sempre permitir" para este '
        + 'site — na cabine (pdv-cabine.bat/pdv-cabine-edge.bat) isso já vem liberado.'
      );
    }
    return false;
  }
  function imprimirPedaco(i) {
    if (i >= corpos.length) { win.close(); return; }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title>
      <style>${ESTILO_TICKET}</style></head><body>
        ${cabecalho}
        ${corpos[i]}
      </body></html>`;
    // document.open()/write()/close() de novo NA MESMA janela — troca o
    // conteúdo sem abrir outra (ver comentário acima). onafterprint precisa
    // ser reatribuído a cada troca de documento.
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.onafterprint = () => imprimirPedaco(i + 1);
    // Por que setTimeout e não o evento "load": document.close() pode
    // disparar o load de forma SÍNCRONA, antes desta linha — um win.onload
    // atribuído aqui nunca chegaria a rodar (era o bug: a 2ª parte aparecia
    // na tela mas o diálogo nunca abria). O respiro também dá tempo do
    // navegador encerrar o print anterior: print() chamado colado no
    // afterprint do anterior é ignorado em silêncio.
    setTimeout(() => { win.focus(); win.print(); }, ESPERA_ENTRE_PRINTS_MS);
  }
  imprimirPedaco(0);
  return true;
}

/**
 * Impressão numa janela dedicada (não no modal): evita a duplicação de página
 * que ocorre ao imprimir conteúdo dentro de um overlay position:fixed.
 *
 * Devolve `false` quando o navegador bloqueou a janela — quem imprime sozinho
 * (pedidos vindos do celular, ver Layout.jsx) precisa saber disso pra marcar o
 * pedido como erro em vez de dar como impresso e o papel nunca sair.
 * `avisar: false` cala o alert, que na cabine ficaria travando a fila.
 */
export function imprimirTicket(ticket, filial, { avisar = true } = {}) {
  // Com modelo, o cabeçalho do estabelecimento já faz parte do texto (tokens
  // @ER@/@EE@/…) — não repetir aqui.
  const usaModelo = !!ticket.modelo;
  const cabecalho = !usaModelo && filial && (filial.nome_fantasia || filial.endereco || filial.cnpj) ? `
    ${filial.nome_fantasia ? `<div class="nome">${escapeHtml(filial.nome_fantasia)}</div>` : ''}
    ${filial.endereco ? `<div class="linha-end">${escapeHtml(filial.endereco)}</div>` : ''}
    ${filial.cnpj ? `<div class="linha-end">CNPJ: ${escapeHtml(filial.cnpj)}</div>` : ''}
    <hr>` : '';

  if (usaModelo && TOKEN_CORTE.test(ticket.modelo)) {
    // Cada pedaço é renderizado do zero (renderizarModelo/modeloParaHtml) —
    // um @PG+@ aberto antes do @B@ sem o @PG-@ correspondente não vaza pro
    // pedaço seguinte, já que cada print() é um documento HTML novo.
    const pedacos = ticket.modelo.split(TOKEN_CORTE).map((m) => m.trim()).filter(Boolean);
    return imprimirEmSequencia(ticket.titulo, '', pedacos.map((p) => modeloParaHtml(p, ticket.dados)), avisar);
  }

  const corpo = usaModelo
    ? modeloParaHtml(ticket.modelo, ticket.dados)
    : `<h2>${escapeHtml(ticket.titulo)}</h2>`
      + ticket.linhas.map(([r, v]) => `<p><strong>${escapeHtml(r)}:</strong> ${escapeHtml(v)}</p>`).join('');
  return imprimirEmSequencia(ticket.titulo, cabecalho, [corpo], avisar);
}

export function linkWhatsApp(ticket, celular, filial) {
  const cabecalho = !ticket.modelo && filial && (filial.nome_fantasia || filial.endereco || filial.cnpj)
    ? [filial.nome_fantasia, filial.endereco, filial.cnpj ? `CNPJ: ${filial.cnpj}` : null].filter(Boolean).join('\n') + '\n\n'
    : '';
  const texto = ticket.modelo
    ? modeloParaTexto(ticket.modelo, ticket.dados)
    : cabecalho + [ticket.titulo, ...ticket.linhas.map(([r, v]) => `${r}: ${v}`)].join('\n');
  const digitos = (celular || '').replace(/\D/g, '');
  const numero = digitos ? (digitos.startsWith('55') ? digitos : `55${digitos}`) : '';
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * Modal do comprovante, com campo de celular (WhatsApp) e botão de imprimir.
 * `celular`/`onCelular` ficam no chamador para o campo zerar junto com o ticket.
 *
 * Atalhos de teclado (F/W/I) porque na cabine o fluxo é rápido e quase sempre
 * termina em imprimir — sem precisar tirar a mão do teclado pra pegar o mouse.
 *
 * `perfil` (opcional): sem ele, "Imprimir na cabine" não aparece — só quem
 * chama de dentro do app logado tem perfil pra saber a filial do pedido.
 *
 * `placa` (opcional): quando informada (junto com `perfil`), o celular
 * digitado é salvo em `clientes.telefone` ao mandar pelo WhatsApp de
 * verdade — próxima entrada/saída da mesma placa já vem preenchido.
 */
export function TicketModal({ ticket, filial, perfil, celular, placa, onCelular, onFechar }) {
  const [impressoraBt, setImpressoraBt] = useState(null);
  const [statusBt, setStatusBt] = useState('');
  const [statusCabine, setStatusCabine] = useState('');

  async function salvarCelularDoCliente() {
    if (!placa || !perfil || !celular?.trim()) return;
    try {
      const p = placa.trim().toUpperCase();
      const { data: c } = await supabase.from('clientes').select('id, telefone').eq('placa', p).maybeSingle();
      if (c) {
        if (c.telefone !== celular) await supabase.from('clientes').update({ telefone: celular }).eq('id', c.id);
      } else {
        await supabase.from('clientes').insert({ filial_id: perfil.filial_id, placa: p, telefone: celular });
      }
    } catch { /* best-effort, não trava o envio */ }
  }

  // Sem BLE em iPhone/Safari (Apple bloqueia por completo) e só faz sentido
  // pra ticket que já tem o mapa de dados montado (ver comModelo() em
  // Patio.jsx e ticketRecebimentoComModelo() em mensalidade.js).
  const suportaBluetooth = typeof navigator !== 'undefined' && !!navigator.bluetooth && !!ticket.dados;

  async function imprimirBluetooth() {
    setStatusBt('conectando');
    try {
      let impressora = impressoraBt;
      if (!impressora) {
        impressora = await conectarImpressoraBluetooth();
        setImpressoraBt(impressora);
      }
      const modelo = ticket.modelo || MODELOS_PADRAO[ticket.tipo];
      if (!modelo) { setStatusBt('erro: sem modelo pra este tipo de ticket'); return; }
      setStatusBt('imprimindo…');
      await impressora.enviar(modeloParaEscPos(modelo, ticket.dados));
      setStatusBt('impresso ✓');
    } catch (e) {
      setStatusBt(`erro: ${e.message}`);
    }
  }

  async function imprimirNaCabine() {
    setStatusCabine('enviando…');
    const { error } = await supabase.from('print_jobs').insert({
      filial_id: perfil.filial_id, criado_por: perfil.id,
      ticket: { titulo: ticket.titulo, linhas: ticket.linhas, modelo: ticket.modelo, dados: ticket.dados },
    });
    setStatusCabine(error ? `erro: ${error.message}` : 'pedido enviado ✓');
  }

  useEffect(() => {
    function aoTeclar(e) {
      // Digitando o celular (ou qualquer campo)? Atalho não vale — senão um
      // "9" tudo bem, mas o "F" de um telefone fecharia o ticket.
      const alvo = e.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT' || alvo.isContentEditable)) return;
      // Deixa os atalhos do navegador em paz (Ctrl+P, Alt+Tab...).
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const tecla = e.key.toLowerCase();
      // Imprimir e WhatsApp fecham o ticket sozinhos — na cabine o próximo
      // carro já está esperando, não faz sentido voltar só pra clicar Fechar.
      // RPS/Bluetooth/cabine continuam abertos: costumam ser usados JUNTO com
      // o Imprimir principal, não no lugar dele.
      if (tecla === 'f' || tecla === 'escape') { e.preventDefault(); onFechar(); }
      else if (tecla === 'w') { e.preventDefault(); window.open(linkWhatsApp(ticket, celular, filial), '_blank', 'noopener,noreferrer'); salvarCelularDoCliente(); onFechar(); }
      // Enter = mesmo atalho do I (Imprimir): na cabine o fluxo quase sempre
      // termina em imprimir, sem tirar a mão do teclado — ver Patio.jsx
      // (onKeyDownPlaca/onKeyDownModelo) pro resto da cadeia placa->carro->Enter.
      else if (tecla === 'i' || tecla === 'enter') { e.preventDefault(); imprimirTicket(ticket, filial); onFechar(); }
      else if (tecla === 'r' && ticket.ticketRps) { e.preventDefault(); imprimirTicket(ticket.ticketRps, filial); }
      else if (tecla === 'd' && ticket.ticketDivida) { e.preventDefault(); imprimirTicket(ticket.ticketDivida, filial); }
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [ticket, filial, celular, placa, perfil, onFechar]);

  // Desconecta a impressora Bluetooth ao fechar o modal — não faz sentido
  // manter o rádio conectado depois que o comprovante já foi embora.
  useEffect(() => {
    return () => impressoraBt?.desconectar();
  }, [impressoraBt]);

  return (
    <div className="modal-bg" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="ticket-impressao">
          {ticket.modelo ? (
            <PreviaModelo modelo={ticket.modelo} dados={ticket.dados} />
          ) : (
            <>
              <h2>{ticket.titulo}</h2>
              {ticket.linhas.map(([rotulo, valor]) => (
                <p className="mono" key={rotulo}>{rotulo}: <strong>{valor}</strong></p>
              ))}
            </>
          )}
        </div>
        <div className="campo" style={{ marginTop: 10 }}>
          <label>Celular para WhatsApp (opcional)</label>
          <input value={celular} onChange={(e) => onCelular(e.target.value)} placeholder="(19) 99999-9999" />
        </div>
        {/* Sem diálogo do sistema: Bluetooth fala direto com a impressora (só
            Android/Chrome — iPhone bloqueia Web Bluetooth); "na cabine" manda
            o pedido pelo Supabase pro navegador fixo da cabine imprimir
            (ver Layout.jsx e docs/CABINE.md). Os dois são fire-and-forget —
            não há confirmação ao vivo de que o papel realmente saiu. */}
        {(suportaBluetooth || perfil) && (
          <p className="suave" style={{ fontSize: 12, marginTop: 8 }}>
            {suportaBluetooth && statusBt && <>Bluetooth: {statusBt}. </>}
            {perfil && statusCabine && <>Cabine: {statusCabine}.</>}
          </p>
        )}
        {/* A letra sublinhada é o atalho (ver o useEffect acima). */}
        <div className="linha-form" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn-ghost" onClick={onFechar}><u>F</u>echar</button>
          {/* Não previne o clique nativo do link — só encadeia o fechamento
              junto (a nova aba do WhatsApp abre independente do modal). */}
          <a className="btn-ghost" href={linkWhatsApp(ticket, celular, filial)} target="_blank" rel="noopener noreferrer"
            onClick={() => { salvarCelularDoCliente(); onFechar(); }}>
            Enviar por <u>W</u>hatsApp
          </a>
          {/* Nota fiscal gerada junto com este comprovante: imprime na sequência,
              sem ter que ir até a tela Fiscal procurar o documento. */}
          {ticket.ticketRps && (
            <button className="btn-ghost" onClick={() => imprimirTicket(ticket.ticketRps, filial)}>
              Imprimir <u>R</u>PS
            </button>
          )}
          {/* Dívida contraída nesta saída (forma "Devedor") — ver Patio.jsx confirmarSaida. */}
          {ticket.ticketDivida && (
            <button className="btn-ghost" onClick={() => imprimirTicket(ticket.ticketDivida, filial)}>
              Imprimir <u>D</u>ívida
            </button>
          )}
          {suportaBluetooth && (
            <button className="btn-ghost" onClick={imprimirBluetooth} disabled={statusBt === 'conectando' || statusBt === 'imprimindo…'}>
              Imprimir Bluetooth
            </button>
          )}
          {perfil && (
            <button className="btn-ghost" onClick={imprimirNaCabine} disabled={statusCabine === 'enviando…'}>
              Imprimir na cabine
            </button>
          )}
          <button className="btn-primary" onClick={() => { imprimirTicket(ticket, filial); onFechar(); }}><u>I</u>mprimir</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Prévia do ticket renderizado a partir do modelo — usada tanto no comprovante
 * de verdade quanto na tela de edição de modelos. Monoespaçada porque os
 * layouts do legado alinham por coluna (e é assim que sai na impressora).
 */
export function PreviaModelo({ modelo, dados }) {
  return (
    <div className="mono" style={{ fontSize: 12, lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>
      {renderizarModelo(modelo, dados).map((trechos, i) => (
        <div key={i}>
          {trechos.length === 0 ? ' ' : trechos.map((t, j) => (
            <span key={j} style={{
              fontSize: t.estilos.includes('grande') ? '1.35em' : t.estilos.includes('pequeno') ? '0.85em' : undefined,
              fontWeight: (t.estilos.includes('grande') || t.estilos.includes('negrito')) ? 700 : undefined,
              fontStyle: t.estilos.includes('italico') ? 'italic' : undefined,
              textDecoration: t.estilos.includes('sublinhado') ? 'underline' : undefined,
            }}>{t.texto}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
