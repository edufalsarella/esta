import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Crud from '../componentes/Crud.jsx';

// Telas de cadastro simples, todas sobre o CRUD genérico.

export function Convenios({ perfil }) {
  const [tabelasOpcoes, setTabelasOpcoes] = useState([]);

  useEffect(() => {
    supabase.from('tabelas_preco').select('tipo, descricao')
      .is('vigencia_fim', null).eq('ativo', true).order('tipo')
      .then(({ data }) => setTabelasOpcoes((data || []).map((t) => ({ valor: t.tipo, rotulo: `${t.tipo} · ${t.descricao}` }))));
  }, []);

  // O motor aplica os três em cascata e o último preenchido vence (fiel ao
  // legado, que contava com o operador preencher só um). Aqui a tela garante
  // isso: preencher um zera os outros dois.
  return <Crud perfil={perfil} titulo="Convênios" tabela="convenios" ordem="codigo"
    subtitulo="Desconto na saída. Escolha UMA forma: % de desconto, valor fixo ou a grade própria (coluna CON da tabela de preço)."
    exclusivos={[['perc_conv', 'vlr_conv', 'tab_horas']]}
    colunas={[
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true },
      { campo: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [{ valor: 'C', rotulo: 'Convênio' }, { valor: 'V', rotulo: 'Vale' }] },
      { campo: 'razao', rotulo: 'Razão', obrigatorio: true },
      { campo: 'perc_conv', rotulo: '% desc.', tipo: 'number',
        ajuda: 'Desconto percentual sobre o valor calculado.' },
      { campo: 'vlr_conv', rotulo: 'Vlr fixo', tipo: 'number',
        ajuda: 'Valor fixo que o convênio paga, independente do tempo.' },
      { campo: 'tab_conv', rotulo: 'Tabela alt.', tipo: 'select', opcoes: tabelasOpcoes, naTabela: false,
        ajuda: 'Calcula por outra tabela de preço em vez da tabela de entrada do veículo. Combina com qualquer uma das três formas acima. Só aparecem tabelas vigentes e ativas.' },
      { campo: 'tab_horas', rotulo: 'Grade própria (CON)', tipo: 'bool', naTabela: false,
        ajuda: 'O convênio paga o valor da coluna "Valor convênio" da faixa — da tabela em vigor no cálculo, ou seja, da Tabela alt. quando ela estiver preenchida. Marcar isto NÃO troca a tabela.' },
      // `hor_conv` (HORCONV do legado) fica de fora de propósito: nunca foi
      // lido em cálculo nenhum e confundia com o "Pede hora" abaixo — a hora
      // que divide os dois períodos é sempre a que o operador digita na saída,
      // não uma hora fixa de cadastro. A coluna continua no banco (a
      // importação do .dbf ainda preserva o valor do legado).
      { campo: 'pede_hora', rotulo: 'Pede hora', tipo: 'bool', naTabela: false,
        ajuda: 'Na saída, o operador informa o horário em que o cliente saiu do convênio (vem carimbado no ticket). O convênio banca até esse horário; do minuto seguinte até a saída vira estadia normal, cobrada do cliente pela "Tabela depois do convênio".' },
      { campo: 'tab_preco', rotulo: 'Tabela depois do convênio', tipo: 'select', opcoes: tabelasOpcoes, naTabela: false,
        ajuda: 'Cobra o tempo que o cliente ficou no pátio DEPOIS de sair do convênio (só vale junto com "Pede hora"). Em branco, cobra pela tabela do próprio veículo. Ex.: o cabeleireiro paga 1h15 e o cliente paga as 2h que passeou pela cidade.' },
      { campo: 'so_supervisor', rotulo: 'Só supervisor', tipo: 'bool', naTabela: false },
      // Cadastrais (0049): só fazem falta pra quem emite DPS/RPS com o
      // convênio como tomador — por isso ficam fora da tabela, só no form.
      { campo: 'grupo', rotulo: 'Grupo', naTabela: false,
        ajuda: 'Agrupamento livre — junta convênios de uma mesma rede/matriz. Não afeta a cobrança.' },
      { campo: 'cnpj', rotulo: 'CNPJ/CPF', naTabela: false },
      { campo: 'inscricao', rotulo: 'Inscrição municipal', naTabela: false },
      { campo: 'endereco', rotulo: 'Endereço', naTabela: false },
      { campo: 'numero', rotulo: 'Número', naTabela: false },
      { campo: 'bairro', rotulo: 'Bairro', naTabela: false },
      { campo: 'cidade', rotulo: 'Cidade (código IBGE)', tipo: 'cidade', naTabela: false,
        ajuda: 'Exigido no DPS/RPS quando a nota sai no nome do convênio — mesma busca usada no cadastro do mensalista, já traz o código certo.' },
      { campo: 'uf', naTabela: false, oculto: true },
      { campo: 'cod_ibge', naTabela: false, oculto: true },
      { campo: 'cep', rotulo: 'CEP', naTabela: false },
      { campo: 'telefone', rotulo: 'Telefone', naTabela: false },
      { campo: 'email', rotulo: 'E-mail', naTabela: false },
    ]} />;
}

