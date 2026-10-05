// Itens do menu lateral — usados pelo menu (Layout.jsx), pelo controle de
// acesso (acesso.js) e pela escolha de telas por usuário (Usuarios.jsx).
export const GRUPOS = [
  { titulo: 'Operação', itens: [
    { to: '/', rotulo: 'Pátio', fim: true },
    { to: '/caixa', rotulo: 'Caixa' },
    { to: '/reservas', rotulo: 'Reservas de vaga' },
  ]},
  { titulo: 'Relatórios', itens: [
    { to: '/bi', rotulo: 'BI / Painel' },
    { to: '/relatorio-convenios', rotulo: 'Relatório de convênios' },
    { to: '/estatistica', rotulo: 'Estatística' },
    { to: '/mensalistas-atraso', rotulo: 'Mensalistas em atraso' },
  ]},
  { titulo: 'Cadastros', itens: [
    { to: '/precos', rotulo: 'Tabelas de preço' },
    { to: '/convenios', rotulo: 'Convênios' },
    { to: '/mensalistas', rotulo: 'Mensalistas' },
    { to: '/formas', rotulo: 'Formas de pagamento' },
    { to: '/vagas', rotulo: 'Vagas/boxes' },
    { to: '/produtos', rotulo: 'Produtos' },
    { to: '/modelos', rotulo: 'Modelos' },
    { to: '/servicos', rotulo: 'Serviços' },
    { to: '/bonus', rotulo: 'Faixas de bônus' },
    { to: '/importar', rotulo: 'Importar do legado (.dbf)' },
  ]},
  { titulo: 'Fiscal', itens: [
    { to: '/fiscal', rotulo: 'NFS-e / RPS/DPS' },
  ]},
  { titulo: 'Configurações', itens: [
    { to: '/configuracoes', rotulo: 'Dados do estacionamento' },
    { to: '/usuarios', rotulo: 'Usuários' },
    { to: '/modelos-ticket', rotulo: 'Modelos de ticket' },
  ]},
  { titulo: 'Ajuda', itens: [
    { to: '/ajuda', rotulo: 'Ajuda' },
    { to: '/sobre', rotulo: 'Sobre' },
  ]},
];

/** Sempre liberadas, pra qualquer usuário. */
export const ROTAS_SEMPRE = ['/ajuda', '/sobre'];

/** Rotas que dá pra liberar/bloquear por usuário (fora as sempre liberadas e a só do fornecedor). */
export const ROTAS_CONFIGURAVEIS = GRUPOS.flatMap((g) => g.itens.map((i) => i.to))
  .filter((to) => !ROTAS_SEMPRE.includes(to) && to !== '/importar');
