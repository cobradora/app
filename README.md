# CobraDora

Assistente de cobranças recorrentes para grupos de WhatsApp. A aplicação reúne visão mensal, grupos, pendências e configurações em uma única tela, usa a InfinitePay para checkout e permite que cada organização escolha entre os módulos Dora e CobraDora.

## Stack

- Next.js 16, React 19 e TypeScript
- PostgreSQL com Drizzle ORM
- Vitest
- Vercel Cron para renovação automática dos ciclos

## Regras centrais

- Cada grupo tem seu próprio dia de renovação (1 a 28).
- O Cron gera as cobranças vencidas de forma idempotente e recupera ciclos atrasados.
- Quem entra no dia da renovação ou depois começa somente no próximo ciclo; a API devolve esse aviso ao painel.
- O telefone identifica um contato financeiro dentro da organização, não uma pessoa.
- Participantes com o mesmo telefone continuam sendo devedores independentes; o primeiro é o responsável financeiro e os seguintes são dependentes.
- A consulta pública pelo telefone mostra as cobranças do responsável e dos dependentes no grupo do link.
- A InfinitePay recebe o nome e o telefone do responsável financeiro.
- Nomes equivalentes após normalização não podem coexistir no mesmo grupo.
- Uma cobrança só vira paga por webhook validado, `payment_check` confirmado ou baixa manual administrativa.
- Abandono, erro de rede e retorno do navegador nunca confirmam pagamento por conta própria.

## Módulos de cobrança

O módulo é uma configuração da organização:

| Módulo | Funcionamento | Custo da plataforma |
| --- | --- | --- |
| **Dora** | Mantém o fluxo manual atual. O organizador entra no painel, acompanha as baixas e copia ou compartilha a lista atualizada do grupo. Não envia cobranças privadas nem listas automáticas pelo número da plataforma. | Grátis. |
| **CobraDora** | Ao iniciar cada ciclo, envia a cobrança consolidada ao WhatsApp de cada responsável financeiro e o resumo `novo_ciclo` ao organizador. Quando um checkout é confirmado, envia ao organizador a `lista_atualizada` do grupo. | Ainda não definido nem implementado. |

A seleção de CobraDora, por si só, não cria assinatura, período de teste, renovação ou cobrança da plataforma. Até que preço, contratação e controle de acesso sejam especificados e implementados, o módulo não deve ser apresentado como uma assinatura ativa.

Os dois módulos exigem uma conta InfinitePay conectada para gerar checkout. Sem uma InfiniteTag ativa, a configuração permanece pendente e checkout e automações de cobrança ficam indisponíveis; ações administrativas manuais podem continuar acessíveis.

## Conta InfinitePay obrigatória

1. O organizador abre gratuitamente sua conta diretamente na InfinitePay.
2. Informa sua InfiniteTag, sem o caractere `$`, nas configurações da organização.
3. A aplicação associa a InfiniteTag à organização; ela é a destinatária dos pagamentos dos mensalistas.
4. O mensalista paga pelo checkout InfinitePay. A navegação de retorno não dá baixa por conta própria.
5. Somente o webhook validado ou um `payment_check` confirmado atualiza a cobrança e, no modo CobraDora, agenda a lista atualizada para o organizador.

O cadastro da InfiniteTag não equivale tecnicamente à abertura de uma conta. Se for necessário comprovar que a conta existe e pertence ao organizador, ainda será preciso definir um mecanismo oficial de validação com a InfinitePay.

## Execução local

```bash
npm install
npm run dev
```

Validações:

```bash
npm run typecheck
npm test
npm run build
```

O PostgreSQL local pode ser iniciado com `docker compose up -d db`. Consulte `.env.example` para as variáveis necessárias.

## Banco e migrations

O schema está em `src/db/schema.ts`. As migrations Drizzle ficam em `drizzle/` e suas cópias para Supabase em `supabase/migrations/`.

```bash
# Gera uma migration a partir do schema
npm run db:generate

# Aplica somente no banco local configurado em .env.local
npm run db:migrate

# Aplica no banco de teste configurado em .env.test
npm run db:migrate:test
```