export function Formas({ perfil }) {
  return <Crud perfil={perfil} titulo="Formas de pagamento" tabela="formas_pagamento" ordem="codigo"
    subtitulo="Dinheiro, débito, crédito, Pix… O % de ajuste altera o valor cobrado na forma."
    colunas={[
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true },
      { campo: 'descricao', rotulo: 'Descrição', obrigatorio: true },
      { campo: 'perc_ajuste', rotulo: '% ajuste', tipo: 'number' },
      { campo: 'eh_dinheiro', rotulo: 'É dinheiro', tipo: 'bool' },
      { campo: 'rps_sempre', rotulo: 'RPS/DPS sempre', tipo: 'bool', naTabela: false },
      { campo: 'eh_devedor', rotulo: 'É "Devedor" (vira dívida da placa)', tipo: 'bool', naTabela: false },
      // Liga a forma ao botão "Cobrar no celular" (InfiniteTap) — ver
      // src/lib/infinitepay.js. Vazio = forma que não é cartão.
      { campo: 'infinitepay_metodo', rotulo: 'InfiniteTap', tipo: 'select', naTabela: false, opcoes: [
        { valor: '', rotulo: '— não é cartão —' },
        { valor: 'credit', rotulo: 'Crédito' },
        { valor: 'debit', rotulo: 'Débito' },
      ] },
      // Liga a forma ao fluxo Sem Parar (ver docs/SEMPARAR.md) — escolher
      // esta forma na saída de um veículo autorizado dispara Recebe+Confirma.
      { campo: 'eh_semparar', rotulo: 'É "Sem Parar"', tipo: 'bool', naTabela: false },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
    ]} />;
}

export function Vagas({ perfil }) {
  // Muda a cada lote criado com sucesso, só pra remontar o Crud e ele
  // recarregar a lista — o Crud não expõe um jeito de forçar reload de fora.
  const [chaveRecarga, setChaveRecarga] = useState(0);
  return (
    <>
      <CadastroLoteVagas perfil={perfil} onCriado={() => setChaveRecarga((k) => k + 1)} />
      <Crud key={chaveRecarga} perfil={perfil} titulo="Vagas / boxes" tabela="vagas" ordem="codigo"
        colunas={[
          { campo: 'codigo', rotulo: 'Código', obrigatorio: true,
            ajuda: 'O prefixo (letras iniciais) define a tabela de preço usada pra calcular o valor proposto da reserva — ex.: "C001" usa a tabela de preço "C".' },
          { campo: 'tipo', rotulo: 'Tipo' },
          { campo: 'ocupada', rotulo: 'Ocupada', tipo: 'bool' },
          { campo: 'placa_atual', rotulo: 'Placa', naTabela: true },
          { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
        ]} />
    </>
  );
}

/**
 * Cadastra várias vagas do mesmo tipo de uma vez (ex.: 40 "Coberta", prefixo
 * "C" -> C001..C040) — pra estacionamento grande não precisar clicar "+
 * Novo" uma vaga por vez. Tipo digitado à mão (não vem de <select> nem é
 * adivinhado pela letra do código) — a quantidade total de cada tipo, usada
 * em Reservas de vaga, é a contagem de linhas ativas com aquele texto em
 * `tipo`, então digitar igual em todo lote é o que importa, não o prefixo.
 */
function CadastroLoteVagas({ perfil, onCriado }) {
  const [tipo, setTipo] = useState('');
  const [prefixo, setPrefixo] = useState('');
  const [quantidade, setQuantidade] = useState(10);
  const [inicioEm, setInicioEm] = useState(1);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function criarLote(e) {
    e.preventDefault();
    setErro(''); setMsg(''); setSalvando(true);
    const qte = Number(quantidade);
    const inicio = Number(inicioEm);
    const linhas = Array.from({ length: qte }, (_, i) => ({
      filial_id: perfil.filial_id,
      codigo: `${prefixo}${String(inicio + i).padStart(3, '0')}`,
      tipo, ativo: true, ocupada: false,
    }));
    const { error } = await supabase.from('vagas').insert(linhas);
    setSalvando(false);
    if (error) {
      setErro(error.code === '23505'
        ? `Já existe algum código nessa faixa (${linhas[0].codigo}..${linhas.at(-1).codigo}) — tenta outro prefixo ou "Começa em".`
        : error.message);
      return;
    }
    setMsg(`${qte} vaga(s) "${tipo}" criada(s): ${linhas[0].codigo}..${linhas.at(-1).codigo}.`);
    onCriado();
  }

  return (
    <div className="card">
      <h2>Cadastrar em lote</h2>
      <p className="suave">
        A quantidade de cada tipo (usada em Reservas de vaga) é o total de vagas ativas cadastradas
        com aquele tipo — pra um estacionamento grande, cadastre todas de uma vez aqui em vez de uma
        por uma. O prefixo do código também diz qual tabela de preço usar pra calcular o valor
        proposto da reserva (ex.: prefixo "C" → tabela de preço "C") — use o mesmo código da tabela
        que se aplica a esse tipo de vaga.
      </p>
      {erro && <div className="aviso">{erro}</div>}
      {msg && <div className="ok-txt">{msg}</div>}
      <form className="linha-form" onSubmit={criarLote}>
        <div className="campo" style={{ flex: 1, minWidth: 140 }}>
          <label>Tipo *</label>
          <input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Coberta" required />
        </div>
        <div className="campo" style={{ width: 100 }}>
          <label>Prefixo do código</label>
          <input className="mono" value={prefixo} onChange={(e) => setPrefixo(e.target.value.toUpperCase())} placeholder="C" />
        </div>
        <div className="campo" style={{ width: 110 }}>
          <label>Quantidade *</label>
          <input type="number" min="1" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} required />
        </div>
        <div className="campo" style={{ width: 110 }}>
          <label>Começa em</label>
          <input type="number" min="1" value={inicioEm} onChange={(e) => setInicioEm(e.target.value)} />
        </div>
        <button className="btn-primary" type="submit" disabled={salvando}>
          {salvando ? 'Criando…' : '+ Criar lote'}
        </button>
      </form>
    </div>
  );
}

