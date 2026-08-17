# Migrations para aplicar manualmente no Supabase

Cópia exata das migrations geradas pelo Drizzle em `../../drizzle/`. Fonte da verdade do schema continua sendo [`src/db/schema.ts`](../../src/db/schema.ts) — sempre que ele mudar, gere a migration nova com `npm run db:generate` e copie o arquivo novo para cá também.

> **A sequência completa `0000` → `0008` serve somente para inicializar um schema `public` vazio.** Em um banco já usado, parcialmente migrado ou que já tenha qualquer objeto da aplicação, nunca reinicie pela `0000`; primeiro inspecione o catálogo conforme o fluxo de diagnóstico abaixo.

Como o `drizzle-kit migrate` não conseguiu se conectar diretamente a este projeto Supabase (rede/conta), aplique os arquivos abaixo manualmente no **SQL Editor** do Supabase (Dashboard → SQL Editor → New query), **nesta ordem, um de cada vez**:

1. `0000_bored_alex_wilder.sql` — cria os 14 enums e as 15 tabelas, FKs e índices únicos.
2. `0001_milky_whizzer.sql` — adiciona `checkout_sessions.webhook_token_hash`.
3. `0002_tidy_aqueduct.sql` — adiciona `checkout_sessions.checkout_url`.
4. `0003_sloppy_daimon_hellstrom.sql` — adiciona `users.password_hash`.
5. `0004_lowly_clea.sql` — reestrutura contatos financeiros, ciclos, configurações e segurança de checkout com backfill validado.
6. `0005_cloudy_gamma_corps.sql` — adiciona o valor individual de cobrança por participante em cada grupo.
7. `0006_awesome_bullseye.sql` — adiciona `organization_settings.message_participant_filter` (todos/pagadores/pendentes na mensagem de cobrança).
8. `0007_nappy_red_shift.sql` — torna `groups.billing_day` opcional (renovação manual), move a mensagem de cobrança para `groups` (`message_intro`/`message_outro`/`message_participant_filter`, substituindo `organization_settings`, que fica sem uso mas não é apagada) e cria `group_tags` + `group_participants.tag` para a categoria/ordenação de participantes.
9. `0008_normal_lizard.sql` — cria `rate_limit_hits` (contador de janela fixa para limitar abuso nas rotas públicas). Linhas antigas são varridas pelo cron diário (`/api/cron/renewals`), não precisa de manutenção manual.
10. `0009_classy_exiles.sql` — amplia `checkout_sessions.checkout_url` de `varchar(500)` para `text`. Links reais da InfinitePay passam de 500 caracteres (o `lenc` do link é variável), e o limite antigo derrubava a gravação do link **depois** de já criado na InfinitePay — todo checkout ficava com "Não foi possível preparar o checkout agora" mesmo com a chamada externa tendo funcionado.

Depois de rodar as migrations, confira também `financial_contacts` e `organization_settings`. A `0004` interrompe de propósito se encontrar telefone legado inválido, nome normalizado duplicado no mesmo grupo, gateway duplicado ou dupla alocação; corrija os dados reportados antes de tentar novamente.

## Erro `already exists` em migration manual

Se a `0000` ou outra migration falhar informando que um tipo, tabela, constraint ou índice `already exists`, **pare e não execute a `0000` novamente**. Não edite a migration antiga para acrescentar `IF NOT EXISTS` e não apague o objeto: a mensagem pode indicar uma execução anterior completa, uma execução parcial persistida pelo SQL Editor ou um objeto homônimo com definição incompatível.

Abra **SQL Editor → New query**, garanta que não há seleção parcial e execute o arquivo [`../recovery/inspect_manual_migration_state.sql`](../recovery/inspect_manual_migration_state.sql) inteiro. O inspector é somente leitura e devolve a identidade do banco, os objetos-base da `0000` e os marcadores das migrations `0001` a `0005`. Nas tabelas ele confere a identidade em `public`, o tipo de relação e um fingerprint mínimo das colunas-base; nas FKs e índices confere a definição catalogada. Os markers são apenas indícios de checkpoint e **não provam que uma migration terminou**. Copie o resultado completo, incluindo as linhas `01_summary`, e envie para análise antes de executar qualquer migration ou recovery.

Em um banco que já alcançou a `0004`, a existência de `public.audit_actor_type` é esperada e não autoriza reaplicar a `0000`. Prossiga somente com o recovery indicado depois que o relatório confirmar o estado real do catálogo.

## Recuperação de uma 0004 parcialmente aplicada

Se a primeira execução da `0004` parou com `existem participantes com nome vazio` e uma nova tentativa passou a falhar com `type "financial_role" already exists`, **não execute a `0004` inteira novamente e não apague o tipo**. Esse erro significa que o SQL Editor preservou o prefixo já executado.

Nesse estado específico, **não use mais o arquivo original `0004_lowly_clea.sql`**. Abra **SQL Editor → New query**, garanta que não há seleção de texto ativa, desative o Assistant/auto-fix ou qualquer opção automática que reescreva SQL e cole o arquivo [`../recovery/0004_resume_after_blank_names.sql`](../recovery/0004_resume_after_blank_names.sql) inteiro, da primeira linha até o `COMMIT;` final. Execute a consulta inteira de uma só vez; não reutilize uma aba que contenha uma versão anterior ou linhas adicionadas automaticamente pelo Dashboard.

A versão 4 do recovery é compatível com o SQL Editor e reconcilia também bancos em estado misto: valida cada índice, constraint, função e trigger pela definição esperada, preserva backfills já concluídos e cria somente os objetos ausentes, tudo dentro de uma transação. Se ele terminar com sucesso, prossiga com a `0005`, que também é transacional e reentrante. Se o recovery falhar, não ignore nem pule comandos: toda a retomada será revertida e a nova mensagem identificará o artefato ou dado incompatível.

Se no futuro a conexão direta ao Supabase passar a funcionar por aqui, o fluxo normal (`npx dotenv -e .env.production -- drizzle-kit migrate`) volta a valer — essas cópias manuais existem só como contorno.
