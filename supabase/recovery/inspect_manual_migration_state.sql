-- COBRADORA - INSPECAO SOMENTE LEITURA DO ESTADO DAS MIGRATIONS MANUAIS
--
-- Execute este arquivo inteiro em uma consulta nova do Supabase SQL Editor.
-- Ele usa somente catalogos e funcoes de leitura. Copie todas as linhas do
-- resultado, inclusive os resumos, e envie para analise antes de retomar uma
-- migration que tenha falhado com "already exists".
--
-- Escopo do relatorio:
-- - enums: tipo e ordem exata dos labels;
-- - tabelas: identidade em public, relkind comum e fingerprint minimo das
--   colunas-base; colunas posteriores conhecidas podem coexistir porque cada
--   CREATE TABLE original e atomico;
-- - FKs e indices: tabela, colunas, alvo/predicado e propriedades catalogadas;
-- - markers 0001-0005: somente indicios de checkpoint. A presenca de todos os
--   markers nao prova que uma migration terminou nem autoriza qualquer mutacao.

WITH
expected_enums(enum_name, expected_labels) AS (
	VALUES
		('audit_actor_type', ARRAY['user', 'system', 'participant']::text[]),
		('billing_period_status', ARRAY['open', 'closed']::text[]),
		('charge_status', ARRAY['open', 'checkout_pending', 'paid', 'manually_paid', 'canceled', 'refunded']::text[]),
		('checkout_session_status', ARRAY['created', 'pending', 'completed', 'expired', 'canceled']::text[]),
		('commission_type', ARRAY['percentage', 'fixed']::text[]),
		('gateway_account_status', ARRAY['pending', 'active', 'disabled']::text[]),
		('group_participant_status', ARRAY['active', 'left']::text[]),
		('group_status', ARRAY['active', 'archived']::text[]),
		('org_status', ARRAY['active', 'suspended']::text[]),
		('participant_status', ARRAY['active', 'inactive']::text[]),
		('payment_status', ARRAY['pending', 'confirmed', 'failed', 'refunded', 'partially_refunded']::text[]),
		('user_role', ARRAY['owner', 'admin', 'member']::text[]),
		('user_status', ARRAY['active', 'inactive']::text[]),
		('webhook_processing_status', ARRAY['received', 'processing', 'processed', 'failed']::text[])
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
		'10_enum_0000'::text AS section,
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
		('audit_events', ARRAY['id:uuid', 'organization_id:uuid', 'entity_type:varchar(60)', 'entity_id:uuid', 'action:varchar(60)', 'actor_type:public.audit_actor_type', 'actor_id:uuid', 'metadata:jsonb', 'created_at:timestamptz']::text[]),
		('billing_periods', ARRAY['id:uuid', 'group_id:uuid', 'reference_month:varchar(7)', 'due_date:date', 'status:public.billing_period_status']::text[]),
		('charges', ARRAY['id:uuid', 'billing_period_id:uuid', 'participant_id:uuid', 'original_amount:int4', 'discount_amount:int4', 'fine_amount:int4', 'interest_amount:int4', 'total_amount:int4', 'status:public.charge_status', 'due_date:date', 'created_at:timestamptz', 'updated_at:timestamptz']::text[]),
		('checkout_items', ARRAY['checkout_session_id:uuid', 'charge_id:uuid', 'amount:int4']::text[]),
		('checkout_sessions', ARRAY['id:uuid', 'organization_id:uuid', 'participant_id:uuid', 'gateway:varchar(40)', 'gateway_checkout_id:varchar(200)', 'status:public.checkout_session_status', 'expires_at:timestamptz', 'idempotency_key:varchar(100)', 'created_at:timestamptz']::text[]),
		('commissions', ARRAY['id:uuid', 'organization_id:uuid', 'group_id:uuid', 'type:public.commission_type', 'value:int4', 'valid_from:date', 'valid_until:date']::text[]),
		('gateway_accounts', ARRAY['id:uuid', 'organization_id:uuid', 'provider:varchar(40)', 'external_account_id:varchar(200)', 'status:public.gateway_account_status', 'configuration_reference:varchar(200)']::text[]),
		('group_participants', ARRAY['id:uuid', 'group_id:uuid', 'participant_id:uuid', 'joined_at:timestamptz', 'left_at:timestamptz', 'status:public.group_participant_status']::text[]),
		('groups', ARRAY['id:uuid', 'organization_id:uuid', 'name:varchar(200)', 'public_slug:varchar(100)', 'billing_day:int4', 'default_amount:int4', 'status:public.group_status']::text[]),
		('organizations', ARRAY['id:uuid', 'name:varchar(200)', 'status:public.org_status', 'created_at:timestamptz', 'updated_at:timestamptz']::text[]),
		('participants', ARRAY['id:uuid', 'organization_id:uuid', 'name:varchar(200)', 'phone_normalized:varchar(20)', 'phone_display:varchar(30)', 'status:public.participant_status']::text[]),
		('payment_allocations', ARRAY['id:uuid', 'payment_id:uuid', 'charge_id:uuid', 'amount:int4']::text[]),
		('payments', ARRAY['id:uuid', 'organization_id:uuid', 'participant_id:uuid', 'gateway:varchar(40)', 'gateway_payment_id:varchar(200)', 'amount:int4', 'status:public.payment_status', 'paid_at:timestamptz', 'payment_method:varchar(40)', 'created_at:timestamptz']::text[]),
		('users', ARRAY['id:uuid', 'organization_id:uuid', 'name:varchar(200)', 'email:varchar(255)', 'role:public.user_role', 'status:public.user_status']::text[]),
		('webhook_events', ARRAY['id:uuid', 'provider:varchar(40)', 'external_event_id:varchar(200)', 'event_type:varchar(80)', 'payload_hash:varchar(64)', 'processing_status:public.webhook_processing_status', 'received_at:timestamptz', 'processed_at:timestamptz', 'error_message:text']::text[])
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
		'20_table_0000'::text AS section,
		'public.' || table_name AS item,
		CASE
			WHEN relation_oid IS NULL THEN 'missing'
			WHEN relkind IS DISTINCT FROM 'r'
				OR cardinality(missing_column_signatures) > 0 THEN 'conflict'
			ELSE 'ok'
		END AS status,
		'ordinary table containing baseline columns ' || expected_column_signatures::text AS expected,
		CASE
			WHEN relation_oid IS NULL THEN '<absent>'
			ELSE format(
				'relkind=%s; visible_columns=%s; missing_baseline_columns=%s',
				relkind,
				cardinality(actual_column_signatures),
				missing_column_signatures::text
			)
		END AS actual
	FROM table_catalog
),
expected_fks(constraint_name, table_name, column_names, referenced_table_name, referenced_column_names) AS (
	VALUES
		('audit_events_organization_id_organizations_id_fk', 'audit_events', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('billing_periods_group_id_groups_id_fk', 'billing_periods', ARRAY['group_id']::text[], 'groups', ARRAY['id']::text[]),
		('charges_billing_period_id_billing_periods_id_fk', 'charges', ARRAY['billing_period_id']::text[], 'billing_periods', ARRAY['id']::text[]),
		('charges_participant_id_participants_id_fk', 'charges', ARRAY['participant_id']::text[], 'participants', ARRAY['id']::text[]),
		('checkout_items_checkout_session_id_checkout_sessions_id_fk', 'checkout_items', ARRAY['checkout_session_id']::text[], 'checkout_sessions', ARRAY['id']::text[]),
		('checkout_items_charge_id_charges_id_fk', 'checkout_items', ARRAY['charge_id']::text[], 'charges', ARRAY['id']::text[]),
		('checkout_sessions_organization_id_organizations_id_fk', 'checkout_sessions', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('checkout_sessions_participant_id_participants_id_fk', 'checkout_sessions', ARRAY['participant_id']::text[], 'participants', ARRAY['id']::text[]),
		('commissions_organization_id_organizations_id_fk', 'commissions', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('commissions_group_id_groups_id_fk', 'commissions', ARRAY['group_id']::text[], 'groups', ARRAY['id']::text[]),
		('gateway_accounts_organization_id_organizations_id_fk', 'gateway_accounts', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('group_participants_group_id_groups_id_fk', 'group_participants', ARRAY['group_id']::text[], 'groups', ARRAY['id']::text[]),
		('group_participants_participant_id_participants_id_fk', 'group_participants', ARRAY['participant_id']::text[], 'participants', ARRAY['id']::text[]),
		('groups_organization_id_organizations_id_fk', 'groups', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('participants_organization_id_organizations_id_fk', 'participants', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('payment_allocations_payment_id_payments_id_fk', 'payment_allocations', ARRAY['payment_id']::text[], 'payments', ARRAY['id']::text[]),
		('payment_allocations_charge_id_charges_id_fk', 'payment_allocations', ARRAY['charge_id']::text[], 'charges', ARRAY['id']::text[]),
		('payments_organization_id_organizations_id_fk', 'payments', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
		('payments_participant_id_participants_id_fk', 'payments', ARRAY['participant_id']::text[], 'participants', ARRAY['id']::text[]),
		('users_organization_id_organizations_id_fk', 'users', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[])
),
fk_catalog AS (
	SELECT
		expected.*,
		actual.constraint_oid,
		actual.contype,
		actual.actual_column_names,
		actual.referenced_schema_name,
		actual.actual_referenced_table_name,
		actual.actual_referenced_column_names,
		actual.confupdtype,
		actual.confdeltype,
		actual.confmatchtype,
		actual.condeferrable,
		actual.condeferred,
		actual.convalidated,
		actual.definition,
		EXISTS (
			SELECT 1
			FROM pg_catalog.pg_constraint homonym
			JOIN pg_catalog.pg_namespace homonym_namespace
				ON homonym_namespace.oid = homonym.connamespace
			WHERE homonym_namespace.nspname = 'public'
				AND homonym.conname = expected.constraint_name
				AND homonym.conrelid IS DISTINCT FROM pg_catalog.to_regclass('public.' || expected.table_name)
		) AS has_homonym
	FROM expected_fks expected
	LEFT JOIN LATERAL (
		SELECT
			c.oid AS constraint_oid,
			c.contype,
			ARRAY(
				SELECT a.attname::text
				FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, position)
				JOIN pg_catalog.pg_attribute a
					ON a.attrelid = c.conrelid
					AND a.attnum = key_column.attnum
				ORDER BY key_column.position
			) AS actual_column_names,
			referenced_namespace.nspname::text AS referenced_schema_name,
			referenced_relation.relname::text AS actual_referenced_table_name,
			ARRAY(
				SELECT a.attname::text
				FROM pg_catalog.unnest(c.confkey) WITH ORDINALITY AS key_column(attnum, position)
				JOIN pg_catalog.pg_attribute a
					ON a.attrelid = c.confrelid
					AND a.attnum = key_column.attnum
				ORDER BY key_column.position
			) AS actual_referenced_column_names,
			c.confupdtype,
			c.confdeltype,
			c.confmatchtype,
			c.condeferrable,
			c.condeferred,
			c.convalidated,
			pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
		FROM pg_catalog.pg_constraint c
		LEFT JOIN pg_catalog.pg_class referenced_relation ON referenced_relation.oid = c.confrelid
		LEFT JOIN pg_catalog.pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
		WHERE c.conrelid = pg_catalog.to_regclass('public.' || expected.table_name)
			AND c.conname = expected.constraint_name
		ORDER BY c.oid
		LIMIT 1
	) actual ON true
),
fk_reports AS (
	SELECT
		'30_fk_0000'::text AS section,
		constraint_name AS item,
		CASE
			WHEN has_homonym THEN 'conflict'
			WHEN constraint_oid IS NULL THEN 'missing'
			WHEN contype IS DISTINCT FROM 'f'
				OR actual_column_names IS DISTINCT FROM column_names
				OR referenced_schema_name IS DISTINCT FROM 'public'
				OR actual_referenced_table_name IS DISTINCT FROM referenced_table_name
				OR actual_referenced_column_names IS DISTINCT FROM referenced_column_names
				OR confupdtype IS DISTINCT FROM 'a'
				OR confdeltype IS DISTINCT FROM 'a'
				OR confmatchtype IS DISTINCT FROM 's'
				OR condeferrable IS DISTINCT FROM false
				OR condeferred IS DISTINCT FROM false
				OR convalidated IS DISTINCT FROM true THEN 'conflict'
			ELSE 'ok'
		END AS status,
		format('public.%s(%s) -> public.%s(%s); NO ACTION; NOT DEFERRABLE', table_name, array_to_string(column_names, ','), referenced_table_name, array_to_string(referenced_column_names, ',')) AS expected,
		CASE
			WHEN constraint_oid IS NULL AND NOT has_homonym THEN '<absent>'
			WHEN constraint_oid IS NULL THEN '<absent on expected table; same-named public constraint exists elsewhere>'
			ELSE coalesce(definition, '<definition unavailable>') || CASE WHEN has_homonym THEN '; same-named public constraint also exists elsewhere' ELSE '' END
		END AS actual
	FROM fk_catalog
),
expected_index_variants(logical_name, variant_order, variant_name, index_name, table_name, column_names, predicate_kind) AS (
	VALUES
		('checkout_sessions_idempotency', 1, 'legacy_0000', 'checkout_sessions_idempotency_unique', 'checkout_sessions', ARRAY['idempotency_key']::text[], 'none'),
		('checkout_sessions_idempotency', 2, 'replacement_0004', 'checkout_sessions_organization_idempotency_unique', 'checkout_sessions', ARRAY['organization_id', 'idempotency_key']::text[], 'none'),
		('group_participants_active_unique', 1, '0000', 'group_participants_active_unique', 'group_participants', ARRAY['group_id', 'participant_id']::text[], 'active'),
		('groups_public_slug_unique', 1, '0000', 'groups_public_slug_unique', 'groups', ARRAY['public_slug']::text[], 'none'),
		('payments_gateway_payment_unique', 1, '0000', 'payments_gateway_payment_unique', 'payments', ARRAY['gateway_payment_id']::text[], 'none'),
		('users_email_unique', 1, '0000', 'users_email_unique', 'users', ARRAY['email']::text[], 'none'),
		('webhook_events_provider_event_unique', 1, '0000', 'webhook_events_provider_event_unique', 'webhook_events', ARRAY['provider', 'external_event_id']::text[], 'none')
),
index_variant_catalog AS (
	SELECT
		expected.*,
		index_relation.oid AS index_oid,
		index_relation.relkind,
		table_namespace.nspname::text AS table_schema_name,
		table_relation.relname::text AS actual_table_name,
		i.indisunique,
		i.indisvalid,
		i.indisready,
		i.indisexclusion,
		am.amname::text AS access_method,
		ARRAY(
			SELECT replace(pg_catalog.pg_get_indexdef(i.indexrelid, position.position, false), '"', '')
			FROM pg_catalog.generate_series(1, i.indnkeyatts) AS position(position)
			ORDER BY position.position
		) AS actual_column_names,
		pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate,
		pg_catalog.regexp_replace(
			pg_catalog.translate(
				pg_catalog.lower(coalesce(pg_catalog.pg_get_expr(i.indpred, i.indrelid), '')),
				'"()',
				''
			),
			'[[:space:]]+',
			'',
			'g'
		) AS normalized_predicate,
		(i.indnatts <> i.indnkeyatts) AS has_included_columns,
		EXISTS (
			SELECT 1
			FROM pg_catalog.pg_constraint c
			WHERE c.conindid = index_relation.oid
		) AS backs_constraint,
		CASE WHEN index_relation.oid IS NULL THEN NULL ELSE pg_catalog.pg_get_indexdef(index_relation.oid) END AS definition
	FROM expected_index_variants expected
	LEFT JOIN pg_catalog.pg_namespace index_namespace ON index_namespace.nspname = 'public'
	LEFT JOIN pg_catalog.pg_class index_relation
		ON index_relation.relnamespace = index_namespace.oid
		AND index_relation.relname = expected.index_name
	LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = index_relation.oid
	LEFT JOIN pg_catalog.pg_class table_relation ON table_relation.oid = i.indrelid
	LEFT JOIN pg_catalog.pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
	LEFT JOIN pg_catalog.pg_am am ON am.oid = index_relation.relam
),
index_variant_evaluation AS (
	SELECT
		catalog.*,
		(
			index_oid IS NOT NULL
			AND relkind = 'i'
			AND table_schema_name = 'public'
			AND actual_table_name = table_name
			AND indisunique
			AND indisvalid
			AND indisready
			AND NOT indisexclusion
			AND access_method = 'btree'
			AND actual_column_names = column_names
			AND NOT has_included_columns
			AND NOT backs_constraint
			AND (
				(predicate_kind = 'none' AND predicate IS NULL)
				OR (
					predicate_kind = 'active'
					AND normalized_predicate ~ '^status=''active''(::(public\.)?group_participant_status)?$'
				)
			)
		) AS is_exact
	FROM index_variant_catalog catalog
),
index_reports AS (
	SELECT
		'40_index_0000'::text AS section,
		logical_name AS item,
		CASE
			WHEN pg_catalog.bool_or(index_oid IS NOT NULL AND NOT is_exact) THEN 'conflict'
			WHEN count(*) FILTER (WHERE is_exact) > 1 THEN 'ok_both_variants'
			WHEN pg_catalog.bool_or(is_exact) THEN 'ok'
			ELSE 'missing'
		END AS status,
		pg_catalog.string_agg(
			format('%s=%s on public.%s(%s)%s', variant_name, index_name, table_name, array_to_string(column_names, ','), CASE WHEN predicate_kind = 'active' THEN ' WHERE status=active' ELSE '' END),
			' OR '
			ORDER BY variant_order
		) AS expected,
		pg_catalog.string_agg(
			format('%s=%s%s', index_name, CASE WHEN index_oid IS NULL THEN '<absent>' WHEN is_exact THEN '<exact>' ELSE '<incompatible>' END, CASE WHEN definition IS NULL THEN '' ELSE ' [' || definition || ']' END),
			' | '
			ORDER BY variant_order
		) AS actual
	FROM index_variant_evaluation
	GROUP BY logical_name
),
expected_marker_columns(migration_name, marker_order, table_name, column_name, udt_schema, udt_name, character_maximum_length, expected_not_null) AS (
	VALUES
		('0001', 1, 'checkout_sessions', 'webhook_token_hash', 'pg_catalog', 'varchar', 64, false),
		('0002', 1, 'checkout_sessions', 'checkout_url', 'pg_catalog', 'varchar', 500, false),
		('0003', 1, 'users', 'password_hash', 'pg_catalog', 'varchar', 255, false),
		('0004', 1, 'participants', 'financial_contact_id', 'pg_catalog', 'uuid', NULL::integer, true),
		('0004', 2, 'participants', 'name_normalized', 'pg_catalog', 'varchar', 200, true),
		('0004', 3, 'participants', 'financial_role', 'public', 'financial_role', NULL::integer, true),
		('0004', 4, 'participants', 'created_at', 'pg_catalog', 'timestamptz', NULL::integer, true),
		('0004', 5, 'group_participants', 'billing_starts_on', 'pg_catalog', 'date', NULL::integer, true),
		('0004', 6, 'group_participants', 'participant_name_normalized', 'pg_catalog', 'varchar', 200, true),
		('0004', 7, 'checkout_sessions', 'financial_contact_id', 'pg_catalog', 'uuid', NULL::integer, true),
		('0004', 8, 'checkout_sessions', 'gateway_account_id', 'pg_catalog', 'uuid', NULL::integer, false),
		('0004', 9, 'checkout_sessions', 'gateway_external_account_id_snapshot', 'pg_catalog', 'varchar', 200, false),
		('0004', 10, 'checkout_sessions', 'gateway_payment_id', 'pg_catalog', 'varchar', 200, false),
		('0004', 11, 'checkout_sessions', 'gateway_invoice_slug', 'pg_catalog', 'varchar', 200, false),
		('0004', 12, 'checkout_sessions', 'request_fingerprint', 'pg_catalog', 'varchar', 64, false),
		('0004', 13, 'checkout_sessions', 'recovery_token_hash', 'pg_catalog', 'varchar', 64, false),
		('0004', 14, 'checkout_sessions', 'external_creation_state', 'pg_catalog', 'varchar', 24, true),
		('0004', 15, 'checkout_sessions', 'external_request_started_at', 'pg_catalog', 'timestamptz', NULL::integer, false),
		('0005', 1, 'group_participants', 'billing_amount', 'pg_catalog', 'int4', NULL::integer, true)
),
marker_column_reports AS (
	SELECT
		'50_marker_' || expected.migration_name AS section,
		format('public.%s.%s', expected.table_name, expected.column_name) AS item,
		CASE
			WHEN actual.column_name IS NULL THEN 'missing'
			WHEN actual.udt_schema IS DISTINCT FROM expected.udt_schema
				OR actual.udt_name IS DISTINCT FROM expected.udt_name
				OR actual.character_maximum_length IS DISTINCT FROM expected.character_maximum_length THEN 'conflict'
			WHEN (actual.is_nullable = 'NO') IS DISTINCT FROM expected.expected_not_null THEN 'present_partial'
			ELSE 'present'
		END AS status,
		format('%s.%s%s; not_null=%s', expected.udt_schema, expected.udt_name, CASE WHEN expected.character_maximum_length IS NULL THEN '' ELSE '(' || expected.character_maximum_length::text || ')' END, expected.expected_not_null) AS expected,
		CASE
			WHEN actual.column_name IS NULL THEN '<absent>'
			ELSE format('%s.%s%s; not_null=%s', actual.udt_schema, actual.udt_name, CASE WHEN actual.character_maximum_length IS NULL THEN '' ELSE '(' || actual.character_maximum_length::text || ')' END, actual.is_nullable = 'NO')
		END AS actual
	FROM expected_marker_columns expected
	LEFT JOIN information_schema.columns actual
		ON actual.table_schema = 'public'
		AND actual.table_name = expected.table_name
		AND actual.column_name = expected.column_name
),
financial_role_marker AS (
	SELECT
		t.oid AS type_oid,
		t.typtype,
		ARRAY(
			SELECT e.enumlabel::text
			FROM pg_catalog.pg_enum e
			WHERE e.enumtypid = t.oid
			ORDER BY e.enumsortorder
		) AS labels
	FROM (SELECT 1) seed
	LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
	LEFT JOIN pg_catalog.pg_type t
		ON t.typnamespace = n.oid
		AND t.typname = 'financial_role'
),
marker_object_reports AS (
	SELECT
		'50_marker_0004'::text AS section,
		'public.financial_role'::text AS item,
		CASE
			WHEN type_oid IS NULL THEN 'missing'
			WHEN typtype IS DISTINCT FROM 'e' OR labels IS DISTINCT FROM ARRAY['responsible', 'dependent']::text[] THEN 'conflict'
			ELSE 'present'
		END AS status,
		'enum labels={responsible,dependent}'::text AS expected,
		CASE WHEN type_oid IS NULL THEN '<absent>' ELSE format('typtype=%s; labels=%s', typtype, labels::text) END AS actual
	FROM financial_role_marker

	UNION ALL

	SELECT
		'50_marker_0004',
		'public.financial_contacts',
		CASE WHEN relation.oid IS NULL THEN 'missing' WHEN relation.relkind IS DISTINCT FROM 'r' THEN 'conflict' ELSE 'present' END,
		'ordinary table',
		CASE WHEN relation.oid IS NULL THEN '<absent>' ELSE 'relkind=' || relation.relkind::text END
	FROM (SELECT pg_catalog.to_regclass('public.financial_contacts') AS oid) resolved
	LEFT JOIN pg_catalog.pg_class relation ON relation.oid = resolved.oid

	UNION ALL

	SELECT
		'50_marker_0004',
		'public.organization_settings',
		CASE WHEN relation.oid IS NULL THEN 'missing' WHEN relation.relkind IS DISTINCT FROM 'r' THEN 'conflict' ELSE 'present' END,
		'ordinary table',
		CASE WHEN relation.oid IS NULL THEN '<absent>' ELSE 'relkind=' || relation.relkind::text END
	FROM (SELECT pg_catalog.to_regclass('public.organization_settings') AS oid) resolved
	LEFT JOIN pg_catalog.pg_class relation ON relation.oid = resolved.oid

	UNION ALL

	SELECT
		'50_marker_0004',
		'public.checkout_sessions_organization_idempotency_unique',
		CASE WHEN index_oid IS NULL THEN 'missing' WHEN is_exact THEN 'present' ELSE 'conflict' END,
		'unique btree on public.checkout_sessions(organization_id,idempotency_key)',
		CASE WHEN index_oid IS NULL THEN '<absent>' ELSE coalesce(definition, '<definition unavailable>') END
	FROM index_variant_evaluation
	WHERE variant_name = 'replacement_0004'

	UNION ALL

	SELECT
		'50_marker_0004',
		'public.cobradora_enforce_participant_contact_organization()',
		CASE WHEN pg_catalog.to_regprocedure('public.cobradora_enforce_participant_contact_organization()') IS NULL THEN 'missing' ELSE 'present' END,
		'function with zero arguments',
		coalesce(pg_catalog.to_regprocedure('public.cobradora_enforce_participant_contact_organization()')::text, '<absent>')

	UNION ALL

	SELECT
		'50_marker_0004',
		'checkout_sessions_external_creation_state_check',
		CASE
			WHEN c.oid IS NULL THEN 'missing'
			WHEN c.contype IS DISTINCT FROM 'c' OR NOT c.convalidated THEN 'conflict'
			ELSE 'present'
		END,
		'validated CHECK on public.checkout_sessions',
		coalesce(pg_catalog.pg_get_constraintdef(c.oid, true), '<absent>')
	FROM (SELECT 1) seed
	LEFT JOIN pg_catalog.pg_constraint c
		ON c.conrelid = pg_catalog.to_regclass('public.checkout_sessions')
		AND c.conname = 'checkout_sessions_external_creation_state_check'

	UNION ALL

	SELECT
		'50_marker_0005',
		'group_participants_billing_amount_check',
		CASE
			WHEN c.oid IS NULL THEN 'missing'
			WHEN c.contype IS DISTINCT FROM 'c' OR NOT c.convalidated THEN 'conflict'
			ELSE 'present'
		END,
		'validated CHECK on public.group_participants',
		coalesce(pg_catalog.pg_get_constraintdef(c.oid, true), '<absent>')
	FROM (SELECT 1) seed
	LEFT JOIN pg_catalog.pg_constraint c
		ON c.conrelid = pg_catalog.to_regclass('public.group_participants')
		AND c.conname = 'group_participants_billing_amount_check'
),
baseline_reports AS (
	SELECT * FROM enum_reports
	UNION ALL SELECT * FROM table_reports
	UNION ALL SELECT * FROM fk_reports
	UNION ALL SELECT * FROM index_reports
),
all_marker_reports AS (
	SELECT * FROM marker_column_reports
	UNION ALL SELECT * FROM marker_object_reports
),
baseline_summary AS (
	SELECT
		'01_summary'::text AS section,
		section AS item,
		CASE
			WHEN count(*) FILTER (WHERE status = 'conflict') > 0 THEN 'conflict'
			WHEN count(*) FILTER (WHERE status = 'missing') > 0 THEN 'incomplete'
			ELSE 'ok'
		END AS status,
		format('items=%s', count(*)) AS expected,
		format(
			'ok=%s; missing=%s; conflict=%s',
			count(*) FILTER (WHERE status LIKE 'ok%'),
			count(*) FILTER (WHERE status = 'missing'),
			count(*) FILTER (WHERE status = 'conflict')
		) AS actual
	FROM baseline_reports
	GROUP BY section
),
marker_summary AS (
	SELECT
		'01_summary'::text AS section,
		section AS item,
		CASE
			WHEN count(*) FILTER (WHERE status = 'conflict') > 0 THEN 'conflict'
			WHEN count(*) FILTER (WHERE status IN ('present', 'ok')) = 0
				AND count(*) FILTER (WHERE status = 'present_partial') = 0 THEN 'absent'
			WHEN count(*) FILTER (WHERE status IN ('missing', 'present_partial')) > 0 THEN 'partial'
			ELSE 'markers_present'
		END AS status,
		format('markers=%s', count(*)) AS expected,
		format(
			'present=%s; partial=%s; missing=%s; conflict=%s',
			count(*) FILTER (WHERE status IN ('present', 'ok')),
			count(*) FILTER (WHERE status = 'present_partial'),
			count(*) FILTER (WHERE status = 'missing'),
			count(*) FILTER (WHERE status = 'conflict')
		) AS actual
	FROM all_marker_reports
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
	UNION ALL SELECT * FROM marker_summary
	UNION ALL SELECT * FROM baseline_reports
	UNION ALL SELECT * FROM all_marker_reports
)
SELECT section, item, status, expected, actual
FROM final_report
ORDER BY section, item;
