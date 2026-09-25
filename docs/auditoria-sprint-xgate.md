# Auditoria independente — sprint XGate

Decisão de produto: taxa de 3% por pagamento confirmado, descontada do crédito da organização; sem nova taxa de saque. Valores em centavos. Saldo interno representa exclusivamente recursos recebidos via XGate. Não representa uma subconta bancária criada no provedor.

## Critérios de aceite

| Fase | Evidências exigidas | Status |
| --- | --- | --- |
| 1 — Banco e ledger | Migration aplicável em PostgreSQL; isolamento organização nas referências e consultas; valor bruto = taxa + líquido; arredondamento documentado por transação; taxa congelada; crédito, reserva, consumo e liberação idempotentes; concorrência de reservas testada no banco; saldo contábil e reservado sem dupla subtração; compensações preservam histórico. | **Entregue e testado localmente** — ver evidências abaixo. Pendente aplicar `0016_loving_wendell_rand.sql` no Supabase de produção (nunca aplicado lá). |
| 2 — Cliente XGate | Contratos conferidos em documentação oficial; autenticação somente servidor; timeouts e erros tipados; nenhuma repetição automática de POST financeiro ambíguo; IDs externos persistidos e recuperáveis; quantias convertidas e validadas na fronteira; logs sem senha/token/documento completo. | **Entregue e testado** (suíte isolada, sem dependência de credenciais reais). Homologação com a API real da XGate ainda não feita — auditoria não aprova ativação em produção só com isso. |
| 3 — Pix e saldo | Cobranças e montante derivados do banco; customer do pagador vinculado ao tenant; uma única criação concorrente; Pix exibido; evento externo provoca consulta autenticada ao provedor; ID/valor/customer correlacionados; confirmação do pagamento e crédito atômicos; duplicatas e eventos fora de ordem não duplicam saldo; falha/expiração não geram crédito; pagamentos manuais e InfinitePay nunca creditam XGate. | Implementação revisada estaticamente; três achados iniciais tratados. Sem execução por ordem do usuário; limitações operacionais registradas na revisão final abaixo. |
| 4 — Cadastro e saque | Autorização owner/admin; organização derivada da sessão; cadastro validado e Pix do beneficiário; reserva atômica antes de chamada externa; UUID estável; concorrência e insuficiência; destino congelado; ambiguidade mantém reserva; somente falha definitiva libera; sucesso consome reserva uma vez; consulta autenticada confirma resultado; interface mostra 3% já descontados no recebimento. | **Entregue e testado localmente** — ver evidências abaixo. Sem homologação com a API real da XGate; migration `0017_good_jimmy_woo.sql` copiada para `supabase/migrations/` mas ainda não aplicada em produção. |
| 5 — Seleção gradual | Default preserva checkout InfinitePay; ativação XGate explícita por organização; seleção registrada na sessão; troca de configuração não muda sessões existentes; nenhuma nova cobrança por outro gateway enquanto resultado anterior for ambíguo; reconciliação funciona para ambos; suíte existente e build/typecheck pertinentes passam. | **Parcial, escopo reduzido a pedido do usuário** — ver evidências abaixo. Elegibilidade por plano (grátis/InfinitePay, premium/XGate) entregue e testada; `checkout.ts` continua exclusivo InfinitePay, sem consultar `gateway-policy.ts` (P1 já registrado, segue em aberto). |

## Cenários financeiros mínimos

- R$ 100,00 confirmado: bruto 10000, taxa 300, líquido 9700.
- Centavos e meio centavo: política de arredondamento explícita, consistente e testada em limites; mesma taxa/valor após reprocessamento.
- Reserva 9700 sobre saldo 9700: disponível 0; confirmação: saldo 0, reservado 0; falha definitiva: saldo 9700, reservado 0.
- Duas reservas simultâneas de 6000 sobre saldo 9700: apenas uma aprovada.
- Mesma confirmação concorrente/repetida: um crédito; reuso de chave com conteúdo diferente: erro.
- Tentativa com ID de outra organização: nenhum dado revelado ou alterado.
- Timeout após envio: não liberar dinheiro nem reenviar cegamente; preservar estado para reconciliação.
- Estorno após crédito e após saque: compensação registrada e saldo disponível bloqueado conforme insuficiência; não apagar crédito histórico.
- Webhook forjado/valor divergente/customer divergente: nenhum efeito financeiro.
- Pagamento InfinitePay/manual: nenhum aumento do saldo custodiado XGate.

