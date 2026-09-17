# esta — Status do build e pontos de integração

Complemento do [ANALISE-E-ARQUITETURA.md](ANALISE-E-ARQUITETURA.md). Registra o
que já está construído por fase e o que depende de terceiros.

## Como colocar tudo no ar

**1. Migrations (SQL Editor do Supabase, na ordem):**
```
supabase/migrations/0001_core_schema.sql   (núcleo)          ✅ aplicado
supabase/migrations/0002_rls.sql           (RLS)             ✅ aplicado
supabase/migrations/0003_caixa.sql         (Fase 3 — caixa)
supabase/migrations/0004_financeiro.sql    (Fase 5)
supabase/migrations/0005_fiscal.sql        (Fase 4)
```
**2. Seeds:** `seed_referencia.sql` (já aplicado) e, se quiser, `local/seed_cadastros.sql`.

**3. App:** `.env.local` com as chaves + `npm run dev` (porta 5174). Na Vercel,
as mesmas variáveis em *Settings → Environment Variables*.

## Estado por fase

| Fase | Entrega | Estado |
|---|---|---|
| **1 — Motor de tarifação** | Pacote puro + 20 testes; reconciliado (87% com tabela recuperada) | ✅ funcional |
| **2 — PDV** | Login, Pátio (entrada com detecção de mensalista/convênio, saída com cálculo real + split de pagamento + fidelidade), CRUDs (preços/faixas, convênios, mensalistas, formas, vagas, modelos) | ✅ funcional |
| **3 — Caixa + BI** | Abertura/sangria/fechamento por operador; painel de KPIs em tempo real | ✅ funcional (após 0003) |
| **5 — Financeiro** | A receber (ponte mensalidade→título), a pagar, banco/lançamentos | ✅ funcional (após 0004) |
| **4 — Fiscal** | Geração, assinatura (XMLDSig) e envio (mTLS) do DPS pro Sistema Nacional NFS-e | ✅ funcional (após 0005 + 0054) — cada filial configura seu próprio certificado |
| **6 — Integrações** | Pix/cartão, app do cliente, LPR, cancela | ⚠️ LPR por foto (Plate Recognizer) funcional; resto depende de terceiros (abaixo) |

### NFS-e — DPS assinado e enviado pro governo
- **Como funciona:** a tela **Fiscal** gera o DPS (`src/lib/fiscal.js`) e o
  botão **Enviar** chama `api/gerar-nfse.js` — uma Vercel Function (Node.js,
  não Deno/Supabase) porque a autenticação com o governo é **mTLS**
  (certificado na própria conexão HTTPS) e o documento precisa de
  **assinatura digital XMLDSig** — nada disso roda no navegador. Resposta é
  síncrona: a NFS-e já volta autorizada, ou o motivo da rejeição (aparece no
  botão "Retorno" da nota).
- **Certificado — um por filial** (`fiscal_certificados`, ver
  `supabase/migrations/0054_fiscal_certificado.sql`): cada cliente tem CNPJ e
  certificado próprios (ex.: Ginpark e AR7), então não dá mais pra usar uma
  única variável de ambiente global como antes. Guarda no Supabase, numa
  tabela **sem nenhuma policy de RLS pra `authenticated`** — nem o fornecedor
  da própria filial lê direto pelo navegador; só as Vercel Functions
  (`api/certificado-fiscal.js`, `api/gerar-nfse.js`, `api/consultar-nfse.js`)
  alcançam, com a chave de `service_role`, e só depois de confirmar a filial
  de quem chamou pelo client normal (com RLS). Precisa de
  `SUPABASE_SERVICE_ROLE_KEY` nas Environment Variables da Vercel (já
  configurada pra outras functions, ex. `criar-usuario.js`).
- **Ativar pra uma filial (fornecedor, em Configurações → Fiscal):**
  1. Preencher Inscrição municipal, Código do município (IBGE), Série, Código
     de tributação nacional (6 dígitos — confirme com o contador, não é o
     CNAE) e % ISS. Deixar "Ambiente de envio" em **Homologação** até validar.
  2. No card "Certificado digital (.pfx) desta filial": escolher o arquivo
     `.pfx`, digitar a senha e clicar **Salvar certificado** — o app confere
     na hora se o arquivo e a senha abrem juntos antes de gravar. Depois de
     salvo, nem o arquivo nem a senha aparecem de novo em lugar nenhum; só dá
     pra trocar por outro.
  3. Testar: gerar um RPS na tela Fiscal, clicar **Enviar**, confirmar que
     autoriza em Homologação. Só depois trocar "Ambiente de envio" pra
     **Produção**.
  - Pra trocar de filial (Ginpark, AR7, …) antes do passo 2, use o seletor de
    filial do fornecedor (topo do app) — o certificado salvo é sempre o da
    filial ativa no momento.
