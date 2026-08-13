# Migrations para aplicar manualmente no Supabase

Cópia exata das migrations geradas pelo Drizzle em `../../drizzle/`. Fonte da verdade do schema continua sendo [`src/db/schema.ts`](../../src/db/schema.ts) — sempre que ele mudar, gere a migration nova com `npm run db:generate` e copie o arquivo novo para cá também.

Como o `drizzle-kit migrate` não conseguiu se conectar diretamente a este projeto Supabase (rede/conta), aplique os arquivos abaixo manualmente no **SQL Editor** do Supabase (Dashboard → SQL Editor → New query), **nesta ordem, um de cada vez**:

1. `0000_bored_alex_wilder.sql` — cria os 14 enums e as 15 tabelas, FKs e índices únicos.
2. `0001_milky_whizzer.sql` — adiciona `checkout_sessions.webhook_token_hash`.
3. `0002_tidy_aqueduct.sql` — adiciona `checkout_sessions.checkout_url`.
4. `0003_sloppy_daimon_hellstrom.sql` — adiciona `users.password_hash`.

Depois de rodar os 4, confira no **Table Editor** que as 15 tabelas apareceram (`organizations`, `users`, `groups`, `participants`, `group_participants`, `billing_periods`, `charges`, `checkout_sessions`, `checkout_items`, `payments`, `payment_allocations`, `gateway_accounts`, `commissions`, `webhook_events`, `audit_events`).

Se no futuro a conexão direta ao Supabase passar a funcionar por aqui, o fluxo normal (`npx dotenv -e .env.production -- drizzle-kit migrate`) volta a valer — essas cópias manuais existem só como contorno.