## Pontos de atenção do código anterior à sprint

- P1, integração: `src/services/checkout.ts:694`, `:820`, `:935` fixam InfinitePay na sessão, adaptador e configuração; apenas ampliar factory não troca o fluxo.
- P1, integração: `src/services/webhook-processing.ts:99` aceita somente InfinitePay. O crédito XGate precisa de confirmação própria sem reaproveitar autenticação específica da InfinitePay.
- P1, integridade multigateway: `src/db/schema.ts:355` usa unicidade global somente de gatewayPaymentId. Na introdução de outro provedor, avaliar chave composta gateway + ID e consultas correspondentes, ou armazenamento isolado dos depósitos XGate.
- P1, legado a isolar: `src/services/checkout.ts:528` permite liberação administrativa forçada; `tests/services/checkout.test.ts:268` exige cancelamento/recriação de resultado ambíguo. Não estender estes atalhos a recursos custodiados XGate sem reconciliação conclusiva.
- P2, contrato: `src/payments/adapter.ts` exige checkoutUrl e não representa Pix copia-e-cola. A nova experiência precisa de contrato explícito e compatibilidade com respostas existentes.
- Infra de testes: `tests/setup.ts:5` exige PostgreSQL disponível; suíte puramente mockada também passa pelo setup. Auditoria deve distinguir testes executados de inspeção estática.

Estes itens descrevem riscos de adaptação do legado, não falhas confirmadas de uma implementação XGate ainda não entregue. A auditoria não aprova ativação em produção apenas com testes mockados da API; credenciais, contratos e entrega real de webhook dependem de homologação controlada.

## Registro de revisões

- Revisão inicial: leitura de schema, adaptadores, checkout, confirmação e testes existentes. Nenhuma alteração de implementação. Preservados arquivos dirty `pending-charges.ts` e `pending-charges.test.ts`.

### Revisão estática da fase 3 — 24/09/2026

Escopo atualizado pelo usuário: apenas fase 3; fases 1 e 2 consideradas concluídas. Por instrução expressa, não foram executados testes, build, lint, typecheck ou migrations. A leitura de componentes prévios serve somente para avaliar sua integração; não constitui revalidação das fases anteriores.

Achados comunicados ao coordenador durante a implementação (linhas referem-se à versão lida; requerem revisão após correções):

- **P1 — Estorno posterior à confirmação ignorado.** `src/services/xgate-deposits.ts:136` retorna para depósito confirmado antes de consultar o provedor. `src/app/api/webhooks/xgate/route.ts:31` marca o evento processado após esse retorno. Assim, um depósito pago e posteriormente estornado continua integralmente no saldo; `refundConfirmedDeposit` existe mas não tem chamador em `src`. É necessário reconciliar o estado confirmado e compensar atomicamente somente com evidência autenticada do estorno, ou registrar explicitamente o evento não tratado e bloquear a disponibilidade correspondente até conciliação.
- **P1 — Criação interrompida antes do envio fica irrecuperável.** `src/services/xgate-deposits.ts:84` retorna em toda repetição, inclusive quando o depósito está `not_started`. Se o processo cair entre o commit da reserva e o claim da linha 85, nenhuma chamada externa ocorreu, mas todas as repetições retornam a página sem Pix e as cobranças continuam reservadas. O claim condicional pode permitir a retomada segura de `not_started` sem reenviar operações `in_flight`/ambíguas.
- **P2 — Perda da chave impede retomada do Pix.** `src/app/g/[publicSlug]/pix/page.tsx:14` mantém a chave apenas em memória; reload, fechamento ou perda da resposta destrói a identificação da tentativa. `src/services/xgate-deposits.ts:59` rejeita as cobranças agora `checkout_pending` sem recuperação por fingerprint, embora a consulta pública continue exibindo-as. É necessário persistir a tentativa e/ou recuperar a sessão compatível sem emitir outro depósito.

