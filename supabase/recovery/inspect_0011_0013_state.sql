-- COBRADORA - INSPECAO SOMENTE LEITURA DO ESTADO DAS MIGRATIONS 0011-0013
--
-- Execute este arquivo inteiro em uma consulta nova do Supabase SQL Editor.
-- Ele usa somente catalogos e funcoes de leitura. Copie todas as linhas do
-- resultado, inclusive os resumos, e envie para analise antes de retomar
-- qualquer migration que tenha falhado com "already exists".
--
-- Escopo do relatorio:
-- - enums criados/alterados pela 0011/0012: tipo e ordem exata dos labels
--   (whatsapp_notification_kind ganha 'organizer_cycle_start' so na 0012,
--   entao a ordem dos labels indica se a 0012 ja rodou ou nao);
-- - tabela whatsapp_notifications: identidade em public e fingerprint minimo
--   das colunas-base da 0011;
-- - colunas adicionadas em organizations/financial_contacts pela 0011;
-- - FKs e indices da 0011 e da 0013 (a 0013 troca a FK do financial_contact_id
--   por uma FK composta org+contato, entao a FK antiga presente/ausente
--   tambem indica o checkpoint);
-- - constraints CHECK da 0011/0013;
-- - funcao e trigger de tenant da 0013;
-- - grants REVOKE da 0013 em PUBLIC/anon/authenticated.