A migration `0004_lowly_clea.sql` faz a transição aditiva para contatos financeiros, ciclos e recuperação de checkout. Ela contém verificações prévias e interrompe a execução se encontrar telefones legados inválidos, nomes normalizados duplicados ou alocações incompatíveis. Revise os dados antes de qualquer aplicação em produção.

## Crons

`vercel.json` agenda `GET /api/cron/renewals` diariamente. A rota exige `Authorization: Bearer <CRON_SECRET>` e o segredo deve ter pelo menos 32 caracteres. O agendamento só passa a existir após um deploy de produção autorizado.

`GET /api/cron/whatsapp-reminders` executa o lote de cobranças privadas. A rota usa a mesma autenticação por `CRON_SECRET` e deve selecionar somente organizações no modo CobraDora. O modo Dora não pode provocar chamadas à API da Meta. Reexecuções precisam ser idempotentes para não repetir uma cobrança já enviada.

## Confirmação InfinitePay

O checkout persiste a sessão e reserva as cobranças antes de chamar o gateway. Um compare-and-set permite um único POST externo: rejeições definitivas podem ser retomadas, enquanto timeout ou resultado ambíguo exigem reconciliação e nunca provocam reenvio automático. URLs vencidas não são reutilizadas; o Cron limpa reservas seguramente expiradas sem liberar cegamente criações ambíguas.

- O webhook usa token derivado por sessão, valida valor e estado e possui idempotência/replay protection.
- O retorno da InfinitePay consulta `payment_check` com `handle`, `order_nsu`, `transaction_nsu` e `slug`.
- Cada sessão congela a InfiniteTag/conta usada na criação, então a reconciliação continua correta mesmo após alteração ou desativação da configuração atual.
- A confirmação de webhook e a de `payment_check` convergem para a mesma transação no banco.

Configure `APP_BASE_URL`, `SESSION_SECRET`, `CRON_SECRET` e, opcionalmente, `PAYMENT_TOKEN_SECRET`. A InfiniteTag é cadastrada na própria tela da organização.

## WhatsApp Cloud API

A automação do módulo CobraDora usa o número do aplicativo já criado na Meta. As credenciais são globais da plataforma e devem existir apenas no ambiente do servidor:

- `WHATSAPP_ACCESS_TOKEN`: token de acesso válido para o número da plataforma;
- `WHATSAPP_PHONE_NUMBER_ID`: identificador do número no WhatsApp Cloud API;
- `WHATSAPP_GRAPH_API_VERSION`: versão da Graph API usada no endpoint (opcional; fallback `v25.0`, alterável sem novo build);
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: segredo escolhido pela aplicação para o handshake do webhook;
- `WHATSAPP_APP_SECRET`: segredo do aplicativo usado para validar `X-Hub-Signature-256`;
- `WHATSAPP_CHARGE_TEMPLATE_NAME`: nome exato do template aprovado para a cobrança privada;
- `WHATSAPP_ORGANIZER_CYCLE_TEMPLATE_NAME`: nome exato do template aprovado para o início de ciclo;
- `WHATSAPP_ORGANIZER_UPDATE_TEMPLATE_NAME`: nome exato do template aprovado para a lista atualizada do organizador.

`WHATSAPP_TEMPLATE_NAME` é aceito apenas como fallback temporário do template de cobrança. Novos ambientes devem usar as três variáveis específicas.

Os templates em `pt_BR` devem respeitar este contrato de parâmetros de corpo:

| Template | Parâmetros, na ordem |
| --- | --- |
| Cobrança privada | `participantName`, `groupName`, `amount`, `dueDate`, `groupUrl` |
| Início de ciclo do organizador | `groupName`, `referenceMonth` no formato `MM/AAAA`, `participantCount`, `totalAmount` |
| Atualização do organizador | `groupName`, `referenceMonth` no formato `MM/AAAA`, `paidList`, `pendingList` |

