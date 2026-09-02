# Cobrança idempotente via checkout

Como o CobraDora confirma um pagamento InfinitePay **exatamente uma vez** — e o roteiro para
reproduzir o mesmo padrão com qualquer gateway, em qualquer plataforma.

**Origem:** `prototipo-saas` / `src/services/checkout.ts`, `src/services/webhook-processing.ts`
**Gateway de referência:** InfinitePay

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Modelo de dados](#2-modelo-de-dados)
3. [A abstração do gateway](#3-a-abstração-do-gateway)
4. [Fluxo 1 — Criar o checkout](#4-fluxo-1--criar-o-checkout)
5. [Fluxo 2 — Confirmar via webhook](#5-fluxo-2--confirmar-via-webhook)
6. [Fluxo 3 — Fallback sem depender do webhook](#6-fluxo-3--fallback-sem-depender-do-webhook)
7. [Segurança dos tokens](#7-segurança-dos-tokens)
8. [Casos-limite](#8-casos-limite)
9. [Checklist de adaptação](#9-checklist-de-adaptação)

---

## 1. Visão geral

Um checkout externo tem um problema estrutural: entre o momento em que você redireciona a pessoa
pro gateway e o momento em que sabe se ela pagou, existe uma janela onde *qualquer coisa* pode
falhar — a chamada de criação do link, a rede, o webhook de confirmação, um clique duplicado no
botão "pagar". A maioria das integrações trata esses casos como exceção. Este padrão trata como o
caminho principal.

> **A ideia central:** toda confirmação de pagamento passa por um único ponto de entrada
> transacional, protegido por uma chave de idempotência — não importa se ela chegou pelo webhook
> do gateway ou por um polling de fallback. E toda falha na *criação* do checkout é classificada
> como **definitiva** (seguro liberar a cobrança) ou **ambígua** (o gateway pode ter recebido o
> pedido mesmo assim — nunca reenviar).

O restante deste documento descreve cada peça desse desenho usando a implementação real do
CobraDora com a InfinitePay como referência concreta. Os nomes de campos e tabelas são exemplos —
adapte-os ao seu gateway e ao seu esquema, mas mantenha os **papéis** que cada um cumpre. Onde um
papel for descartado sem substituto, alguma classe de bug volta a existir: cobrança duplicada,
checkout perdido, ou uma cobrança presa pra sempre em "processando".

## 2. Modelo de dados

Cinco tabelas, cada uma com um papel específico. Nenhuma é dispensável — cada uma existe porque
uma versão anterior, mais simples, do sistema quebrou de um jeito específico sem ela.

| Tabela | Papel | Campos que carregam a lógica |
|---|---|---|
| `checkout_sessions` | Uma tentativa de checkout, do clique em "pagar" até a confirmação (ou desistência). | `status`, `external_creation_state`, `expires_at`, `idempotency_key`, `webhook_token_hash`, `recovery_token_hash` |
| `checkout_items` | Quais cobranças entram nesta sessão, e o valor congelado de cada uma no momento da criação. | `checkout_session_id`, `charge_id`, `amount` |
| `payments` | O pagamento confirmado de fato — só existe depois que o gateway confirmou. | `gateway_payment_id` (unique), `amount`, `status`, `paid_at` |
| `payment_allocations` | Como um pagamento se distribui entre as cobranças que ele quitou. | `payment_id`, `charge_id` (unique), `amount` |
| `webhook_events` | Registro de cada entrega de webhook recebida — a chave de idempotência do lado do gateway. | `provider` + `external_event_id` (unique), `payload_hash`, `processing_status` |

### Os dois campos que fazem o trabalho pesado

`external_creation_state` em `checkout_sessions` é a peça menos óbvia e mais importante do desenho
inteiro — é ela que separa "não criei o checkout" de "não sei se criei o checkout". Ver
[Fluxo 1](#4-fluxo-1--criar-o-checkout).

`webhook_token_hash` / `recovery_token_hash` guardam só o hash de dois segredos derivados por
sessão (nunca o segredo em claro) — é o que autentica o webhook de confirmação e o polling de
fallback sem depender de um segredo global do gateway. Ver [Segurança](#7-segurança-dos-tokens).

## 3. A abstração do gateway

O resto do sistema nunca fala com a InfinitePay diretamente — só com esta interface. Trocar de
gateway (ou suportar dois ao mesmo tempo) vira uma questão de escrever um novo adaptador, não de
reescrever o fluxo de checkout.

```ts
// payments/adapter.ts — contrato mínimo
interface PaymentsAdapter {
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  getPayment(input: GetPaymentInput): Promise<GatewayPayment>;
  refundPayment(gatewayPaymentId: string, amount?: number): Promise<void>;
  validateWebhook(rawBody: string, signatureHeader: string | null): boolean | Promise<boolean>;
  parseWebhook(rawBody: string): ParsedWebhookEvent;
}
```

Repare que `validateWebhook` devolve `boolean | Promise<boolean>`, não só `boolean`. A InfinitePay
valida o webhook contra um token específico daquela sessão (precisa consultar o banco); outros
gateways validam com um HMAC global, síncrono, sem tocar o banco. A interface aceita os dois sem
forçar todo adaptador a virar assíncrono à toa.

**Checklist do adaptador:**

- **createCheckout** — recebe valor, referência externa (o id da sua sessão) e os dois tokens
  (webhook/recovery) já prontos; devolve a URL de checkout e o id que o gateway atribuiu.
- **getPayment** — consulta o status de uma transação específica; é o que alimenta o fallback de
  polling.
- **validateWebhook** — confirma que a entrega é legítima *antes* de qualquer efeito colateral.
- **parseWebhook** — extrai só o mínimo (id do evento, tipo, id do pagamento) pra decidir se vale a
  pena processar; a confirmação de verdade acontece em outro lugar (Fluxo 2).

## 4. Fluxo 1 — Criar o checkout

A parte perigosa não é criar o link — é o que fazer quando a chamada pro gateway falha e você não
sabe se ele processou o pedido antes de falhar.

### Antes de qualquer chamada externa

1. Reserva as cobranças: `open` → `checkout_pending`, atomicamente, condicionado ao valor esperado
   não ter mudado.
2. Cria a `checkout_session` com `external_creation_state = not_started`.
3. Deriva os dois tokens da sessão (webhook/recovery) e grava só o hash de cada um.

Isso já resolve um problema comum: se a criação do link falhar em qualquer ponto *depois* daqui, a
cobrança nunca fica presa — ela só volta a `open` quando o sistema tiver certeza de que o gateway
não vai processá-la.

### A máquina de estados de `external_creation_state`

```
not_started → in_flight → (três desfechos possíveis)
```

| Desfecho | Quando acontece | Resultado |
|---|---|---|
| **Rejeição definitiva** | 4xx explícito de validação, sem qualquer indício de que algo foi criado do lado deles. | Sessão cancelada, cobrança volta a `open` |
| **Sucesso** | Resposta 2xx com a URL do checkout. | `linked`, sessão vira `pending` |
| **Falha ambígua** | Timeout, erro de rede, 5xx, resposta incompleta — existe uma chance real de que o gateway tenha criado o link mesmo assim. | `ambiguous`, trava pra reconciliação manual/automática |

> **Por que não tentar de novo automaticamente:** reenviar o POST de criação depois de uma falha
> ambígua arrisca criar um *segundo* link de cobrança pro mesmo valor. O sistema prefere travar a
> sessão (`ambiguous`) e obrigar uma reconciliação explícita — via `getPayment` checando se algo
> foi criado, ou via decisão humana — a arriscar cobrar a pessoa duas vezes.

```ts
// services/checkout.ts — a bifurcação decisiva
try {
  const result = await adapter.createCheckout({ ...input });
  // 2xx: grava checkoutUrl, marca a sessão como "linked" / "pending"
} catch (error) {
  if (error.mayHaveSucceeded === false) {
    await cancelSessionAndReleaseCharges(sessionId);   // rejeição definitiva
  } else {
    await markExternalCreationAmbiguous(sessionId);    // timeout, 5xx, rede
  }
  throw new CheckoutTemporarilyUnavailableError();
}
```

O campo `mayHaveSucceeded` vem do próprio adaptador — só ele sabe distinguir, pro gateway
específico, quais respostas de erro são inequivocamente "nada foi criado" (ex.: 422 de validação
de payload) das que não garantem nada (timeout de socket, 500, resposta truncada). Essa
classificação é a parte que você reescreve pra cada gateway novo; o resto do fluxo não muda.

### Idempotência da requisição em si

Duas camadas, cada uma cobrindo um caso diferente de repetição:

- **Chave de idempotência única por organização** — a mesma tentativa reenviada (duplo clique,
  retry do cliente) reconhece a sessão existente em vez de criar outra.
- **Bloqueio de sessões sobrepostas** — antes de criar uma sessão nova, o sistema verifica se
  alguma das cobranças selecionadas já pertence a uma sessão `created`/`pending`/`expired`-mas-não
  -reconciliada. Um pedido parcial ou superposto às cobranças de uma tentativa anterior não gera
  uma segunda cobrança concorrente pro mesmo item.

## 5. Fluxo 2 — Confirmar via webhook

Um único ponto de entrada transacional confirma o pagamento — chamado pelo webhook e, no Fluxo 3,
também pelo polling. Nenhum dos dois caminhos duplica o efeito se o outro já rodou primeiro.

### Antes da transação

1. Valida a assinatura/token do webhook (`adapter.validateWebhook`) — rejeita antes de tocar em
   qualquer estado.
2. Calcula o hash do payload e verifica `webhook_events (provider, external_event_id)`: se o
   evento já existe com o *mesmo* hash e já foi processado, responde sucesso sem reprocessar
   (idempotência de verdade). Se existe com um hash *diferente*, rejeita — é um replay divergente,
   não uma reentrega legítima.

### Dentro da transação (locked pela sessão)

1. **Trava a sessão** — `SELECT ... FOR UPDATE`; nenhuma outra confirmação concorrente para a
   mesma sessão passa daqui enquanto esta não terminar.
2. **Confere se já foi concluída** — sessão já `completed` com o mesmo id de pagamento externo →
   devolve sucesso idempotente, não grava nada de novo.
3. **Valida o valor e o estado das cobranças** — a soma dos itens tem que bater com o valor
   confirmado; as cobranças precisam ainda estar em `checkout_pending` (ou, num caso de
   reconciliação, `open`).
4. **Grava o pagamento e as alocações** — `payments` com `gateway_payment_id` único (segunda rede
   de segurança contra duplicidade) + uma linha em `payment_allocations` por cobrança.
5. **Fecha cobranças e sessão** — cobranças → `paid`; sessão → `completed`; evento de auditoria
   gravado.
6. **Enfileira efeitos colaterais** — notificações, atualizações de outros sistemas — depois de
   commitado, nunca antes.

Todo esse bloco é uma função só, chamada por dois lugares (webhook e polling) com uma origem
diferente registrada na auditoria. Isso é o que garante que não existem dois caminhos de código
capazes de "pagar" uma cobrança de formas ligeiramente diferentes.

## 6. Fluxo 3 — Fallback sem depender do webhook

Webhooks se perdem: firewall, deploy no meio da entrega, ambiente de desenvolvimento sem URL
pública. A tela de "aguardando pagamento" faz polling autenticado que cai na *mesma* transação de
confirmação do Fluxo 2.

```
POST /checkout-sessions/:id/payment-check   (autenticado por recovery_token)

{ recoveryToken, transactionNsu, invoiceSlug }
  ↓ valida recoveryToken contra recovery_token_hash da sessão
  ↓ consulta adapter.getPayment(...)
  ↓ se confirmado: chama a MESMA confirmSessionPayment() do webhook
  ↓ source: "payment_check" (fica registrado, mas o efeito é idêntico)
```

Por que um token separado do webhook, e não o mesmo? Porque o `recovery_token` viaja na URL de
retorno pro navegador da pessoa pagando — um canal com exposição diferente do `webhook_token`, que
só o gateway conhece. Comprometer um não compromete o outro.

## 7. Segurança dos tokens

Nada aqui depende de um segredo global do gateway — cada sessão tem os seus dois tokens,
derivados, não armazenados em claro.

```ts
// payments/session-tokens.ts — derivação determinística
function deriveCheckoutToken(sessionId, purpose /* "webhook" | "recovery" */) {
  return hmacSha256(SERVER_SECRET, `checkout:${purpose}:${sessionId}`).base64url();
}
// guarda-se apenas sha256(token) — nunca o valor em claro
// comparação sempre em tempo constante (timingSafeEqual)
```

- **Determinístico por sessão** — o mesmo `sessionId` sempre deriva o mesmo token, então o
  servidor nunca precisa persistir o segredo em claro pra poder recriá-lo depois (ex.: ao reviver
  uma sessão cancelada).
- **Só o hash é armazenado** — um vazamento do banco não expõe os tokens em si.
- **Comparação em tempo constante** — evita um ataque de timing na validação do webhook/recovery.
- **Escopo de sessão** — comprometer o token de uma sessão não afeta nenhuma outra, ao contrário
  de um segredo de webhook único pra conta inteira.

## 8. Casos-limite

A parte mais fácil de esquecer numa reimplementação do zero — cada linha aqui já foi um bug em
produção antes de virar uma regra.

| Cenário | Comportamento | Por quê |
|---|---|---|
| Sessão expira (TTL) sem link conhecido | Cobrança libera (`checkout_pending → open`), sessão vira `expired` | Reserva sem custo pro usuário — nada foi criado do lado externo |
| Sessão expira com link conhecido | Cobrança **não** libera; sessão fica travada pra reconciliação | Um link real pode ter sido pago depois do TTL local |
| Novo pedido inclui cobrança já reservada em outra sessão ativa | Bloqueado — reaproveita a sessão existente ou pede reconciliação | Evita duas cobranças concorrentes pro mesmo item |
| Webhook chega duas vezes com o mesmo payload | Segunda entrega responde sucesso sem reprocessar | Idempotência por `provider + external_event_id` |
| Webhook chega duas vezes com payload *diferente* pro mesmo id de evento | Rejeitado | Não é reentrega — é dado divergente sob o mesmo id, tratado como suspeito |
| Webhook e polling confirmam a mesma sessão quase ao mesmo tempo | Um dos dois vence o lock; o outro encontra a sessão já `completed` e sai sem duplicar | `SELECT ... FOR UPDATE` serializa a confirmação |
| Valor confirmado pelo gateway não bate com a soma dos itens | Rejeita a confirmação inteira | Sinal de adulteração ou de estado divergente — nunca concilia parcial |
| Reenviar exatamente o mesmo pedido (mesma pessoa, mesmas cobranças) enquanto uma sessão ainda está válida | Devolve a sessão/link existente em vez de criar outro | Chave de idempotência da requisição |

## 9. Checklist de adaptação

O que mapear pro gateway e pra plataforma novos. Tudo que não está nesta lista pode, em geral, ser
copiado quase como está.

1. **Escreva o adaptador do gateway novo** — implemente `createCheckout`/`getPayment`/
   `validateWebhook`/`parseWebhook` contra a API real do provedor. É o único lugar que conhece o
   formato de requisição/resposta dele.
2. **Classifique as respostas de erro dele em definitiva vs. ambígua** — leia a documentação de
   erros do gateway com essa pergunta em mente: "essa resposta garante que nada foi criado do lado
   deles?" Timeout e 5xx quase sempre são ambíguos, por definição.
3. **Confirme como o gateway assina/autentica webhooks** — HMAC global (síncrono) ou token por
   recurso (pode exigir consulta ao banco, como a InfinitePay)? Isso decide a implementação de
   `validateWebhook`, não a interface.
4. **Confirme se o gateway garante entrega única de webhook** — se não garante (a maioria não
   garante), a tabela `webhook_events` com chave única não é opcional.
5. **Decida se você precisa do fallback de polling** — necessário sempre que o ambiente de
   desenvolvimento não tem URL pública, ou quando o gateway não oferece um jeito confiável de
   consultar status sob demanda — nesse caso, considere um cron de reconciliação em vez de polling
   do cliente.
6. **Mantenha as duas tabelas de estado** — `checkout_sessions.external_creation_state` e
   `webhook_events.processing_status` resolvem problemas diferentes — não colapse as duas em uma
   só pra "simplificar".
7. **Escreva os testes pelos casos-limite, não pelo caminho feliz** — se a suíte de testes não
   cobre "o gateway deu timeout na criação" e "o webhook chegou duplicado", a idempotência não
   está testada — só o fluxo óbvio está.

---

*Baseado em `prototipo-saas` — módulo CobraDora. Documento de referência para replicação em outra
plataforma/gateway.*
