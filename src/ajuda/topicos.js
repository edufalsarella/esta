// Textos da tela de Ajuda (src/telas/Ajuda.jsx). Um tópico por item do menu
// (`rota` liga o tópico à tela) e, mais adiante, tópicos transversais.
// Cada seção: `texto` (parágrafos) e/ou `itens` (lista). Ao mudar uma tela,
// atualize o tópico dela aqui.

export const TOPICOS = [
  {
    id: 'patio',
    titulo: 'Pátio',
    rota: '/',
    resumo: 'Entrada e saída de veículos, cobrança, pagamento e o que dá pra fazer com um veículo no pátio.',
    secoes: [
      {
        titulo: 'Dar entrada num veículo',
        texto: [
          'Digite a placa em "Placa ou nº do ticket" e o modelo em "Carro" (a lista sugere os modelos cadastrados e já escolhe a tabela de preço). Confirme em "Registrar entrada" ou com Enter. O ticket de entrada é impresso na impressora padrão do computador.',
          'Se o carro não estiver cadastrado, aparecem os campos "Tabela de preço" e "Nome do carro (novo)" — o modelo novo fica salvo para as próximas vezes.',
        ],
        itens: [
          'Câmera (📷): lê a placa por foto, se ligado em Configurações.',
          'Mensalista ou hóspede é reconhecido pela placa e aparece um selo com o nome. Mensalidade vencida, vaga do mensalista já ocupada ou entrada fora do dia/turno contratado fazem o veículo entrar como avulso, com aviso.',
          'Reserva de vaga para a placa aparece como aviso — confira o modelo/tabela e registre a entrada.',
        ],
      },
      {
        titulo: 'Mais opções na entrada',
        itens: [
          'Serviços: marca serviços (lavagem etc.) já na entrada; são cobrados na saída.',
          'Avarias: anota e fotografa avarias do veículo na chegada.',
          'Vlr. Antecipado: recebe um valor adiantado, que entra no caixa agora e é descontado na saída.',
        ],
      },
      {
        titulo: 'Veículos no pátio',
        itens: [
          'Saída: abre o cálculo da saída (veja abaixo).',
          'Serviço: marca um serviço num veículo que já está no pátio.',
          '2ª via: reimprime o ticket de entrada.',
          'Excluir: cancela uma entrada lançada por engano (pede o motivo). A placa fica livre para entrar de novo.',
          'Na saída, o nº do ticket também serve no lugar da placa.',
        ],
      },
      {
        titulo: 'Saída e cobrança',
        texto: [
          'O valor é calculado pela tabela de preço do veículo e pelo tempo de permanência. Na tela de saída dá para:',
        ],
        itens: [
          'Escolher um convênio (desconto, tabela própria ou valor fixo do convênio). Convênio que "pede hora" pergunta o horário carimbado no ticket — até ali paga o convênio, depois o cliente.',
          'Ver serviços marcados, dívida anterior da placa (somada ao valor), valor antecipado e bônus de fidelidade (descontados).',
          'Mensalista/hóspede não paga a estadia, mas paga os serviços marcados.',
          'Escolher a forma de pagamento — e dividir em mais de uma forma. A soma tem que bater com o valor, senão não confirma.',
          'Forma "Devedor": o valor fica como dívida. "Avulso" cobra da placa na próxima entrada (ou em "Receber dívida"); "Mensalista" joga na próxima mensalidade de um mensalista que aceita extra.',
          'Sem Parar: aparece marcada quando a placa foi autorizada na entrada; se o Sem Parar recusar, o motivo aparece no próprio card.',
          '⋮ → Alterar valor: muda o valor cobrado (fica marcado com "*" nos relatórios).',
        ],
      },
      {
        titulo: 'Nota fiscal na saída (Gerar DPS)',
        texto: [
          'Com a emissão de NFS-e ligada, a saída pode gerar o documento fiscal — automaticamente em toda saída ou pelo ⋮ → Gerar DPS. CPF/CNPJ do tomador é opcional (em branco sai sem identificação).',
        ],
        itens: [
          'CPF/CNPJ já usado antes (nota anterior, mensalista, convênio) traz nome e endereço sozinho; CNPJ também busca na Receita.',
          'Endereço: obrigatório com CNPJ, opcional com CPF. Digitando o CEP, rua, bairro e cidade vêm sozinhos.',
          'A nota é enviada depois, na tela NFS-e / RPS/DPS.',
        ],
      },
      {
        titulo: 'Menu ⋮ do pátio',
        itens: [
          'Receber mensalidade: recebe a mensalidade de um mensalista (entra no caixa).',
          'Receber dívida: quita a dívida de uma placa sem precisar de uma nova estadia.',
          'Venda Produtos: vende produtos do balcão (entram no caixa).',
          'Cadastrar senha do mês: digita a senha de liberação mensal do sistema, enviada pelo fornecedor.',
        ],
      },
      {
        titulo: 'Saídas de hoje',
        texto: ['Lista as saídas do dia; "Reimprimir" imprime de novo o ticket de saída. Entradas excluídas aparecem como CANCELADO.'],
      },
    ],
  },
  {
    id: 'caixa',
    titulo: 'Caixa',
    rota: '/caixa',
    resumo: 'Abertura, sangria, reforço e fechamento do caixa de cada operador, com o resumo do turno.',
    secoes: [
      {
        titulo: 'Abrir o caixa',
        texto: ['Informe o troco de abertura. Cada operador tem o seu caixa; as saídas, mensalidades, antecipados, vendas e quitações de dívida feitas por ele entram no caixa aberto.'],
      },
      {
        titulo: 'Sangria e reforço',
        texto: ['Sangria é dinheiro retirado do caixa; reforço é dinheiro colocado (troco extra). Informe valor e motivo — os dois entram no "Esperado no caixa".'],
      },
      {
        titulo: 'Resumo do turno',
        itens: [
          'Estadias (Saídas): o valor cheio das estadias, incluindo o que o convênio vai pagar e a dívida gerada no turno.',
          'Dívida (turno): negativa quando o turno gerou dívida nova; positiva quando recebeu dívida de antes.',
          'Mensalidades, Antecipados, Venda de produtos: recebidos no turno.',
          'Total do turno: o que entrou de fato (sem o convênio, que é pago depois, e sem a dívida ainda não paga).',
          'Em dinheiro e Esperado no caixa: o que deve estar na gaveta (abertura + dinheiro + reforços − sangrias).',
        ],
      },
      {
        titulo: 'Movimentações do turno',
        texto: ['Extrato item a item. "Vl.Estadia" é só a tarifa daquela estadia ou mensalidade; "Dívida" mostra a dívida gerada (−) ou recebida (+) naquela linha.'],
      },
      {
        titulo: 'Fechar o caixa',
        texto: ['Conte o dinheiro e informe o valor contado; o sistema mostra a diferença em relação ao esperado. Depois do fechamento dá para ver a prévia do relatório, imprimir ou enviar por WhatsApp/e-mail — com ou sem a lista de movimentações. Os caixas fechados ficam no histórico para reimprimir.'],
      },
    ],
  },
  {
    id: 'reservas',
    titulo: 'Reservas de vaga',
    rota: '/reservas',
    resumo: 'Reserva de vaga por tipo (ex.: coberta/descoberta), período e dias, com calendário de vagas disponíveis.',
    secoes: [
      {
        titulo: 'Calendário',
        texto: [
          'Mostra, por dia, quantas vagas de cada tipo ainda sobram. Verde = folga, amarelo = apertado (menos de 5), vermelho = esgotado. Use "‹ Mês anterior" e "Mês seguinte ›" pra navegar.',
          'A conta usa as vagas cadastradas (Cadastros → Vagas/boxes), as reservas confirmadas e os mensalistas pelo dia/turno contratado. Avulsos não entram (não dá pra prever).',
          'Quando a filial tem vagas por turno (Manhã/Tarde/Noite no cadastro de vagas), cada dia mostra M, T e N separados; senão mostra o turno mais cheio (passe o mouse pra ver os três).',
        ],
      },
      {
        titulo: 'Nova reserva',
        itens: [
          'Tipo de vaga e Período: Integral (dia todo) ocupa os três turnos; Manhã, Tarde ou Noite só o próprio turno.',
          'De / Até: os dias da reserva (não aceita data passada).',
          'Nome, telefone, placa, modelo e observação são opcionais — com a placa, o pátio reconhece a reserva na chegada.',
          'Valor proposto: estimativa calculada pela tabela de preço do prefixo do código das vagas daquele tipo (ex.: vagas "C001…" → tabela "C"). A cobrança de verdade é na saída.',
          'Valor antecipado: recebido na hora, entra no caixa aberto (pede pra abrir um, se não houver) e é descontado na saída do veículo.',
          'Sem vaga em algum dia/turno, aparece o aviso com os dias que faltam — dá pra "Reservar mesmo assim".',
        ],
      },
      {
        titulo: 'Reservas do dia',
        itens: [
          'Clique num dia do calendário pra ver as reservas que o cobrem, com o total por tipo.',
          'Imprimir: ticket da reserva para o cliente. "Imprimir relatório do dia": lista completa do dia.',
          'Concluída / Não veio / Excluir: muda a situação da reserva. Excluir libera os dias de novo.',
          'Coluna "Chegou": marcada sozinha quando o carro da reserva dá entrada no pátio (não muda a situação).',
          'Reservas encerradas há mais de 30 dias são apagadas automaticamente.',
        ],
      },
      {
        titulo: 'Na entrada do pátio',
        texto: ['Ao digitar a placa de uma reserva confirmada para hoje, o pátio avisa e já traz o modelo; se o modelo estiver no catálogo, a entrada é registrada direto. O valor antecipado da reserva é somado ao antecipado da entrada.'],
      },
    ],
  },
  {
    id: 'bi',
    titulo: 'BI / Painel',
    rota: '/bi',
    resumo: 'Indicadores do período (saídas, valores por tipo, dívida, mensalidades, produtos), com detalhe por dia, operador e forma de pagamento.',
    secoes: [
      {
        titulo: 'Período e envio',
        texto: ['Escolha De / Até e clique em Atualizar (os números também se atualizam sozinhos a cada 30 segundos). "Ver veículos" inclui a lista de veículos no relatório. WhatsApp, Email e Imprimir mandam o relatório do período.'],
      },
      {
        titulo: 'Indicadores',
        itens: [
          'Saídas: quantidade de veículos que saíram no período.',
          'Avulso, Serviços, Convênio, Antecipados, Bônus fidelidade, Mensalidades e Venda de produtos: valores do período.',
          'Faturado = soma de todos esses — o valor cheio, antes de descontos e abatimentos.',
          'Dívida: saldo de dívida do período. Negativa quando gerou mais dívida (forma "Devedor") do que quitou; positiva quando quitou mais dívida antiga do que gerou.',
          'Tempo médio: permanência média dos veículos que saíram.',
        ],
      },
      {
        titulo: 'Detalhes',
        itens: [
          'Resumo por dia (quando o período tem mais de um dia).',
          'Por operador: saídas, mensalidades e vendas de produto de cada um.',
          'Por tipo, Cancelados por tipo e Por tipo de lavagem (serviços).',
          'Recebido por forma de pagamento.',
          'Mensalidades recebidas, Vendas de produtos (com o estoque atual) e a lista de Veículos.',
        ],
      },
    ],
  },
  {
    id: 'relatorio-convenios',
    titulo: 'Relatório de convênios',
    rota: '/relatorio-convenios',
    resumo: 'O que cada convênio deve no período, pelas saídas — é com ele que se cobra o conveniado.',
    secoes: [
      {
        titulo: 'Filtros',
        itens: [
          'Saída de / até: o período (conta a data de saída, quando o valor do convênio é apurado).',
          'Convênio e Grupo: em branco trazem todos. Escolhendo um grupo, sai um bloco por convênio com o total de cada um e o total do grupo no fim (o Grupo é cadastrado em Cadastros → Convênios).',
        ],
      },
      {
        titulo: 'Envio e impressão',
        texto: ['A tela e a impressão sempre mostram estadia por estadia (controle, placa, modelo, entrada, saída e valor do convênio). No WhatsApp e no e-mail vão só os totais por convênio e por grupo — marque "Detalhar estadias no envio" para mandar o detalhe (no WhatsApp pode ficar longo demais; aí o sistema avisa).'],
      },
    ],
  },
  {
    id: 'estatistica',
    titulo: 'Estatística',
    rota: '/estatistica',
    resumo: 'Gráficos com a quantidade de veículos por faixa de horário (entradas ou saídas) ou por tempo de permanência.',
    secoes: [
      {
        titulo: 'Filtros',
        itens: [
          'De / Até: o período analisado (os botões "Últimos 7/30/90 dias" preenchem as datas).',
          'Relatório: Entradas, Saídas ou Período (permanência).',
          'Intervalo: o tamanho de cada faixa — 15, 30 ou 60 minutos. Trocar o intervalo só reagrupa, não busca de novo.',
        ],
      },
      {
        titulo: 'Entradas e saídas',
        texto: ['Todos os dias do período são somados num único dia de 24 horas: a coluna das 08:00–08:30, por exemplo, é o total de veículos que entraram (ou saíram) nesse horário em todos os dias. Serve para ver os horários de pico e dimensionar a equipe.'],
      },
      {
        titulo: 'Permanência',
        texto: ['Quanto tempo cada veículo ficou, das saídas feitas no período, de 0 até a maior permanência. Mostra também a média, a mediana (metade ficou menos que isso) e a maior. Quando há permanências muito longas, o gráfico rola para o lado.'],
      },
      {
        titulo: 'Ler os números',
        texto: ['Passe o mouse (ou use as setas do teclado) numa coluna para ver a quantidade exata. "Ver como tabela" mostra os mesmos números em lista. Entram avulsos e mensalistas; entradas canceladas ficam de fora.'],
      },
    ],
  },
  {
    id: 'mensalistas-atraso',
    titulo: 'Mensalistas em atraso',
    rota: '/mensalistas-atraso',
    resumo: 'Lista dos mensalistas com a mensalidade vencida, do menor atraso para o maior.',
    secoes: [
      {
        titulo: 'Quem aparece',
        texto: ['Mensalistas ativos cujo "Próx. pagamento" (no cadastro de Mensalistas) é igual ou anterior à data de emissão — quem vence no próprio dia aparece com "vence hoje". Mensalista sem data de próximo pagamento ou inativo fica de fora. Ao receber a mensalidade, a data avança um mês e ele sai da lista.'],
      },
      {
        titulo: 'Colunas e impressão',
        texto: ['Placa (todas as do mensalista), nome, último vencimento e dias em atraso. A data de emissão começa em hoje e pode ser trocada para ver o atraso em outra data. "Imprimir" sai com o cabeçalho do estacionamento e a data de emissão.'],
      },
    ],
  },
  {
    id: 'ocupacao-turno',
    titulo: 'Ocupação por turno',
    rota: '/ocupacao-turno',
    resumo: 'Quantas vagas estão ocupadas em cada dia, na manhã, tarde e noite — reservas mais mensalistas. Impresso na bobina.',
    secoes: [
      {
        titulo: 'O que entra na conta',
        itens: [
          'Reservas confirmadas e concluídas: a reserva Integral (dia todo) conta nos três turnos; Manhã, Tarde ou Noite contam só no próprio turno. Canceladas e "Não veio" ficam de fora.',
          'Mensalistas ativos, pela quantidade de vagas contratadas, em cada turno contratado naquele dia da semana (Mensalistas → Editar → dia/turno contratado). Mensalista sem restrição de turno conta nos três turnos, todos os dias.',
        ],
      },
      {
        titulo: 'Na tela e na impressão',
        texto: ['Escolha o período (o botão "Próximos 7 dias" preenche uma semana a partir de hoje). Cada turno tem duas colunas: Livres (vagas do turno menos as ocupadas, em amarelo) e Ocupadas (reservas + mensalistas, em verde, com a quebra R/M embaixo). Quando o turno lota, os dois ficam em vermelho. As vagas do turno são as Integrais + as daquele turno (ver Cadastros → Vagas/boxes). "Imprimir" sai na bobina de 58mm: uma linha por dia (dia da semana e data) e, em cada turno, Liv e Oc — turno lotado sai em negrito.'],
      },
    ],
  },
  {
    id: 'precos',
    titulo: 'Tabelas de preço',
    rota: '/precos',
    resumo: 'Quanto cobrar pelo tempo de permanência: cada tabela (código + descrição) tem as faixas de tempo e valor.',
    secoes: [
      {
        titulo: 'A tabela',
        itens: [
          'Tipo (código): o código curto da tabela (ex.: P, C, M). É ele que aparece no pátio e no modelo de veículo.',
          'Pontos fidelidade: quantos pontos o cliente ganha a cada saída nesta tabela (ver Faixas de bônus).',
          'Valor antecipado (evento/promoção): valor fixo já cobrado na entrada — o campo "Vlr. antecipado" da entrada vem preenchido quando o modelo usa esta tabela.',
          'Valor do serviço: valor fixo cobrado quando esta tabela é usada como Serviço (Cadastros → Serviços). Sem efeito numa tabela de veículo.',
          'Seleção manual na Entrada: a tabela aparece na lista para escolher na mão quando o carro não está no catálogo de modelos.',
          'Clique numa tabela da lista pra ver e editar as faixas dela embaixo.',
        ],
      },
      {
        titulo: 'Faixas',
        itens: [
          'Até (HH.MM): o tempo máximo da faixa, em hora comercial — 1.30 = 1h30, 24.00 = 24h (o decimal é minuto, não fração de hora).',
          'Fixo: cobra o valor cheio da faixa.',
          'Por período: o valor é por período (0.30 = 30 min, 1 = 1h, 24 = 24h), contado a partir do fim da faixa anterior; fração de período arredonda pra cima.',
          'Pede valor: sem número fixo — na saída, o operador informa quanto cobrar.',
          'Valor convênio: o que o convênio paga nesta faixa, para convênios com "Grade própria (CON)".',
          'Editar e Excluir em cada linha; "+ Faixa" adiciona no fim.',
        ],
      },
    ],
  },
  {
    id: 'convenios',
    titulo: 'Convênios',
    rota: '/convenios',
    resumo: 'Empresas ou parceiros que pagam toda ou parte da estadia do cliente (desconto na saída).',
    secoes: [
      {
        titulo: 'Como o convênio desconta',
        itens: [
          'Escolha UMA forma: % desc. (percentual sobre o valor calculado), Vlr fixo (valor fixo, independente do tempo) ou Grade própria (CON — o valor da coluna "Valor convênio" da faixa).',
          'Tabela alt.: calcula por outra tabela de preço em vez da do veículo; combina com qualquer uma das três formas.',
          'Pede hora: na saída, o operador informa o horário em que o cliente saiu do convênio (vem carimbado no ticket). O convênio paga até ali; o resto é cobrado do cliente pela "Tabela depois do convênio" (em branco, pela tabela do veículo).',
          'Tipo: Convênio ou Vale.',
        ],
      },
      {
        titulo: 'Outros campos',
        itens: [
          'Só supervisor: na saída do pátio, o convênio só aparece na lista para supervisor — operador e gerente não escolhem.',
          'Grupo: junta convênios de uma mesma rede/matriz no Relatório de convênios. Não muda a cobrança.',
          'CNPJ/CPF, inscrição, endereço, cidade, CEP, telefone e e-mail: necessários quando a nota fiscal sai no nome do convênio.',
        ],
      },
    ],
  },
  {
    id: 'mensalistas',
    titulo: 'Mensalistas',
    rota: '/mensalistas',
    resumo: 'Mensalistas, pacotes e hóspedes: cadastro, veículos, vagas contratadas, vencimento e recebimento da mensalidade.',
    secoes: [
      {
        titulo: 'Lista',
        itens: [
          'Ordenar por Placa/código, Nome (A-Z) ou Data de vencimento (o mais atrasado primeiro).',
          '"Vencida" ao lado do Próx. pagamento: passou do vencimento mais a tolerância — no pátio entra como avulso.',
          'Clique na linha pra ver os veículos e o histórico de recebimentos (com reimpressão do recibo).',
        ],
      },
      {
        titulo: 'Cadastro (Editar / + Novo)',
        itens: [
          'Código: normalmente a placa do veículo principal.',
          'Tipo: Mensalista, Pacote ou Hóspede. Pacote vale até o Próx. pagamento; no dia seguinte é desativado sozinho e, 7 dias depois, excluído (os recebimentos continuam no caixa e no BI). Renovar a data antes disso o reativa.',
          'CPF/CNPJ: tomador da nota fiscal da mensalidade. Com CNPJ, dá pra buscar nome e endereço da empresa automaticamente.',
          'Recolhimento do ISS: padrão da filial, Normal (A) ou Retido (R).',
          'Valor da mensalidade, Data do próximo pagamento, Dia vencimento (dia fixo do mês) e Tolerância (dias de carência depois do vencimento).',
          'Vagas contratadas: quantos veículos dele podem estar no pátio ao mesmo tempo; os excedentes entram como avulso.',
          'Dias e turnos contratados: desmarque o que NÃO está contratado. Fora do contratado, a entrada é cobrada como avulso até o início do próximo turno contratado do dia.',
          'Aceita Extra?: aparece na saída do pátio para receber dívida de avulso (forma "Devedor" → "Mensalista"), cobrada junto com a próxima mensalidade.',
          'Ativo: desmarcado, a placa entra como avulso.',
        ],
      },
      {
        titulo: 'Veículos',
        texto: ['Na linha expandida, cadastre as placas do mensalista (com modelo e tabela). Cada placa só pode estar em um mensalista. A câmera (📷) lê a placa por foto, se estiver ligada nas Configurações.'],
      },
      {
        titulo: 'Receber',
        itens: [
          'Precisa de caixa aberto (se não houver, a tela pede o troco pra abrir).',
          'Informe data, valor (sugerido pelo cadastro), forma de pagamento e o próximo pagamento (já vem calculado: um mês depois, ou o Dia vencimento).',
          'Dívida de avulso pendente (Aceita Extra?) aparece com o botão "Incluir" para somar no valor.',
          'Gerar nota fiscal (DPS): aparece quando a filial emite NFS-e; usa o CPF/CNPJ do mensalista como tomador.',
          'Ao confirmar, sai o comprovante de recebimento e a data do próximo pagamento avança no cadastro.',
        ],
      },
    ],
  },
  {
    id: 'formas',
    titulo: 'Formas de pagamento',
    rota: '/formas',
    resumo: 'As formas que aparecem na saída do pátio, nas mensalidades e nas vendas (dinheiro, débito, crédito, Pix…).',
    secoes: [
      {
        titulo: 'Campos',
        itens: [
          'Código e Descrição: como aparece nas listas e nos relatórios.',
          'É dinheiro: entra no "Em dinheiro" e no "Esperado no caixa" do fechamento.',
          'É "Devedor": o valor não é recebido — vira dívida da placa (ou de um mensalista que aceita extra), cobrada numa próxima vez.',
          'InfiniteTap (Crédito/Débito): liga a forma ao botão "Cobrar no celular" da cobrança por aproximação.',
          'É "Sem Parar": usada na saída de veículo autorizado pelo Sem Parar.',
          'Ativo: desmarcado, a forma some das listas.',
          '% ajuste e RPS/DPS sempre vêm do sistema antigo e hoje não mudam a cobrança.',
        ],
      },
    ],
  },
  {
    id: 'vagas',
    titulo: 'Vagas/boxes',
    rota: '/vagas',
    resumo: 'Quantidade de vagas por tipo e turno — é a base da conta de vagas das Reservas e do relatório Ocupação por turno.',
    secoes: [
      {
        titulo: 'Campos',
        itens: [
          'Código: o prefixo (letras iniciais) diz qual tabela de preço calcula o valor proposto da reserva — ex.: "C001" usa a tabela "C". Sem prefixo, a reserva fica sem valor proposto.',
          'Tipo: texto livre (ex.: Coberta, Descoberta, Normal). Use exatamente o mesmo texto em todas as vagas do mesmo tipo.',
          'Turno: Integral (vale nos três turnos, o normal) ou Manhã/Tarde/Noite (só naquele turno, para quem reserva por turno).',
        ],
      },
      {
        titulo: 'Cadastrar em lote',
        texto: [
          'Cria várias vagas de uma vez: Tipo, Turno, Prefixo do código, Quantidade e "Começa em" (ex.: prefixo C, 40 vagas → C001 a C040).',
          'Para reservar por turno com uma quantidade de vagas em cada turno, crie um lote por turno com o mesmo Tipo (ex.: 20 Manhã, 20 Tarde, 20 Noite). Sem prefixo, use o "Começa em" para os códigos não se repetirem (1, 21, 41).',
        ],
      },
    ],
  },
  {
    id: 'produtos',
    titulo: 'Produtos',
    rota: '/produtos',
    resumo: 'Produtos vendidos no balcão (água, item de loja…), com controle de estoque.',
    secoes: [
      {
        titulo: 'Como funciona',
        texto: ['Cadastre código, descrição, valor de compra, valor de venda e estoque. A venda é feita no Pátio → ⋮ → Venda Produtos: baixa o estoque, entra no caixa do operador e aparece no BI. Venda de produto nunca gera nota fiscal de serviço (RPS/NFS-e).'],
      },
    ],
  },
  {
    id: 'modelos',
    titulo: 'Modelos de veículo',
    rota: '/modelos',
    resumo: 'Catálogo de modelos e a tabela de preço padrão de cada um.',
    secoes: [
      {
        titulo: 'Como funciona',
        texto: ['Na entrada, ao escolher o modelo, o pátio já usa a "Tabela padrão" dele (ex.: moto → tabela M). Carro fora do catálogo: a entrada pede a tabela (só aparecem as marcadas como "Seleção manual" em Tabelas de preço) e o nome do carro novo, que passa a fazer parte do catálogo. Nesta tela dá pra buscar e ordenar por código ou nome.'],
      },
    ],
  },
  {
    id: 'servicos',
    titulo: 'Serviços',
    rota: '/servicos',
    resumo: 'Serviços cobrados à parte da estadia (lavagem, polimento…) e a tabela de preço de cada um.',
    secoes: [
      {
        titulo: 'Como funciona',
        itens: [
          'Cada serviço usa uma tabela de preço: o valor vem das faixas dela ou do "Valor do serviço" fixo da tabela. Faixa "Pede valor" pergunta o valor na hora.',
          'No pátio: botão "Serviços" na entrada, ou "Serviço" na lista de veículos no pátio. O serviço é somado na saída, separado da estadia.',
          'O BI mostra os serviços em "Por tipo de lavagem".',
        ],
      },
    ],
  },
  {
    id: 'bonus',
    titulo: 'Faixas de bônus',
    rota: '/bonus',
    resumo: 'Desconto por pontos de fidelidade acumulados pelo cliente.',
    secoes: [
      {
        titulo: 'Como funciona',
        texto: ['O cliente ganha pontos a cada saída (os "Pontos fidelidade" da tabela de preço e dos serviços). Cada faixa diz quantos pontos valem quanto de desconto — ex.: 1000 pontos = R$ 50, 2000 pontos = R$ 110. Na saída, o sistema oferece a maior faixa que o cliente já alcançou; o desconto aparece no BI como "Bônus fidelidade".'],
      },
    ],
  },
  {
    id: 'importar',
    titulo: 'Importar do legado (.dbf)',
    rota: '/importar',
    resumo: 'Traz cadastros e RPS pendentes do sistema antigo (Harbour/Clipper). Só o fornecedor acessa — é usado na implantação.',
    secoes: [
      {
        titulo: 'Como funciona',
        itens: [
          'Escolha o que importar e o arquivo .dbf; o sistema detecta as colunas e mostra o mapeamento antes de gravar.',
          'Tabelas de preço: mostra as tabelas detectadas no arquivo.',
          'RPS pendentes (ESTAMORT.DBF): os RPS gerados e ainda sem NFS-e, para enviar por aqui (série 11000).',
          'Importar modelo de ticket (.txt): traz o layout de um comprovante do sistema antigo.',
        ],
      },
    ],
  },
  {
    id: 'fiscal',
    titulo: 'NFS-e / RPS/DPS',
    rota: '/fiscal',
    resumo: 'Envio das notas fiscais de serviço geradas no pátio e no recebimento de mensalidade.',
    secoes: [
      {
        titulo: 'Situação de cada nota',
        itens: [
          'gerada: pronta para enviar.',
          'enviada: aguardando — no ABRASF, o protocolo da prefeitura; pelo UniNFe, o retorno dele.',
          'autorizada: virou NFS-e; o número aparece na coluna Chave/NFS-e.',
          'erro: recusada ou barrada antes do envio — veja o motivo em "Retorno".',
        ],
      },
      {
        titulo: 'Enviar',
        texto: [
          '"Enviar" (ou "Enviar todos") transmite no padrão escolhido em Configurações → Fiscal. Antes de enviar, o sistema confere a configuração fiscal, o endereço do tomador com CNPJ e o formato do XML — se algo estiver errado, a nota fica em erro com a explicação, sem chegar à prefeitura.',
          'A alíquota de ISS usada é sempre a da configuração atual: corrigiu a alíquota, é só reenviar.',
        ],
      },
      {
        titulo: 'Alterar uma nota',
        texto: ['"Alterar" muda competência, valor, descrição e o tomador (CPF/CNPJ, nome, endereço, ISS retido). Ao digitar o CPF/CNPJ, os dados já conhecidos são preenchidos; o CEP preenche o endereço. Depois de alterar, envie de novo.'],
      },
      {
        titulo: 'Envio pelo UniNFe (certificado A3)',
        texto: [
          'Com a opção ligada em Configurações → Fiscal, o computador da cabine envia pelo UniNFe: na primeira vez clique em "Conectar pasta do UniNFe" e escolha a pasta (ex.: C:\\sisparkweb, com as subpastas Envio, Retorno e Erro). O UniNFe precisa estar aberto e o certificado A3 plugado.',
          'O retorno é lido sozinho a cada poucos segundos com a tela aberta; "Consultar" lê na hora. Nota que ficou em erro mas pode ter sido autorizada: use "Ler retorno" — não reenvie uma nota já autorizada.',
          'O destino é o município configurado na empresa dentro do UniNFe: deixe igual ao padrão escolhido no app.',
        ],
      },
      {
        titulo: 'Erros comuns',
        itens: [
          'L9999 "desacordo com o XML Schema": dado fora do formato — o motivo detalhado aparece no retorno.',
          'E0008 (data de emissão posterior ao processamento): relógio do computador adiantado — sincronize o relógio do Windows.',
          'E0120 / E0116 (inscrição municipal): ver a opção de inscrição municipal no Padrão Nacional, em Configurações → Fiscal.',
          'E0166 (regime de apuração do Simples): confira "Regime de apuração no Simples (ME/EPP)" em Configurações → Fiscal.',
          'Alíquota recusada: confirme o % de ISS com o contador, corrija em Configurações → Fiscal e reenvie.',
        ],
      },
      {
        titulo: 'Imprimir e consultar',
        texto: ['"Imprimir" gera o RPS no layout de Modelos de ticket; "XML" mostra o documento enviado; "Retorno" mostra a resposta da prefeitura/governo.'],
      },
    ],
  },
  {
    id: 'configuracoes',
    titulo: 'Dados do estacionamento (Configurações)',
    rota: '/configuracoes',
    resumo: 'Dados da empresa, aparência, opções do pátio, integrações e emissão de NFS-e.',
    secoes: [
      {
        titulo: 'Aparência e impressão (por navegador)',
        itens: [
          'Tema claro ou escuro.',
          '"Este navegador imprime os pedidos vindos do celular": ligue só na janela aberta pelo atalho da cabine (pdv-cabine.bat).',
          'O fornecedor baixa os atalhos da cabine (pdv-cabine.bat para Chrome, pdv-cabine-edge.bat para Edge) logo abaixo dessa opção, na hora de instalar o micro.',
          'Impressora Bluetooth: pareie uma impressora térmica para imprimir direto do celular/tablet.',
        ],
      },
      {
        titulo: 'Dados do estacionamento',
        texto: ['Nome, CNPJ, inscrições, endereço e telefone — aparecem no cabeçalho dos tickets e nas notas fiscais.'],
      },
      {
        titulo: 'Opções do pátio',
        itens: [
          'Imprime ticket para mensalista/hóspede?',
          'Usa leitura de placa por foto (câmera)?',
          'Usa entrada de placa por voz (microfone)?',
          'Usa reservas de vaga? (desmarcado, o menu Reservas some).',
          'Reiniciar o nº de controle a cada (dias): o número do ticket volta pro 1 à meia-noite a cada tantos dias (padrão 1 = todo dia; 0 = não reinicia sozinho). Números de carros ainda no pátio são pulados.',
        ],
      },
      {
        titulo: 'Número de controle do ticket',
        texto: ['O supervisor pode reiniciar a numeração na hora pelo botão "Reiniciar numeração agora": a próxima entrada sai com o nº 1, pulando os carros que ainda estão no pátio. A contagem dos dias para o reinício automático passa a valer a partir desse clique.'],
      },
      {
        titulo: 'Integrações',
        itens: [
          'Sem Parar: ligue e informe o código do estabelecimento e o hash fornecidos pelo Sem Parar.',
          'Cobrança por aproximação (InfiniteTap).',
        ],
      },
      {
        titulo: 'Fiscal (NFS-e)',
        itens: [
          'Habilitada pela prefeitura: liga o menu NFS-e / RPS/DPS e o "Gerar DPS" no pátio.',
          'Emitir RPS/DPS em todas as saídas.',
          'Padrão de envio: Padrão Nacional Campinas (prefeitura), Padrão Nacional (governo federal) ou ABRASF.',
          'Enviar pelo UniNFe: para certificado A3 (veja o tópico NFS-e / RPS/DPS).',
          'Códigos de tributação nacional e municipal (o municipal aceita os 9 dígitos que a prefeitura mostra, ex.: 110101001) e Código NBS (estacionamento: 1.0604.30.00).',
          'Regime tributário (Simples Nacional) e, para ME/EPP, o regime de apuração; % de ISS — confirme com o contador.',
          'Ambiente: homologação para testes, produção para valer.',
          'Certificado digital A1 (.pfx): cadastrado pelo fornecedor nesta mesma tela.',
        ],
      },
    ],
  },
  {
    id: 'usuarios',
    titulo: 'Usuários',
    rota: '/usuarios',
    resumo: 'Quem acessa o sistema, com que papel e quais telas pode abrir.',
    secoes: [
      {
        titulo: 'Papéis',
        itens: [
          'Operador: pátio, caixa e reservas (e a Ocupação por turno).',
          'Gerente: tudo do operador + BI, relatórios, mensalistas, convênios, serviços, modelos, fiscal e contas a receber.',
          'Supervisor: tudo do estacionamento, inclusive preços e usuários (alguns dados das Configurações só o fornecedor altera).',
          'Fornecedor: quem mantém o sistema — acessa todos os estacionamentos.',
        ],
      },
      {
        titulo: 'Telas que pode acessar',
        texto: ['No cadastro do usuário, as caixinhas começam com as telas do papel. Marque ou desmarque para liberar ou bloquear telas só para aquela pessoa — a lista mostra "telas escolhidas" quando foi personalizado. Ajuda e Sobre ficam sempre liberadas.'],
      },
      {
        titulo: 'Criar e manter',
        itens: [
          '+ Novo: "Criar login novo" (e-mail e senha inicial) ou "Vincular um login que já existe" (UID do Supabase).',
          'Trocar senha: define uma nova senha para o usuário.',
          'Ativo: desmarcado, o usuário não consegue mais entrar.',
        ],
      },
    ],
  },
  {
    id: 'modelos-ticket',
    titulo: 'Modelos de ticket',
    rota: '/modelos-ticket',
    resumo: 'O layout de cada comprovante impresso, em texto com tokens entre arrobas, como no sistema antigo.',
    secoes: [
      {
        titulo: 'Como funciona',
        itens: [
          'Escolha o comprovante: Entrada, Saída, 2ª via, Recebimento de mensalidade, RPS/NFS-e, Reserva de vaga ou Dívida. O ✓ indica que a filial já tem modelo próprio.',
          'Edite o texto à esquerda e confira na Pré-visualização (com dados de exemplo). A lista de tokens disponíveis fica ao lado.',
          'Salvar modelo grava para esta filial. "Restaurar modelo padrão" traz o texto de exemplo; "Voltar ao layout fixo" apaga o modelo próprio.',
          'Só supervisores editam. Dá pra colar um modelo .txt do sistema antigo (ou importar em Importar do legado).',
        ],
      },
      {
        titulo: 'Tokens e condições',
        itens: [
          '@CC@ = placa, @C#@ = número de controle, e assim por diante (lista completa na própria tela). Token desconhecido sai em branco.',
          '@SE(campo)@ no começo da linha: a linha só sai se o campo tiver conteúdo; @SE(#campo)@ só se estiver vazio.',
          '@SE(campo=valor)@ e @SE(campo<>valor)@ (ou #): compara o campo com um valor.',
          'Formatação: @PG+@ … @PG-@ (grande), @PP+@ (pequeno), @PE+@ (negrito), @PI+@ (itálico), @PS+@ (sublinhado).',
        ],
      },
    ],
  },
  {
    id: 'acesso',
    titulo: 'Acesso, senhas e usuários simultâneos',
    resumo: 'Senha do mês, limite de postos usando o sistema ao mesmo tempo e a segunda senha do fornecedor.',
    secoes: [
      {
        titulo: 'Senha do mês',
        texto: ['Depois do login, o sistema pode pedir a senha do mês, informada pelo fornecedor. Sem ela não libera. Ao pedir por telefone ou mensagem, informe o número do cliente que aparece na tela.'],
      },
      {
        titulo: 'Usuários simultâneos',
        texto: ['A filial pode ter um limite de postos usando o sistema ao mesmo tempo (definido pelo fornecedor). Cada navegador conta como um posto — duas abas na mesma máquina contam uma vez só; a cabine e o celular contam separados. Ao atingir o limite aparece "Limite de usuários atingido": feche o sistema em outro posto (botão Sair) e clique em "Tentar novamente".'],
      },
      {
        titulo: 'Fornecedor',
        texto: ['O usuário fornecedor digita uma segunda senha depois do login e então escolhe qual estacionamento acessar. A liberação vale para a aba aberta; ao sair ou abrir outra aba, pede de novo.'],
      },
    ],
  },
];