`paidList` e `pendingList` agregam os nomes da competência e usam `Nenhum` quando a lista estiver vazia. Responsáveis e dependentes que compartilham o mesmo contato financeiro recebem uma única cobrança, com o valor total consolidado. Qualquer alteração na quantidade, posição ou formato desses parâmetros exige uma nova versão/aprovação compatível do template na Meta.

Para o teste manual da integração, `WHATSAPP_META_TEST_MODE=true` substitui os três templates pelo template oficial `3p_direct_integration_test_template`, em `en_US` e sem parâmetros. Esse modo só funciona fora de produção e deve ser desligado assim que os templates definitivos forem aprovados.

Antes de ativar o fluxo em produção, o aplicativo da Meta precisa estar apto a enviar mensagens reais, o número deve estar vinculado, os três templates em `pt_BR` devem estar aprovados e o callback público deve apontar para `/api/webhooks/whatsapp`. O `GET` dessa rota atende o handshake com o verify token; o `POST` limita o corpo a 64 KiB e valida a assinatura antes de aceitar eventos.

Cobranças privadas só podem entrar na fila quando o contato financeiro possuir opt-in de WhatsApp vigente. A interface do CobraDora captura essa autorização ao adicionar, importar ou editar um participante; uma revogação posterior registra o opt-out e bloqueia novos envios. O backend preserva os timestamps de autorização e oposição.

O webhook da Meta e o webhook da InfinitePay têm responsabilidades diferentes: o primeiro informa estados de mensagens do WhatsApp; o segundo confirma pagamentos. Um evento de entrega, leitura ou resposta no WhatsApp nunca pode marcar uma cobrança como paga.

Os envios usam uma fila/ledger persistente. A cobrança privada é deduplicada por período e contato financeiro; o aviso de novo ciclo, por período; e a atualização do organizador, por pagamento e período. A confirmação financeira e a criação do evento de saída são atômicas, mas a chamada à Meta acontece depois da transação. A aplicação evita duplicações concorrentes e só reabre tentativas não concluídas; ainda assim, a API da Meta não oferece ao fluxo uma chave externa de idempotência. Se a Meta aceitar a mensagem e a resposta se perder por timeout ou queda do processo, uma retentativa pode produzir uma segunda mensagem. Essa ambiguidade deve ser monitorada no ledger.

### Checklist de QA dos módulos

- O cadastro aceita somente `dora` ou `cobradora` e persiste a escolha na organização.
- Uma organização Dora nunca dispara templates da Meta, mesmo com cobranças abertas.
- Uma organização CobraDora sem InfiniteTag ativa ou sem telefone do organizador permanece com configuração pendente e não envia automações incompletas.
- Contato sem opt-in, com opt-out posterior ou com telefone inválido não recebe cobrança privada.
- A cobrança privada usa o responsável financeiro e não expõe telefone ou segredos em logs e URLs.
- A repetição do Cron não recria notificações já registradas como aceitas pela Meta; simule também o caso ambíguo em que a resposta externa se perde.
- Confirmações equivalentes por webhook InfinitePay e `payment_check` atualizam a cobrança uma só vez e produzem no máximo uma atualização para o organizador.
- Baixa manual não dispara a atualização automática descrita como consequência de pagamento no checkout, salvo decisão de produto futura e teste explícito.
- Handshake inválido, assinatura Meta inválida e chamada ao Cron sem `Bearer <CRON_SECRET>` são rejeitados.
- Falhas e timeouts da Meta ficam disponíveis para retentativa sem desfazer nem duplicar a confirmação financeira; a entrega da mensagem é pelo menos uma vez nos casos externos ambíguos descritos acima.

## Limites desta entrega

Nenhuma configuração de produção é migrada automaticamente. Deploy, aplicação de migration em produção, commit e push devem ser feitos somente com autorização explícita.

Preço, cobrança de assinatura, período de teste, renovação, cancelamento e limites comerciais do módulo CobraDora ainda não foram definidos nem implementados. Os textos comerciais e legais devem permanecer alinhados com essa limitação.
