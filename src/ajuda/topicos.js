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
          'Faturado (saídas): o valor cheio das estadias, incluindo o que o convênio vai pagar e a dívida gerada no turno.',
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
        ],
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
];