Observações favoráveis da leitura: confirmação consulta a API autenticada e confere transaction ID/customer/moeda/valor; confirmação de cobranças, allocations e ledger usa a mesma transação; trava de saldo precede sessão/depósito; API financeira obtém organização da sessão e exige owner/admin; guardas no checkout legado impedem expiração/liberação administrativa simples de XGate. Estas observações não substituem execução, proibida nesta revisão.
- Revisão 2 (fecho da Fase 1): implementação de código real já existente auditada linha a linha (não só a descrição da sprint), com as seguintes evidências reproduzíveis:
  - `npm run typecheck` limpo em todo o repositório.
  - `npm run test:xgate` (`vitest.xgate.config.ts`, sem Postgres): **17/17** testes do cliente XGate passando — cobrem ambíguo vs. definitivo por status HTTP, cache/refresh de token, truncamento de centavo, moeda BRL/PIX e validação pré-HTTP.
  - `tests/services/organization-ledger.test.ts` (novo, `npm test`, Postgres real): **13/13** testes passando, incluindo crédito idempotente, estorno idempotente, reserva/liquidação/liberação idempotentes cada uma isoladamente, insuficiência de saldo e **uma reserva concorrente real de duas transações Postgres simultâneas sobre o mesmo saldo insuficiente** (via `SELECT ... FOR UPDATE`), confirmando que apenas uma é aprovada — fecha a lacuna "concorrência de reservas testada no banco" que estava zerada.
  - `npm test` completo (suíte pré-existente, `fileParallelism: false`): **26/26 arquivos, 203/203 testes** passando, sem regressão.
  - Corrigido bug real na migration gerada pelo drizzle-kit: `drizzle/0016_loving_wendell_rand.sql` criava as FKs compostas (`gateway_deposits→checkout_sessions`, `organization_ledger_entries→gateway_deposits`/`→withdrawals`) antes dos índices únicos `*_tenant_identity` que elas referenciam — Postgres exige o índice único já existir. Corrigida a ordem no próprio arquivo (índices antes das constraints) e reconciliados os bancos locais dev/teste (que tinham aplicação parcial da versão quebrada) até paridade estrutural confirmada (22 constraints iguais nas duas bases). Migration copiada para `supabase/migrations/0016_loving_wendell_rand.sql` — **ainda não aplicada em produção**.
  - Achado à parte: a suíte padrão (`npm test`) tentava incluir `tests/xgate-client.test.ts`, que só resolve por causa do alias de `server-only` do `vitest.xgate.config.ts` — quebrava `npm test` inteiro com "Cannot find package 'server-only'". Corrigido excluindo esse arquivo do `vitest.config.ts` padrão (roda só via `npm run test:xgate`).
  - `.env.example` e `package.json` (`test:xgate`) atualizados; ambos já estavam pendentes desde a revisão inicial.
  - Não alterado naquela revisão histórica: Fases 3, 4 e 5 ainda não tinham implementação. Esta observação histórica foi superada para a fase 3 pela revisão estática acima e pelo retorno abaixo.

### Retorno da revisão estática da fase 3 — correções

Somente leitura e atualização deste relatório. Nenhum teste, build, lint, typecheck ou migration executado nesta revisão. As evidências de execução das fases 1/2 acima são históricas e não validam as alterações da fase 3.

- **P1 pós-pagamento: tratado por bloqueio conservador.** `src/services/xgate-deposits.ts:149` consulta o provedor inclusive para depósitos confirmados. Uma alteração autenticada para estado diferente de pago cria `xgate_deposit_review` sob trava do saldo e devolve erro de conciliação; o webhook registra falha, em vez de considerar o evento concluído. `src/services/organization-ledger.ts:54` zera o disponível enquanto houver revisão não resolvida; `:106` rejeita novas reservas sob a mesma trava. Página financeira e API mostram a pendência. Não foi implementada compensação automática de estorno; depende do contrato de estados do provedor e de conciliação explícita. O saldo contábil permanece histórico enquanto o saldo disponível fica bloqueado.
- **P1 criação não iniciada: resolvido na inspeção.** `src/services/xgate-deposits.ts:97` aplica o claim condicional `not_started` também em repetição. Duas requisições recuperando a mesma reserva disputam uma única atualização condicional, e somente a vencedora segue para o POST. Operações já `in_flight`/ambíguas continuam preservadas, sem reenvio cego.
- **P2 perda de chave: resolvido para seleção idêntica.** `src/services/xgate-deposits.ts:59` recupera sessão por organização, contato, gateway e fingerprint antes de exigir cobranças abertas. O fingerprint inclui grupo, telefone, lista ordenada de cobranças, documento e nome. Uma nova chave com os mesmos dados retorna o mesmo depósito e a mesma capability; mudar nome/documento/seleção não é recuperação compatível.