export function Produtos({ perfil }) {
  return <Crud perfil={perfil} titulo="Produtos" tabela="produtos" ordem="codigo"
    subtitulo="Produtos à venda no balcão (água, item de loja...) — a venda fica em Pátio → ⋮ → Venda Produtos."
    colunas={[
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true },
      { campo: 'descricao', rotulo: 'Descrição', obrigatorio: true },
      { campo: 'valor_compra', rotulo: 'Vlr. compra', tipo: 'number' },
      { campo: 'valor_venda', rotulo: 'Vlr. venda', tipo: 'number', obrigatorio: true },
      { campo: 'quantidade_estoque', rotulo: 'Estoque', tipo: 'number' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
    ]} />;
}

export function Modelos({ perfil }) {
  return <Crud perfil={perfil} titulo="Modelos de veículo" tabela="modelos_veiculo" ordem="codigo"
    subtitulo="Catálogo de modelos e a tabela de preço padrão de cada um."
    colunas={[
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true },
      { campo: 'nome', rotulo: 'Modelo', obrigatorio: true },
      { campo: 'tabela_tipo', rotulo: 'Tabela padrão' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
    ]} />;
}

export function Servicos({ perfil }) {
  const [tabelasOpcoes, setTabelasOpcoes] = useState([]);

  useEffect(() => {
    supabase.from('tabelas_preco').select('tipo, descricao')
      .is('vigencia_fim', null).eq('ativo', true).order('tipo')
      .then(({ data }) => setTabelasOpcoes((data || []).map((t) => ({ valor: t.tipo, rotulo: `${t.tipo} · ${t.descricao}` }))));
  }, []);

  return <Crud perfil={perfil} titulo="Serviços" tabela="servicos" ordem="codigo"
    subtitulo="Catálogo de serviços (ex.: lavagem, polimento) e a tabela de preço usada pra cobrar cada um."
    colunas={[
      { campo: 'codigo', rotulo: 'Código', obrigatorio: true },
      { campo: 'descricao', rotulo: 'Descrição', obrigatorio: true },
      { campo: 'tabela_tipo', rotulo: 'Tabela de preço', tipo: 'select', opcoes: tabelasOpcoes, obrigatorio: true,
        ajuda: 'Só tabelas de preço já cadastradas em Preços.' },
      { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
    ]} />;
}

export function Bonus({ perfil }) {
  return <Crud perfil={perfil} titulo="Faixas de bônus" tabela="bonus_faixas" ordem="pontos_necessarios"
    subtitulo="Escada de desconto por pontos de fidelidade acumulados (o mesmo pontos que a tabela de preço e os serviços já dão). Ex.: 1000 pontos = R$50, 2000 pontos = R$110 — na saída, o sistema oferece a maior faixa que o cliente já alcançou."
    colunas={[
      { campo: 'pontos_necessarios', rotulo: 'Pontos necessários', tipo: 'number', obrigatorio: true },
      { campo: 'valor_desconto', rotulo: 'Desconto (R$)', tipo: 'number', obrigatorio: true },
    ]} />;
}
