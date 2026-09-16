// Controle de acesso por papel. A escada é operador < gerente < supervisor <
// fornecedor (ver supabase/migrations/0018_papeis_e_fornecedor.sql).
//
// O que vale aqui é a camada de UI (rotas e menu). No banco, a RLS isola por
// filial e o que é exclusivo do fornecedor — alterar os dados do estacionamento
// e trocar de filial — tem policy própria, então esse pedaço vale mesmo fora do
// app. A fronteira gerente/supervisor ainda é só de interface (pendência
// conhecida: exigiria policy por tabela).

export const PAPEIS = {
  operador: 'Operador',
  gerente: 'Gerente',
  supervisor: 'Supervisor',
  fornecedor: 'Fornecedor',
};

export const ROTAS_OPERADOR = ['/', '/caixa', '/reservas', '/sobre'];

// Gerente: o dia a dia de quem toca o pátio e atende o cliente — sem mexer no
// que afeta cobrança (preços), em quem acessa (usuários) nem no financeiro de
// saída (pagar/banco).
export const ROTAS_GERENTE = [
  ...ROTAS_OPERADOR,
  '/bi', '/relatorio-convenios', '/mensalistas', '/convenios', '/servicos', '/modelos', '/fiscal', '/receber',
];

/** Rotas permitidas, ou `null` quando o papel acessa tudo. */
export function rotasDoPapel(papel) {
  if (papel === 'supervisor' || papel === 'fornecedor') return null;
  if (papel === 'gerente') return ROTAS_GERENTE;
  return ROTAS_OPERADOR;
}

export function podeAcessar(perfil, pathname) {
  const rotas = rotasDoPapel(perfil?.papel);
  return rotas === null || rotas.includes(pathname);
}

/**
 * Filial habilitada pela prefeitura pra emitir NFS-e/RPS/DPS? Controla se o
 * menu "NFS-e / RPS/DPS" aparece (ver Layout.jsx) e o botão "Gerar DPS" na
 * saída do pátio (ver Patio.jsx) — evita cliente sem liberação mexer numa
 * rotina fiscal que não usa. `habilitado` explícito (Configurações → Fiscal)
 * manda; sem ele, cai pra "já escolheu um padrão de envio alguma vez?", pra
 * quem já usava fiscal antes deste checkbox existir continuar vendo o menu
 * sem precisar marcar nada.
 */
export function nfseAtivo(filial) {
  const habilitado = filial?.config?.nfse?.habilitado;
  return habilitado != null ? !!habilitado : !!filial?.config?.nfse?.padrao;
}

export const ehFornecedor = (perfil) => perfil?.papel === 'fornecedor';
/** Fornecedor tem, por definição, todo poder de supervisor. */
export const ehSupervisor = (perfil) => perfil?.papel === 'supervisor' || ehFornecedor(perfil);
/** "Do gerente pra cima" — usado nas permissões pontuais dentro das telas. */
export const ehGerente = (perfil) => perfil?.papel === 'gerente' || ehSupervisor(perfil);