Limitações concretas: não há procedimento de resolução de revisão disponível na interface desta fase; a liberação requer conciliação operacional e registro explícito de resolução. A detecção de mudança pós-pagamento depende de novo webhook ou chamada explícita de reconciliação; a página pública encerra polling após confirmação. Processos interrompidos após claim `in_flight` permanecem em conciliação por precaução. A ordem das travas e a atomicidade foram inspecionadas, mas concorrência e contratos HTTP reais não foram executados nesta fase, conforme solicitado.

### Fecho da Fase 4 — 24/09/2026

Implementação nova (`src/services/xgate-payouts.ts`, rotas `POST /api/finance/payout-profile` e `POST /api/finance/withdrawals`, extensão do webhook e novo cron `xgate-withdrawals`) auditada linha a linha e **executada**, não só lida:

- Gap de schema encontrado e corrigido antes de implementar: `withdrawals` (fase 1) não tinha `external_creation_state`/`external_request_started_at` (o mesmo mecanismo de compare-and-set que `gateway_deposits` já usa) nem uma `idempotency_key` própria para o pedido de saque. Migration `0017_good_jimmy_woo.sql` (só `ALTER TABLE ADD COLUMN`/índice/check, sem risco de ordem como a `0016`) fecha os dois; aplicada localmente em dev e teste, copiada para `supabase/migrations/` e documentada no README daquela pasta — **produção ainda não recebeu nem a `0016` nem a `0017`**.
- `assertDepositEvidence`/`isPaidDeposit` generalizadas para `assertTransactionEvidence`/`isPaidTransaction` (mesmo contrato de detalhes da XGate para depósito e saque), com os nomes antigos mantidos como alias — nenhuma lógica duplicada, `xgate-deposits.ts` intocado.
- Fluxo de saque espelha exatamente o de depósito: reserva atômica em transação (erro de saldo insuficiente ou saldo em revisão derruba a transação inteira, sem linha órfã) → compare-and-set `not_started→in_flight` fora da transação → `submitted=true` só imediatamente antes do POST `/withdraw` → resultado ambíguo mantém a reserva presa (`externalCreationState: "ambiguous"`), só rejeição definitiva (`XGateError.outcome === "rejected"`) ou falha antes do envio libera. `reconcileXGateWithdrawal` nunca libera automaticamente — só confirma (`currency.status === "PAID"` via consulta autenticada); um saque ambíguo sem liberação automática exige webhook ou conciliação manual, mesma limitação já documentada para depósito.
- `tests/services/xgate-payouts.test.ts` (novo, `vi.mock` da XGate, Postgres real via `truncateAll`): **9/9** passando — cadastro de perfil, saldo insuficiente, saldo em revisão, ambíguo mantém reserva, rejeição definitiva libera, sucesso grava `providerTransactionId`, idempotência pela mesma `idempotencyKey` (não reserva nem chama a XGate duas vezes), e reconciliação (liquida só quando `PAID`, não libera nem liquida antes disso).
- `tests/services/organization-ledger.test.ts` ajustado para a nova coluna obrigatória `idempotencyKey` — os 13 testes de fase 1 continuam passando sem mudança de lógica.
- `vitest.config.ts` (suíte principal, com Postgres) ganhou o mesmo alias de `server-only` que `vitest.xgate.config.ts` já tinha, porque `xgate-payouts.ts` importa `server-only` e o novo teste precisa do Postgres real (não faz sentido isolar sem banco). `tests/xgate-client.test.ts` continua excluído da suíte principal, rodando só via `npm run test:xgate`.
- Verificação completa: `npm run typecheck` limpo; `npm run test:xgate` 17/17; `npm test` completo **27/27 arquivos, 212/212 testes**; `npm run db:migrate`/`db:migrate:test` confirmam sucesso sem erro (aplicação real da `0017`, não simulação).