- **Pendência conhecida:** a documentação pública da integração (ADN) é
  fragmentada — o XML e a assinatura foram validados localmente (assinatura
  XMLDSig conferida byte a byte com certificado de teste), mas o formato
  exato de alguns campos do DPS só se confirma testando contra a homologação
  de verdade. Se a ADN rejeitar algo, o retorno completo aparece na tela —
  me manda que eu ajusto.

## Fase 6 — pontos de integração (dependem de você)

Estas funcionalidades não têm como "funcionar" só com software: precisam de conta
em provedor, certificado ou hardware. Abaixo o contrato de cada uma, pronto para
ligar quando o recurso existir.

### Pagamento Pix / cartão (precisa de PSP)
- **Hoje:** registrar Pix/cartão **manualmente** já funciona (formas de pagamento
  são cadastro; o split na saída grava em `movimento_pagamentos`).
- **Falta (automação):** conta em um PSP (ex.: Mercado Pago, PagBank, Stone, Asaas)
  com chaves de API e URL de webhook.
- **Contrato sugerido:** ao cobrar, chamar o PSP para criar cobrança (Pix → QR code;
  cartão → link/maquininha); PSP confirma via **webhook** → uma Edge Function do
  Supabase marca `movimento_pagamentos`/título como pago. Guardar `psp_id` no pagamento.

### App do cliente (precisa de decisão de acesso)
- **Base pronta:** tabela `clientes` (placa, visitas, pontos, aniversário).
- **Falta:** um app/portal separado com **autenticação do cliente** (por placa+PIN,
  telefone/OTP, ou e-mail). Como expõe dados pessoais, não pode ser consulta pública
  aberta — precisa de credencial. Sugerido: Supabase Auth (OTP por SMS/e-mail) +
  RLS específica para o cliente ver só os próprios dados.

### LPR — leitura de placa por foto ✅ funcional (falta só o secret)
- **Como funciona:** botão de câmera (📷) na Entrada/Saída do Pátio e no cadastro
  de veículo do mensalista. Foto (câmera ao vivo ou arquivo) → Edge Function
  `supabase/functions/ler-placa` → API do **Plate Recognizer** (Snapshot Cloud,
  a chave fica só no servidor) → o operador escolhe/confirma a placa lida antes
  de qualquer gravação (a leitura nunca preenche/decide por conta própria).
- **Falta pra ativar:** criar conta em platerecognizer.com, gerar o token
  (Snapshot Cloud → API Token) e rodar:
  ```
  npx supabase login
  npx supabase link --project-ref <ref-do-projeto>
  npx supabase functions deploy ler-placa
  npx supabase secrets set PLATE_RECOGNIZER_TOKEN=xxxxxxxxxxxxxxxx
  ```
  Plano gratuito: ~2.500 leituras/mês, 1 leitura/segundo (dá pra começar sem custo).
- **Pendência futura (câmera fixa + agente local):** o fluxo acima é "operador
  tira foto"; câmera fixa detectando sozinha na cancela ainda depende do agente
  local (Opção B) — mesmo contrato de sempre: agente detecta e faz `POST` pro PDV
  (ou grava direto via Supabase) preenchendo a placa da entrada.

### Cancela / hardware (precisa do agente local + equipamento)
- **Falta:** o **agente local na cabine** (serial/USB) — o navegador não controla
  cancela/impressora/serial com segurança. Decisão "Opção B" já registrada na arquitetura.
- **Contrato:** agente expõe um serviço local (ex.: `http://localhost:9123`) com
  `abrir-cancela`, `imprimir-ticket`, e um **buffer offline** ("para-quedas") que
  sincroniza com o Supabase quando a internet volta. O PDV chama esse serviço local.

> Resumo: o **software está pronto para todas as fases**; Pix/cartão automático,
> app do cliente, LPR e cancela ficam à espera de conta em PSP, definição de acesso
> do cliente e do agente local + hardware. Nada disso bloqueia a operação do dia a
> dia (entrada, saída, cobrança, caixa, BI, financeiro e geração fiscal já funcionam).
