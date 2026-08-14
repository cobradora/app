# CobraDora

Assistente de cobranças recorrentes para grupos de WhatsApp. A aplicação reúne visão mensal, grupos, pendências e configurações em uma única tela e usa a InfinitePay para checkout.

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

## Renovação automática

`vercel.json` agenda `GET /api/cron/renewals` diariamente. A rota exige `Authorization: Bearer <CRON_SECRET>` e o segredo deve ter pelo menos 32 caracteres. O agendamento só passa a existir após um deploy de produção autorizado.

## Confirmação InfinitePay

O checkout persiste a sessão e reserva as cobranças antes de chamar o gateway. Um compare-and-set permite um único POST externo: rejeições definitivas podem ser retomadas, enquanto timeout ou resultado ambíguo exigem reconciliação e nunca provocam reenvio automático. URLs vencidas não são reutilizadas; o Cron limpa reservas seguramente expiradas sem liberar cegamente criações ambíguas.

- O webhook usa token derivado por sessão, valida valor e estado e possui idempotência/replay protection.
- O retorno da InfinitePay consulta `payment_check` com `handle`, `order_nsu`, `transaction_nsu` e `slug`.
- Cada sessão congela a InfiniteTag/conta usada na criação, então a reconciliação continua correta mesmo após alteração ou desativação da configuração atual.
- A confirmação de webhook e a de `payment_check` convergem para a mesma transação no banco.

Configure `APP_BASE_URL`, `SESSION_SECRET`, `CRON_SECRET` e, opcionalmente, `PAYMENT_TOKEN_SECRET`. A InfiniteTag é cadastrada na própria tela da organização.

## Limites desta entrega

Nenhuma configuração de produção é migrada automaticamente. Deploy, aplicação de migration em produção, commit e push devem ser feitos somente com autorização explícita.