Fora do escopo desta entrega (deliberado, ver plano): automação de conciliação de saque ambíguo travado, tela de admin para destravar revisão, e fase 5 (`checkout.ts` ainda não consulta `gateway-policy.ts` para decidir o provedor).

### Fase 5 (escopo reduzido: elegibilidade por plano) — 24/09/2026

O usuário pediu explicitamente pra manter os dois links públicos separados que a fase 3 entregou
(`/g/{publicSlug}` = InfinitePay, `/g/{publicSlug}/pix` = XGate) em vez de unificar num único fluxo
que decide o gateway sozinho — perguntei antes de implementar e essa foi a escolha. Por isso o
escopo real desta entrega é só a regra de elegibilidade, não a integração em `checkout.ts`.

- `src/payments/gateway-policy.ts` (`isXGateEnabledForOrganization`) deixou de depender só de
  `XGATE_ORGANIZATION_IDS` e passou a consultar `organizations.billing_module`: grátis (`cobradora`)
  nunca é elegível a XGate, mesmo com `XGATE_ENABLED=true`; premium (`cobradora`) é elegível com
  `XGATE_ENABLED=true`, e `XGATE_ORGANIZATION_IDS` virou um filtro fino **opcional** (vazio = todas
  as organizações premium ficam elegíveis; preenchido = restringe ainda mais, pra rollout
  gradual). A função virou `async` (consulta o banco agora) — os 3 call sites existentes
  (`xgate-deposits.ts`, `xgate-payouts.ts`, `financeiro/page.tsx`) foram ajustados pra `await`.
- **Achado ao implementar**: `COBRADORA_TEMPORARILY_DISABLED = true` em `cobradora-dashboard.tsx`
  ainda impede o organizador de selecionar o plano premium pela UI (motivo documentado no próprio
  código: estabilidade da automação WhatsApp, não tem relação com gateway de pagamento). Enquanto
  essa flag existir, só organizações que já estavam em `cobradora` antes do bloqueio ficam
  elegíveis a XGate por esta mudança — decisão de reabrir a seleção de premium não foi tomada aqui,
  fica registrada pro usuário decidir separadamente.
- `tests/gateway-policy.test.ts` (novo, Postgres real): **5/5** passando — grátis nunca elegível
  mesmo com a flag global ligada; premium só elegível com a flag ligada; allowlist vazia não
  restringe; allowlist preenchida restringe até a organização premium listada;
  `getOrganizationCheckoutProvider` reflete a elegibilidade corretamente.
- `tests/services/xgate-payouts.test.ts` precisou de ajuste (não é regressão de lógica): a
  organização de teste passou a ser criada como premium (`billingModule: "cobradora"` +
  `organizerPhoneNormalized`), já que o novo gate por plano bloqueava a fase 4 inteira sem isso —
  os 9 testes continuam cobrindo exatamente o mesmo comportamento de antes.
- Corrigido também o problema de estilo reportado pelo usuário em `/financeiro`: os componentes de
  cadastro de chave Pix e de saque (fase 4) tinham `<form>` sem `className="auth-form"` e
  `<input>`/`<select>` soltos sem o wrapper `.auth-input` que `login`/`signup` usam — por isso a
  tela aparentava HTML sem estilo nenhum. A página também usava `<dl>`/`<table>` crus pro saldo e
  pro histórico, quando o resto do app usa `.summary-card` (estatísticas) e `.pending-row`
  (listas); troquei pelos mesmos padrões já usados em `cobradora-dashboard.tsx`. Duas classes CSS
  novas, aditivas: `.auth-input select` (o wrapper só cobria `input`) e `.status-pill--danger`
  (usa `var(--danger)`/`var(--danger-bg)`, que já existiam).
- Verificação completa: `npm run typecheck` limpo; `npm test` completo **28/28 arquivos, 217/217
  testes**; `npm run test:xgate` 17/17 sem mudança.

Fora do escopo desta entrega: unificar `/g/{publicSlug}` num único fluxo que decide o gateway
sozinho (`checkout.ts` continua exclusivamente InfinitePay — P1 já registrado desde o início da
sessão, segue em aberto); reabrir `COBRADORA_TEMPORARILY_DISABLED`.
