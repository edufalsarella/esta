// Motor de modelos de ticket, no mesmo formato do sistema legado em Harbour:
// o layout é um texto com tokens entre arrobas (`@CC@` = placa), e o operador
// pode ter um layout diferente por filial sem mexer em código.
//
// Equivalente às FUNCTION analisa_fixo/analisa_variavel do SISPROC.PRG, com
// duas diferenças conscientes:
//  - Token desconhecido vira vazio (o legado deixava o `@TOKEN@` literal no
//    papel, o que vira lixo no comprovante do cliente).
//  - O `@SE(...)@` do legado avaliava expressão Harbour de verdade; aqui são
//    três formas fixas, que cobrem todos os casos dos modelos reais.

/** Modos de formatação: `@PG+@` abre, `@PG-@` fecha. Viram CSS na impressão. */
const ESTILOS = {
  PG: 'grande',
  PP: 'pequeno',
  PE: 'negrito',   // "enfatizado" na tela de impressora do legado
  PI: 'italico',
  PS: 'sublinhado',
  PU: 'usuario',   // código livre do cliente no legado; aqui é só uma classe
};

/**
 * Uma condicional vale para a linha inteira, como no legado:
 *   @SE(servicos)@Serv.: @SERVICOS@     -> só sai se `servicos` tiver conteúdo
 *   @SE(#servicos)@Sem servicos         -> só sai se estiver vazio (negação)
 *   @SE(tipo_veic=P)@TABELA P           -> igualdade
 *   @SE(tipo_mens<>E)@Mensalista        -> diferença (`#` é o mesmo que `<>`)
 * Devolve null quando a linha não tem condicional.
 *
 * O `#` (prefixo e operador) existe porque é o "diferente" do Clipper/Harbour —
 * é o que já se escreve nos modelos do sistema antigo.
 */
function avaliarCondicional(linha, dados) {
  const m = linha.match(/^@SE\(([^)]*)\)@/);
  if (!m) return null;

  const bruta = m[1].trim();
  const resto = linha.slice(m[0].length);
  // Prefixo de negação: nega o que vier depois, seja presença ou comparação.
  const negado = /^[#!]/.test(bruta);
  const expressao = negado ? bruta.slice(1).trim() : bruta;
  const comparacao = expressao.match(/^([^=<>#]+?)\s*(<>|#|=)\s*(.*)$/);

  let verdadeiro;
  if (comparacao) {
    const [, campo, operador, esperado] = comparacao;
    const atual = String(valorDoToken(campo.trim(), dados) ?? '').trim();
    const alvo = esperado.trim().replace(/^["']|["']$/g, '');
    verdadeiro = operador === '=' ? atual === alvo : atual !== alvo;
  } else {
    // Sem operador: "tem conteúdo?" — cobre os `<>0` e `<>SPACE(n)` do legado.
    const atual = valorDoToken(expressao, dados);
    const texto = String(atual ?? '').trim();
    verdadeiro = texto !== '' && texto !== '0' && Number(atual) !== 0;
    if (texto !== '' && Number.isNaN(Number(atual))) verdadeiro = true;
  }
  return { verdadeiro: negado ? !verdadeiro : verdadeiro, resto };
}

function valorDoToken(token, dados) {
  const chave = String(token).trim().toUpperCase();
  return dados?.[chave];
}

/**
 * Renderiza o modelo em linhas de trechos:
 *   [ [{ texto: 'CONTROLE:12', estilos: ['grande'] }], [...] ]
 * Esse formato serve tanto pro HTML da impressão (estilos viram classes) quanto
 * pro texto puro do WhatsApp (é só concatenar os textos).
 */
export function renderizarModelo(conteudo, dados = {}) {
  const linhas = [];

  for (const linhaBruta of String(conteudo ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const condicional = avaliarCondicional(linhaBruta, dados);
    if (condicional && !condicional.verdadeiro) continue;
    const linha = condicional ? condicional.resto : linhaBruta;

    const trechos = [];
    const estilosAbertos = [];
    let texto = '';
    const empurrar = () => {
      if (texto) trechos.push({ texto, estilos: [...estilosAbertos] });
      texto = '';
    };

    // Divide em pedaços alternando texto e token (o que estiver entre @...@).
    const partes = linha.split(/@([^@]*)@/);
    for (let i = 0; i < partes.length; i++) {
      if (i % 2 === 0) { texto += partes[i]; continue; }

      const token = partes[i].toUpperCase();
      const modo = token.match(/^(P[GPEISU])([+-])$/);
      const quebras = token.match(/^P([1-9])$/);

      if (token === 'ARROBA') {
        texto += '@';
      } else if (token === 'LOGO') {
        // Imagem, não texto — não cabe no acúmulo de `texto` normal. Sem
        // logo configurado (dados.LOGO vazio), o token só some, igual
        // qualquer outro token desconhecido/sem valor.
        empurrar();
        const logo = dados?.LOGO;
        if (logo) trechos.push({ texto: '', estilos: [], imagemHtml: logo.dataUrl, imagemEscPos: logo.escposBytes, imagemPct: logo.percentual ?? 50 });
      } else if (modo) {
        empurrar();
        const estilo = ESTILOS[modo[1]];
        if (modo[2] === '+') estilosAbertos.push(estilo);
        else {
          const pos = estilosAbertos.lastIndexOf(estilo);
          if (pos >= 0) estilosAbertos.splice(pos, 1);
        }
      } else if (quebras) {
        empurrar();
        linhas.push(trechos.length ? [...trechos] : []);
        trechos.length = 0;
        for (let n = 1; n < Number(quebras[1]); n++) linhas.push([]);
      } else {
        // Token de dado. Desconhecido/vazio some, em vez de virar lixo.
        texto += String(valorDoToken(token, dados) ?? '');
      }
    }
    empurrar();
    linhas.push(trechos);
  }

  return linhas;
}

/** Texto puro (WhatsApp, pré-visualização) — ignora formatação. */
export function modeloParaTexto(conteudo, dados) {
  return renderizarModelo(conteudo, dados)
    .map((trechos) => trechos.map((t) => t.texto).join(''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')   // o legado enchia o fim de linhas em branco
    .trim();
}