WITH
expected_enums(enum_name, expected_labels) AS (
	VALUES
		('billing_module', ARRAY['dora', 'cobradora']::text[]),
		('whatsapp_delivery_status', ARRAY['queued', 'sending', 'sent', 'delivered', 'read', 'failed']::text[]),
		-- Esperado apos 0011+0012 (0013 nao mexe no enum). Se a 0012 ainda nao
		-- rodou, o label 'organizer_cycle_start' vai aparecer como diferenca
		-- (conflict), nao como 'missing' do tipo inteiro.
		('whatsapp_notification_kind', ARRAY['charge_reminder', 'organizer_cycle_start', 'organizer_list_update']::text[])
),
enum_catalog AS (
	SELECT
		expected.enum_name,
		expected.expected_labels,
		t.oid AS type_oid,
		t.typtype,
		coalesce(
			ARRAY(
				SELECT e.enumlabel::text
				FROM pg_catalog.pg_enum e
				WHERE e.enumtypid = t.oid
				ORDER BY e.enumsortorder
			),
			ARRAY[]::text[]
		) AS actual_labels
	FROM expected_enums expected
	LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
	LEFT JOIN pg_catalog.pg_type t
		ON t.typnamespace = n.oid
		AND t.typname = expected.enum_name
),
enum_reports AS (
	SELECT
		'10_enum'::text AS section,
		'public.' || enum_name AS item,
		CASE
			WHEN type_oid IS NULL THEN 'missing'
			WHEN typtype IS DISTINCT FROM 'e' OR actual_labels IS DISTINCT FROM expected_labels THEN 'conflict'
			ELSE 'ok'
		END AS status,
		'enum labels=' || expected_labels::text AS expected,
		CASE
			WHEN type_oid IS NULL THEN '<absent>'
			ELSE format('typtype=%s; labels=%s', typtype, actual_labels::text)
		END AS actual
	FROM enum_catalog
),
expected_tables(table_name, expected_column_signatures) AS (
	VALUES
		('whatsapp_notifications', ARRAY[
			'id:uuid', 'organization_id:uuid', 'billing_period_id:uuid', 'financial_contact_id:uuid',
			'kind:public.whatsapp_notification_kind', 'status:public.whatsapp_delivery_status',
			'recipient_phone_normalized:varchar(14)', 'idempotency_key:varchar(200)', 'payload:jsonb',
			'meta_message_id:varchar(200)', 'attempt_count:int4', 'next_attempt_at:timestamptz',
			'last_attempt_at:timestamptz', 'sent_at:timestamptz', 'delivered_at:timestamptz',
			'read_at:timestamptz', 'failed_at:timestamptz', 'error_code:varchar(120)',
			'created_at:timestamptz', 'updated_at:timestamptz'
		]::text[])
),
table_catalog AS (
	SELECT
		expected.table_name,
		expected.expected_column_signatures,
		relation.oid AS relation_oid,
		relation.relkind,
		actual.actual_column_signatures,
		ARRAY(
			SELECT expected_signature
			FROM pg_catalog.unnest(expected.expected_column_signatures) AS expected_signature
			WHERE NOT expected_signature = ANY(coalesce(actual.actual_column_signatures, ARRAY[]::text[]))
			ORDER BY expected_signature
		) AS missing_column_signatures
	FROM expected_tables expected
	LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
	LEFT JOIN pg_catalog.pg_class relation
		ON relation.relnamespace = n.oid
		AND relation.relname = expected.table_name
	LEFT JOIN LATERAL (
		SELECT ARRAY(
			SELECT
				column_definition.column_name || ':'
				|| CASE
					WHEN column_definition.udt_schema = 'public' THEN 'public.' || column_definition.udt_name
					ELSE column_definition.udt_name
				END
				|| CASE
					WHEN column_definition.character_maximum_length IS NULL THEN ''
					ELSE '(' || column_definition.character_maximum_length::text || ')'
				END
			FROM information_schema.columns column_definition
			WHERE column_definition.table_schema = 'public'
				AND column_definition.table_name = expected.table_name
			ORDER BY column_definition.ordinal_position
		) AS actual_column_signatures
	) actual ON true
),
table_reports AS (
	SELECT
		'20_table'::text AS section,
		'public.' || table_name AS item,
		CASE
			WHEN relation_oid IS NULL THEN 'missing'
			WHEN relkind IS DISTINCT FROM 'r'
				OR cardinality(missing_column_signatures) > 0 THEN 'conflict'
			ELSE 'ok'
		END AS status,
		'ordinary table containing columns ' || expected_column_signatures::text AS expected,
		CASE
			WHEN relation_oid IS NULL THEN '<absent>'
			ELSE format(
				'relkind=%s; visible_columns=%s; missing_columns=%s',
				relkind,
				cardinality(actual_column_signatures),
				missing_column_signatures::text
			)
		END AS actual
	FROM table_catalog
),
expected_added_columns(table_name, column_name, udt_schema, udt_name, character_maximum_length, expected_not_null) AS (
	VALUES
		('financial_contacts', 'whatsapp_opt_in_at', 'pg_catalog', 'timestamptz', NULL::integer, false),
		('financial_contacts', 'whatsapp_opt_out_at', 'pg_catalog', 'timestamptz', NULL::integer, false),
		('organizations', 'billing_module', 'public', 'billing_module', NULL::integer, true),
		('organizations', 'organizer_phone_normalized', 'pg_catalog', 'varchar', 14, false),
		('organizations', 'organizer_phone_display', 'pg_catalog', 'varchar', 20, false)
),
added_column_reports AS (
	SELECT
		'25_column'::text AS section,
		format('public.%s.%s', expected.table_name, expected.column_name) AS item,
		CASE
			WHEN actual.column_name IS NULL THEN 'missing'
			WHEN actual.udt_schema IS DISTINCT FROM expected.udt_schema
				OR actual.udt_name IS DISTINCT FROM expected.udt_name
				OR actual.character_maximum_length IS DISTINCT FROM expected.character_maximum_length THEN 'conflict'
			WHEN (actual.is_nullable = 'NO') IS DISTINCT FROM expected.expected_not_null THEN 'present_partial'
			ELSE 'ok'
		END AS status,
		format('%s.%s%s; not_null=%s', expected.udt_schema, expected.udt_name, CASE WHEN expected.character_maximum_length IS NULL THEN '' ELSE '(' || expected.character_maximum_length::text || ')' END, expected.expected_not_null) AS expected,
		CASE
			WHEN actual.column_name IS NULL THEN '<absent>'
			ELSE format('%s.%s%s; not_null=%s', actual.udt_schema, actual.udt_name, CASE WHEN actual.character_maximum_length IS NULL THEN '' ELSE '(' || actual.character_maximum_length::text || ')' END, actual.is_nullable = 'NO')
		END AS actual
	FROM expected_added_columns expected
	LEFT JOIN information_schema.columns actual
		ON actual.table_schema = 'public'
		AND actual.table_name = expected.table_name
		AND actual.column_name = expected.column_name
),
-- FK do financial_contact_id: a 0011 cria a FK simples; a 0013 a substitui
-- por uma FK composta. As duas sao reportadas para indicar o checkpoint.
expected_fks(constraint_name, table_name, column_names, referenced_table_name, referenced_column_names) AS (
	VALUES
		('whatsapp_notifications_organization_id_organizations_id_fk', 'whatsapp_notifications', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('whatsapp_notifications_billing_period_id_billing_periods_id_fk', 'whatsapp_notifications', ARRAY['billing_period_id']::text[], 'billing_periods', ARRAY['id']::text[]),
		('whatsapp_notifications_financial_contact_id_financial_contacts_id_fk', 'whatsapp_notifications', ARRAY['financial_contact_id']::text[], 'financial_contacts', ARRAY['id']::text[]),
		('whatsapp_notifications_org_contact_fk', 'whatsapp_notifications', ARRAY['organization_id', 'financial_contact_id']::text[], 'financial_contacts', ARRAY['organization_id', 'id']::text[])
),
fk_catalog AS (
	SELECT
		expected.*,
		actual.constraint_oid,
		actual.definition
	FROM expected_fks expected
	LEFT JOIN LATERAL (
		SELECT c.oid AS constraint_oid, pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
		FROM pg_catalog.pg_constraint c
		WHERE c.conrelid = pg_catalog.to_regclass('public.' || expected.table_name)
			AND c.conname = expected.constraint_name
		LIMIT 1
	) actual ON true
),
fk_reports AS (
	SELECT
		'30_fk'::text AS section,
		constraint_name AS item,
		CASE WHEN constraint_oid IS NULL THEN 'absent (esperado ausente apos a 0013 para a FK simples)' ELSE 'present' END AS status,
		format('public.%s(%s) -> public.%s(%s)', table_name, array_to_string(column_names, ','), referenced_table_name, array_to_string(referenced_column_names, ',')) AS expected,
		coalesce(definition, '<absent>') AS actual
	FROM fk_catalog
),
expected_indexes(index_name, table_name, is_unique) AS (
	VALUES
		('whatsapp_notifications_idempotency_unique', 'whatsapp_notifications', true),
		('whatsapp_notifications_meta_message_unique', 'whatsapp_notifications', true),
		('whatsapp_notifications_dispatch_idx', 'whatsapp_notifications', false),
		('whatsapp_notifications_organization_idx', 'whatsapp_notifications', false),
		('whatsapp_notifications_billing_period_idx', 'whatsapp_notifications', false),
		('whatsapp_notifications_financial_contact_idx', 'whatsapp_notifications', false)
),
index_reports AS (
	SELECT
		'40_index'::text AS section,
		expected.index_name AS item,
		CASE WHEN i.indexrelid IS NULL THEN 'missing' ELSE 'ok' END AS status,
		format('unique=%s on public.%s', expected.is_unique, expected.table_name) AS expected,
		CASE WHEN i.indexrelid IS NULL THEN '<absent>' ELSE pg_catalog.pg_get_indexdef(i.indexrelid) END AS actual
	FROM expected_indexes expected
	LEFT JOIN pg_catalog.pg_class index_relation ON index_relation.relname = expected.index_name
	LEFT JOIN pg_catalog.pg_namespace index_namespace ON index_namespace.oid = index_relation.relnamespace AND index_namespace.nspname = 'public'
	LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = index_relation.oid
),
expected_checks(constraint_name, table_name) AS (
	VALUES
		('organizations_organizer_phone_pair_check', 'organizations'),
		('organizations_organizer_phone_format_check', 'organizations'),
		('organizations_cobradora_phone_required_check', 'organizations'),
		('whatsapp_notifications_recipient_phone_check', 'whatsapp_notifications'),
		('whatsapp_notifications_attempt_count_check', 'whatsapp_notifications'),
		('whatsapp_notifications_kind_contact_check', 'whatsapp_notifications')
),
check_reports AS (
	SELECT
		'50_check'::text AS section,
		expected.constraint_name AS item,
		CASE WHEN c.oid IS NULL THEN 'missing' WHEN NOT c.convalidated THEN 'conflict' ELSE 'ok' END AS status,
		'validated CHECK on public.' || expected.table_name AS expected,
		coalesce(pg_catalog.pg_get_constraintdef(c.oid, true), '<absent>') AS actual
	FROM expected_checks expected
	LEFT JOIN pg_catalog.pg_constraint c
		ON c.conrelid = pg_catalog.to_regclass('public.' || expected.table_name)
		AND c.conname = expected.constraint_name
),
trigger_reports AS (
	SELECT
		'60_trigger_function_0013'::text AS section,
		'public.cobradora_enforce_whatsapp_notification_tenant()' AS item,
		CASE WHEN pg_catalog.to_regprocedure('public.cobradora_enforce_whatsapp_notification_tenant()') IS NULL THEN 'missing' ELSE 'ok' END AS status,
		'function with zero arguments' AS expected,
		coalesce(pg_catalog.to_regprocedure('public.cobradora_enforce_whatsapp_notification_tenant()')::text, '<absent>') AS actual

	UNION ALL

	SELECT
		'60_trigger_function_0013',
		'whatsapp_notifications_tenant_trigger',
		CASE WHEN t.tgname IS NULL THEN 'missing' ELSE 'ok' END,
		'trigger on public.whatsapp_notifications',
		CASE WHEN t.tgname IS NULL THEN '<absent>' ELSE pg_catalog.pg_get_triggerdef(t.oid) END
	FROM (SELECT 1) seed
	LEFT JOIN pg_catalog.pg_trigger t
		ON t.tgrelid = pg_catalog.to_regclass('public.whatsapp_notifications')
		AND t.tgname = 'whatsapp_notifications_tenant_trigger'
),
grant_reports AS (
	SELECT
		'70_grant_0013'::text AS section,
		'public.whatsapp_notifications -> ' || grantee.rolname AS item,
		CASE WHEN privilege.privilege_type IS NULL THEN 'ok (sem privilegio, esperado apos 0013)' ELSE 'conflict (ainda tem privilegio)' END AS status,
		'nenhum privilegio para PUBLIC/anon/authenticated' AS expected,
		coalesce(privilege.privilege_type, '<nenhum>') AS actual
	FROM (VALUES ('PUBLIC'), ('anon'), ('authenticated')) AS grantee(rolname)
	LEFT JOIN information_schema.table_privileges privilege
		ON privilege.table_schema = 'public'
		AND privilege.table_name = 'whatsapp_notifications'
		AND privilege.grantee = grantee.rolname
	WHERE grantee.rolname = 'PUBLIC' OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = grantee.rolname)
),
baseline_reports AS (
	SELECT * FROM enum_reports
	UNION ALL SELECT * FROM table_reports
	UNION ALL SELECT * FROM added_column_reports
	UNION ALL SELECT * FROM fk_reports
	UNION ALL SELECT * FROM index_reports
	UNION ALL SELECT * FROM check_reports
	UNION ALL SELECT * FROM trigger_reports
	UNION ALL SELECT * FROM grant_reports
),
baseline_summary AS (
	SELECT
		'01_summary'::text AS section,
		section AS item,
		CASE
			WHEN count(*) FILTER (WHERE status LIKE 'conflict%') > 0 THEN 'conflict'
			WHEN count(*) FILTER (WHERE status = 'missing') > 0 THEN 'incomplete'
			ELSE 'ok'
		END AS status,
		format('items=%s', count(*)) AS expected,
		format(
			'ok=%s; missing=%s; conflict=%s',
			count(*) FILTER (WHERE status LIKE 'ok%' OR status LIKE 'present%' OR status LIKE 'absent%'),
			count(*) FILTER (WHERE status = 'missing'),
			count(*) FILTER (WHERE status LIKE 'conflict%')
		) AS actual
	FROM baseline_reports
	GROUP BY section
),
identity_report AS (
	SELECT
		'00_identity'::text AS section,
		'database_session'::text AS item,
		'info'::text AS status,
		'confirm this is the intended Supabase project/database before any recovery'::text AS expected,
		format(
			'database=%s; session_user=%s; current_user=%s; server=%s:%s; version=%s; inspected_at=%s',
			pg_catalog.current_database(),
			session_user,
			current_user,
			coalesce(pg_catalog.inet_server_addr()::text, '<local>'),
			coalesce(pg_catalog.inet_server_port()::text, '<local>'),
			pg_catalog.current_setting('server_version'),
			pg_catalog.clock_timestamp()::text
		) AS actual
),
final_report AS (
	SELECT * FROM identity_report
	UNION ALL SELECT * FROM baseline_summary
	UNION ALL SELECT * FROM baseline_reports
)
SELECT section, item, status, expected, actual
FROM final_report
ORDER BY section, item;
