import { useMemo, useState } from 'react';
import { lerDbf, decodificarCp850 } from '../../packages/dbf/dbf.ts';
import { DESTINOS, sugerirMapeamento, converterLinha, filtrarLinhas } from '../../packages/dbf/mapeamento.ts';
import { detectarTabelasPreco } from '../../packages/dbf/tabelaPreco.ts';
import { importarDestino, importarVeiculosExtras, importarTabelasPreco } from '../lib/importacaoDbf.js';
import { supabase } from '../lib/supabase.js';
import { TIPOS_TICKET } from '../lib/modelosPadrao.js';

const LIMITE_PREVIA = 5;

// Importação dos cadastros do legado (.dbf, Clipper/DOS) direto pela interface:
// lê e decodifica o arquivo inteiramente no navegador (CP850 -> Unicode, ver
// packages/dbf/dbf.ts), sem enviar pra nenhum servidor — o .dbf de mensalistas
// tem dados pessoais. Restrita ao fornecedor (ver podeAcessar em acesso.js) —
// uso quase todo na implantação; deixado à mão do cliente, arrisca substituir
// cadastro em uso por curiosidade ou sem querer (ver "Substituir" abaixo).
export default function ImportarDbf({ perfil }) {
  const [destino, setDestino] = useState('mensalistas');
  const [dbf, setDbf] = useState(null); // { nomeArquivo, campos, registros }
  const [mapeamento, setMapeamento] = useState({});
  const [codigoEhPlacaPrincipal, setCodigoEhPlacaPrincipal] = useState(true);
  const [substituir, setSubstituir] = useState(false);
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState(null);

  // Importação de modelo de ticket (.txt do legado) — fluxo independente do
  // .dbf acima: outro tipo de arquivo, decodificado do mesmo jeito (CP850) e
  // salvo direto em modelos_ticket (ver ModelosTicket.jsx).
  const [tipoTicket, setTipoTicket] = useState('entrada');
  const [nomeArquivoTicket, setNomeArquivoTicket] = useState('');
  const [conteudoTicket, setConteudoTicket] = useState('');
  const [erroTicket, setErroTicket] = useState('');
  const [msgTicket, setMsgTicket] = useState('');
  const [salvandoTicket, setSalvandoTicket] = useState(false);

  const destinoAtual = DESTINOS[destino];
  const ehVeiculosExtra = destinoAtual.tipoImportacao === 'veiculos_extra';
  const ehTabelaPreco = destinoAtual.tipoImportacao === 'tabela_preco';

  function mudarDestino(novo) {
    setDestino(novo);
    setResultado(null);
    if (dbf) {
      const nomes = dbf.campos.map((c) => c.nome);
      setMapeamento(sugerirMapeamento(DESTINOS[novo].colunas, nomes));
    }
  }

  async function onArquivo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro(''); setResultado(null);
    try {
      const buffer = await file.arrayBuffer();
      const { campos, registros } = lerDbf(buffer);
      if (!registros.length) { setErro('Nenhum registro encontrado (ou o arquivo está vazio/todo excluído).'); setDbf(null); return; }
      const nomes = campos.map((c) => c.nome);
      setDbf({ nomeArquivo: file.name, campos, registros });
      setMapeamento(sugerirMapeamento(destinoAtual.colunas, nomes));
    } catch (err) {
      setErro(`Não foi possível ler esse arquivo como .dbf: ${err.message}`);
      setDbf(null);
    }
  }

  // Alguns destinos filtram o arquivo (ex.: Serviços só pega TIPO='S' do
  // ESTACONV, que também tem convênio misturado) — a contagem que aparece
  // pro operador (prévia, botão "Importar N") tem que ser a de quem passa
  // no filtro, não a do arquivo inteiro, senão "Importar 500" engana quando
  // só 40 são mesmo serviço.
  const linhasFiltradas = useMemo(() => {
    if (!dbf || ehTabelaPreco) return [];
    const linhas = dbf.registros.map((r) => converterLinha(r, destinoAtual.colunas, mapeamento));
    return filtrarLinhas(destinoAtual.colunas, linhas);
  }, [dbf, mapeamento, destinoAtual, ehTabelaPreco]);
  const preview = useMemo(() => linhasFiltradas.slice(0, LIMITE_PREVIA), [linhasFiltradas]);

  // Tabela de preço não passa pelo mapeamento manual coluna-a-coluna — os
  // campos (inclusive as até 45 faixas largas) são detectados sozinhos pelo
  // nome (ver packages/dbf/tabelaPreco.ts).
  const tabelasDetectadas = useMemo(() => {
    if (!dbf || !ehTabelaPreco) return { tabelas: [], colunasFaixa: [] };
    return detectarTabelasPreco(dbf.campos.map((c) => c.nome), dbf.registros);
  }, [dbf, ehTabelaPreco]);

  async function importar() {
    if (!dbf) return;
    setImportando(true); setErro(''); setResultado(null);
    try {
      let res;
      if (ehTabelaPreco) {
        res = await importarTabelasPreco({ perfil, tabelas: tabelasDetectadas.tabelas, substituir });
      } else {
        const convertidas = dbf.registros.map((r) => converterLinha(r, destinoAtual.colunas, mapeamento));
        const linhas = filtrarLinhas(destinoAtual.colunas, convertidas);
        res = ehVeiculosExtra
          ? await importarVeiculosExtras({ perfil, linhas, colunas: destinoAtual.colunas, substituir })
          : await importarDestino({
              perfil, destino: destinoAtual, colunas: destinoAtual.colunas, linhas, substituir,
              codigoEhPlacaPrincipal: destino === 'mensalistas' && codigoEhPlacaPrincipal,
            });
      }
      setResultado(res);
    } catch (err) {
      setErro(err.message);
    } finally {
      setImportando(false);
    }
  }

  async function onArquivoTicket(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErroTicket(''); setMsgTicket('');
    try {
      const buffer = await file.arrayBuffer();
      const texto = decodificarCp850(new Uint8Array(buffer));
      setNomeArquivoTicket(file.name);
      setConteudoTicket(texto);
    } catch (err) {
      setErroTicket(`Não foi possível ler esse arquivo: ${err.message}`);
    }
  }

  async function salvarModeloTicket() {
    setErroTicket(''); setMsgTicket(''); setSalvandoTicket(true);
    const { error } = await supabase.from('modelos_ticket')
      .upsert({ filial_id: perfil.filial_id, tipo: tipoTicket, conteudo: conteudoTicket }, { onConflict: 'filial_id,tipo' });
    setSalvandoTicket(false);
    if (error) { setErroTicket(error.message); return; }
    setMsgTicket('Modelo salvo — os próximos comprovantes desse tipo já saem nesse layout. Confira/ajuste em "Modelos de ticket".');
  }

  return (
    <>
      <div className="card">
        <h2>Importar do legado (.dbf)</h2>
        <p className="suave">
          Lê o arquivo .dbf do sistema antigo direto no navegador (nada é enviado a
          nenhum servidor) e cria os cadastros novos. Um código que já existir no
          sistema é ignorado por padrão — marque "Substituir" abaixo pra atualizar
          o cadastro existente em vez de pular.
        </p>
        <div className="linha-form">
          <div className="campo">
            <label>O que importar?</label>
            <select value={destino} onChange={(e) => mudarDestino(e.target.value)}>
              {Object.entries(DESTINOS).map(([chave, d]) => <option key={chave} value={chave}>{d.rotulo}</option>)}
            </select>
          </div>
          <div className="campo">
            <label>Arquivo .dbf</label>
            <input type="file" accept=".dbf" onChange={onArquivo} />
          </div>
        </div>
        {destino === 'mensalistas' && (
          <label className="campo-check" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={codigoEhPlacaPrincipal}
              onChange={(e) => setCodigoEhPlacaPrincipal(e.target.checked)} />
            O código é a placa do veículo principal — cadastrar esse veículo também
          </label>
        )}
        {destino === 'mensalistas' && codigoEhPlacaPrincipal && (
          <p className="suave" style={{ fontSize: 12 }}>
            Comum no ESTAEMPR do legado (campo VEICULO). Sem isso, o mensalista só seria
            reconhecido na entrada do pátio com os veículos extras — não com o principal.
          </p>
        )}
        <label className="campo-check" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} />
          {ehTabelaPreco
            ? 'Substituir as tabelas que já existem (em vez de ignorar) — troca o cabeçalho e todas as faixas pelo que vier do arquivo'
            : 'Substituir os que já existem (em vez de ignorar) — use pra reimportar os dados de um cliente sem cancelar um por um antes'}
        </label>
        {ehVeiculosExtra && (
          <p className="suave" style={{ fontSize: 12, marginTop: 10 }}>
            Cada linha vira um veículo de um mensalista que já existe (achado pelo código
            dele) — importe os Mensalistas primeiro. Corresponde ao ESTASUBS.dbf do legado.
          </p>
        )}
        {ehTabelaPreco && (
          <p className="suave" style={{ fontSize: 12, marginTop: 10 }}>
            Uma linha do arquivo vira uma tabela de preço inteira, com as até 45 faixas
            (colunas ATE/HOR/CON) detectadas sozinhas — sem mapeamento manual. Um tipo que já
            tenha tabela vigente na filial é ignorado, a não ser que "Substituir" esteja marcado
            — aí a tabela (e todas as faixas dela) é trocada pela do arquivo. Cuidado: se a
            filial já está em operação, mudar um preço em uso é decisão pra tomar em Preços, não
            pra acontecer sozinho numa reimportação.
          </p>
        )}
        {erro && <div className="aviso" style={{ marginTop: 10 }}>{erro}</div>}
        {dbf && (
          <p className="suave" style={{ marginTop: 10 }}>
            <strong>{dbf.nomeArquivo}</strong> — {dbf.registros.length} registro(s), {dbf.campos.length} campo(s) encontrado(s).
          </p>
        )}
      </div>

      {dbf && ehTabelaPreco && (
        <div className="card">
          <h2>Tabelas de preço detectadas</h2>
          <p className="suave">
            {tabelasDetectadas.colunasFaixa.length} coluna(s) de faixa encontrada(s) no arquivo
            (ATE/HOR/CON) — confira se as faixas de cada tabela abaixo batem com o que você
            espera antes de importar.
          </p>
          <div className="tabela-scroll">
            <table>
              <thead><tr><th>Tipo</th><th>Descrição</th><th>Faixas</th><th>Valor antes</th><th>Valor serviço</th><th>Pontos</th></tr></thead>
              <tbody>
                {tabelasDetectadas.tabelas.slice(0, LIMITE_PREVIA).map((t, i) => (
                  <tr key={i}>
                    <td className="mono">{t.tipo}</td>
                    <td>{t.descricao || '—'}</td>
                    <td>{t.faixas.length}</td>
                    <td>{t.valorAntes}</td>
                    <td>{t.valorServico}</td>
                    <td>{t.qtePontos}</td>
                  </tr>
                ))}
                {tabelasDetectadas.tabelas.length === 0 && (
                  <tr><td colSpan={6} className="suave">Nenhuma tabela com código (TIPO) encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {tabelasDetectadas.tabelas.length > LIMITE_PREVIA && (
            <p className="suave" style={{ fontSize: 12 }}>
              + {tabelasDetectadas.tabelas.length - LIMITE_PREVIA} tabela(s) a mais, não mostrada(s) aqui.
            </p>
          )}
          <div className="linha-form" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={importar} disabled={importando || !tabelasDetectadas.tabelas.length}>
              {importando ? 'Importando…' : `Importar ${tabelasDetectadas.tabelas.length} tabela(s)`}
            </button>
          </div>
        </div>
      )}

      {dbf && !ehTabelaPreco && (
        <div className="card">
          <h2>Mapeamento — {destinoAtual.rotulo}</h2>
          <p className="suave">
            Confira se cada coluna bateu com o campo certo do arquivo (os nomes de campo
            do legado variam). "— não importar —" deixa a coluna em branco.
          </p>
          <div className="tabela-scroll">
            <table>
              <thead><tr><th>Coluna</th><th>Campo no .dbf</th></tr></thead>
              <tbody>
                {destinoAtual.colunas.map((c) => (
                  <tr key={c.campo}>
                    <td>{c.rotulo}{c.obrigatorio ? ' *' : ''}</td>
                    <td>
                      <select value={mapeamento[c.campo] ?? ''} onChange={(e) => setMapeamento((m) => ({ ...m, [c.campo]: e.target.value || null }))}>
                        <option value="">— não importar —</option>
                        {dbf.campos.map((f) => <option key={f.nome} value={f.nome}>{f.nome} ({f.tipo}, {f.tamanho})</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: 16 }}>Prévia (primeiras {Math.min(LIMITE_PREVIA, linhasFiltradas.length)} de {linhasFiltradas.length})</h2>
          {linhasFiltradas.length !== dbf.registros.length && (
            <p className="suave" style={{ marginTop: -8 }}>
              {dbf.registros.length - linhasFiltradas.length} registro(s) do arquivo não bateram no filtro
              e ficam de fora.
            </p>
          )}
          <div className="tabela-scroll">
            <table>
              <thead><tr>{destinoAtual.colunas.map((c) => <th key={c.campo}>{c.rotulo}</th>)}</tr></thead>
              <tbody>
                {preview.map((linha, i) => (
                  <tr key={i}>
                    {destinoAtual.colunas.map((c) => <td key={c.campo}>{formatarPrevia(linha[c.campo])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="linha-form" style={{ marginTop: 16 }}>
            <button className="btn-primary" onClick={importar} disabled={importando}>
              {importando ? 'Importando…' : `Importar ${linhasFiltradas.length} registro(s)`}
            </button>
          </div>
        </div>
      )}

      {resultado && (
        <div className="card">
          <h2>Resultado</h2>
          <p>
            <strong>{resultado.criados}</strong> criado(s)
            {resultado.atualizados > 0 && <>, <strong>{resultado.atualizados}</strong> atualizado(s)</>}
            {', '}<strong>{resultado.ignorados}</strong> ignorado(s)
            {' '}({ehVeiculosExtra ? 'placa já cadastrada' : ehTabelaPreco ? 'tipo já tem tabela vigente' : 'código já existia'}).
          </p>
          {resultado.erros.length > 0 && (
            <>
              <p className="aviso">{resultado.erros.length} problema(s):</p>
              <ul>
                {resultado.erros.map((e, i) => <li key={i} className="suave">Linha {e.linha}: {e.motivo}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>Importar modelo de ticket (.txt)</h2>
        <p className="suave">
          Lê um arquivo .txt de comprovante do sistema antigo (TICKETE.TXT, TICKETS.TXT,
          TICKET2.TXT, TICKETM.TXT, TICKRPS.TXT, TICKETD.TXT…), decodifica os acentos do
          legado e deixa pronto pra salvar como o modelo dessa filial em{' '}
          <strong>Modelos de ticket</strong> — os mesmos tokens entre arrobas (<code>@CC@</code>,
          <code>@V@</code>…) já funcionam sem precisar editar nada.
        </p>
        <div className="linha-form">
          <div className="campo">
            <label>Tipo de comprovante</label>
            <select value={tipoTicket} onChange={(e) => { setTipoTicket(e.target.value); setMsgTicket(''); }}>
              {TIPOS_TICKET.map((t) => <option key={t.tipo} value={t.tipo}>{t.rotulo}</option>)}
            </select>
          </div>
          <div className="campo">
            <label>Arquivo .txt</label>
            <input type="file" accept=".txt" onChange={onArquivoTicket} />
          </div>
        </div>
        {erroTicket && <div className="aviso" style={{ marginTop: 10 }}>{erroTicket}</div>}
        {msgTicket && <div className="ok-txt" style={{ marginTop: 10 }}>{msgTicket}</div>}
        {nomeArquivoTicket && (
          <>
            <p className="suave" style={{ marginTop: 10 }}><strong>{nomeArquivoTicket}</strong></p>
            <textarea className="mono" rows={14} style={{ width: '100%', fontSize: 12, lineHeight: 1.35, marginTop: 4 }}
              value={conteudoTicket} onChange={(e) => setConteudoTicket(e.target.value)} />
            <div className="linha-form" style={{ marginTop: 10 }}>
              <button className="btn-primary" onClick={salvarModeloTicket} disabled={salvandoTicket || !conteudoTicket}>
                {salvandoTicket ? 'Salvando…' : 'Salvar como modelo desta filial'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function formatarPrevia(v) {
  if (v === null || v === undefined) return '—';
  if (v === true) return 'Sim';
  if (v === false) return 'Não';
  return String(v);
}
