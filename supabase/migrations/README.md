# Migrations para aplicar manualmente no Supabase

Cópia exata das migrations geradas pelo Drizzle em `../../drizzle/`. Fonte da verdade do schema continua sendo [`src/db/schema.ts`](../../src/db/schema.ts) — sempre que ele mudar, gere a migration nova com `npm run db:generate` e copie o arquivo novo para cá também.

> **A sequência completa `0000` → `0013` serve somente para inicializar um schema `public` vazio.** Em um banco já usado, parcialmente migrado ou que já tenha qualquer objeto da aplicação, nunca reinicie pela `0000`; primeiro inspecione o catálogo conforme o fluxo de diagnóstico abaixo.

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
11. `0010_magical_nebula.sql` — adiciona `groups.sport` (Modalidade). O campo já existia no formulário de novo grupo e era validado, mas descartado — nunca foi salvo até agora. Passa a ser usado também na descrição do item enviado ao checkout da InfinitePay.
12. `0011_demonic_warlock.sql` — adiciona os módulos `dora`/`cobradora`, o WhatsApp do organizador, o consentimento dos contatos financeiros e a outbox persistente de notificações da Meta.
13. `0012_wandering_blink.sql` — separa na outbox a mensagem de início de ciclo enviada ao organizador da atualização de lista emitida depois de um pagamento.
14. `0013_glamorous_hulk.sql` — fecha a integridade multi-tenant da outbox, valida a relação entre tipo e contato, adiciona índices de FK e retira a tabela e sua função de trigger dos papéis públicos `anon`/`authenticated` quando eles existem.
15. `0014_tricky_scalphunter.sql` — cria `device_push_tokens` (token Expo Push por device do app mobile notificador) e `app_notifications` (feed simples de eventos, ex. `payment_received`, independente do sucesso/falha do push).

Depois de rodar as migrations, confira também `financial_contacts`, `organization_settings` e `whatsapp_notifications`. A `0004` interrompe de propósito se encontrar telefone legado inválido, nome normalizado duplicado no mesmo grupo, gateway duplicado ou dupla alocação; a `0013` interrompe se encontrar uma notificação ligada ao tenant errado ou uma combinação incompatível de tipo/contato. Corrija os dados reportados antes de tentar novamente.

A aplicação abre uma conexão PostgreSQL direta em `src/db/index.ts`; ela não usa os papéis `anon` ou `authenticated` da Data API. Por isso a `0013` preserva o acesso do dono da tabela e de papéis privados com grants próprios, revoga explicitamente os papéis públicos quando presentes e não ativa RLS sem uma política compatível com essa conexão. Se a arquitetura migrar para Supabase Data API, crie políticas RLS explícitas antes de conceder novamente qualquer privilégio.

## Histórico manual e baseline do Drizzle

Executar SQL no **SQL Editor não registra a migration** em `drizzle.__drizzle_migrations` nem em `supabase_migrations.schema_migrations`. Os arquivos aplicados e o histórico do migrador são estados diferentes. Se o catálogo estiver na `0013`, mas o histórico Drizzle estiver vazio ou terminar na `0010`, um `drizzle-kit migrate` tentará reaplicar objetos existentes e falhará com `already exists`.

Antes de trocar do fluxo manual para o Drizzle:

1. interrompa novas migrations e confirme, por inspeção somente leitura, que cada mudança até a última versão realmente existe com a definição esperada;
2. consulte `to_regclass('drizzle.__drizzle_migrations')` e as linhas existentes, sem criar nem completar o histórico automaticamente;
3. prepare uma operação de baseline revisada que registre somente migrations comprovadamente aplicadas, usando os hashes dos arquivos imutáveis e os valores `when` de `../../drizzle/meta/_journal.json`;
4. valide o baseline em uma cópia do banco e só então execute `drizzle-kit migrate` no banco real.

Nunca marque uma migration como aplicada apenas porque um objeto homônimo existe. Não misture reparo de histórico com reparo de schema e não use `IF NOT EXISTS` para esconder divergências de definição. O inspector atual cobre detalhadamente a base e os checkpoints antigos descritos abaixo; para `0011`–`0013`, a reconciliação deve validar também enums, colunas, constraints, trigger, índices e grants da outbox.

## Erro `already exists` em migration manual

Se a `0000` ou outra migration falhar informando que um tipo, tabela, constraint ou índice `already exists`, **pare e não execute a `0000` novamente**. Não edite a migration antiga para acrescentar `IF NOT EXISTS` e não apague o objeto: a mensagem pode indicar uma execução anterior completa, uma execução parcial persistida pelo SQL Editor ou um objeto homônimo com definição incompatível.

Abra **SQL Editor → New query**, garanta que não há seleção parcial e execute o arquivo [`../recovery/inspect_manual_migration_state.sql`](../recovery/inspect_manual_migration_state.sql) inteiro. O inspector é somente leitura e devolve a identidade do banco, os objetos-base da `0000` e os marcadores das migrations `0001` a `0005`. Nas tabelas ele confere a identidade em `public`, o tipo de relação e um fingerprint mínimo das colunas-base; nas FKs e índices confere a definição catalogada. Os markers são apenas indícios de checkpoint e **não provam que uma migration terminou**. Copie o resultado completo, incluindo as linhas `01_summary`, e envie para análise antes de executar qualquer migration ou recovery.

Em um banco que já alcançou a `0004`, a existência de `public.audit_actor_type` é esperada e não autoriza reaplicar a `0000`. Prossiga somente com o recovery indicado depois que o relatório confirmar o estado real do catálogo.

## Recuperação de uma 0004 parcialmente aplicada

Se a primeira execução da `0004` parou com `existem participantes com nome vazio` e uma nova tentativa passou a falhar com `type "financial_role" already exists`, **não execute a `0004` inteira novamente e não apague o tipo**. Esse erro significa que o SQL Editor preservou o prefixo já executado.

Nesse estado específico, **não use mais o arquivo original `0004_lowly_clea.sql`**. Abra **SQL Editor → New query**, garanta que não há seleção de texto ativa, desative o Assistant/auto-fix ou qualquer opção automática que reescreva SQL e cole o arquivo [`../recovery/0004_resume_after_blank_names.sql`](../recovery/0004_resume_after_blank_names.sql) inteiro, da primeira linha até o `COMMIT;` final. Execute a consulta inteira de uma só vez; não reutilize uma aba que contenha uma versão anterior ou linhas adicionadas automaticamente pelo Dashboard.

A versão 4 do recovery é compatível com o SQL Editor e reconcilia também bancos em estado misto: valida cada índice, constraint, função e trigger pela definição esperada, preserva backfills já concluídos e cria somente os objetos ausentes, tudo dentro de uma transação. Se ele terminar com sucesso, prossiga com a `0005`, que também é transacional e reentrante. Se o recovery falhar, não ignore nem pule comandos: toda a retomada será revertida e a nova mensagem identificará o artefato ou dado incompatível.

Se no futuro a conexão direta ao Supabase passar a funcionar por aqui, o fluxo normal (`npx dotenv -e .env.production -- drizzle-kit migrate`) só volta a valer **depois** do baseline auditado acima. Essas cópias manuais existem apenas como contorno e não substituem o histórico do migrador.
