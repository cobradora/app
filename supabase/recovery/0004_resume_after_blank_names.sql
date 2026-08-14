-- COBRADORA RECOVERY 0004 - VERSAO 4 (COMPATIVEL COM SUPABASE SQL EDITOR)
-- CobraDora: retomada transacional da migration 0004.
--
-- Use este arquivo somente quando a primeira execucao de 0004_lowly_clea.sql
-- tiver parado no preflight de participantes com nome vazio e uma nova
-- tentativa tiver falhado porque o tipo public.financial_role ja existe.
--
-- Nao execute 0004_lowly_clea.sql novamente antes ou depois deste arquivo.
-- Execute o arquivo inteiro em uma consulta nova do SQL Editor. Esta versao
-- evita construcoes que o Dashboard pode confundir com criacao de tabelas e,
-- por isso, nao deve receber comandos automaticos de ativacao de RLS.
-- Se qualquer preflight desta retomada falhar, toda a transacao sera revertida.

BEGIN;

-- Serializa qualquer nova tentativa desta recuperacao na mesma base.
SELECT pg_advisory_xact_lock(4400042026);

-- Confirma que o prefixo obrigatorio da 0004 existe. Os objetos posteriores
-- podem estar ausentes ou presentes, pois o SQL Editor pode ter persistido
-- comandos nao contiguos; suas definicoes sao validadas mais abaixo.
DO $$
BEGIN
	IF to_regtype('public.financial_role') IS NULL THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: tipo public.financial_role ausente; este nao e o estado parcial esperado';
	END IF;

	IF (
		SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		JOIN pg_enum e ON e.enumtypid = t.oid
		WHERE n.nspname = 'public' AND t.typname = 'financial_role'
	) IS DISTINCT FROM ARRAY['responsible', 'dependent']::text[] THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: public.financial_role possui valores inesperados';
	END IF;

	IF to_regclass('public.role_labels') IS NOT NULL THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: objeto inesperado public.role_labels detectado; ele pode ter sido criado por uma reescrita anterior do SQL Editor. Inspecione sua origem e nao o remova automaticamente';
	END IF;

	IF to_regclass('public.financial_contacts') IS NULL
		OR to_regclass('public.organization_settings') IS NULL THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: tabelas iniciais ausentes; este nao e o estado parcial esperado';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM (
			VALUES
				('participants', 'financial_contact_id', 'uuid', NULL::integer),
				('participants', 'name_normalized', 'varchar', 200),
				('participants', 'financial_role', 'financial_role', NULL::integer),
				('participants', 'created_at', 'timestamptz', NULL::integer),
				('group_participants', 'billing_starts_on', 'date', NULL::integer),
				('group_participants', 'participant_name_normalized', 'varchar', 200),
				('checkout_sessions', 'financial_contact_id', 'uuid', NULL::integer),
				('checkout_sessions', 'gateway_account_id', 'uuid', NULL::integer),
				('checkout_sessions', 'gateway_external_account_id_snapshot', 'varchar', 200),
				('checkout_sessions', 'gateway_payment_id', 'varchar', 200),
				('checkout_sessions', 'gateway_invoice_slug', 'varchar', 200),
				('checkout_sessions', 'request_fingerprint', 'varchar', 64),
				('checkout_sessions', 'recovery_token_hash', 'varchar', 64),
				('checkout_sessions', 'external_creation_state', 'varchar', 24),
				('checkout_sessions', 'external_request_started_at', 'timestamptz', NULL::integer)
		) AS required_columns(table_name, column_name, udt_name, character_maximum_length)
		LEFT JOIN information_schema.columns c
			ON c.table_schema = 'public'
			AND c.table_name = required_columns.table_name
			AND c.column_name = required_columns.column_name
		WHERE c.column_name IS NULL
			OR c.udt_name IS DISTINCT FROM required_columns.udt_name
			OR c.character_maximum_length IS DISTINCT FROM required_columns.character_maximum_length
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: coluna do prefixo ausente ou com tipo/tamanho inesperado';
	END IF;

END
$$;

-- Congela escritas enquanto o snapshot legado, os backfills e as validacoes
-- estruturais sao reconciliados. A ordem alfabetica reduz risco de deadlock
-- com outra manutencao que siga a mesma disciplina.
LOCK TABLE
	public.billing_periods,
	public.charges,
	public.checkout_items,
	public.checkout_sessions,
	public.commissions,
	public.financial_contacts,
	public.gateway_accounts,
	public.group_participants,
	public.groups,
	public.organization_settings,
	public.organizations,
	public.participants,
	public.payment_allocations,
	public.payments
IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
	-- O indice global legado aparece em 0000, mas pode ja ter sido removido por
	-- uma execucao parcial. A nova unicidade e validada pelos dados e, quando o
	-- indice final existir, tambem pela definicao catalogada.
	IF EXISTS (
		SELECT 1
		FROM checkout_sessions
		GROUP BY organization_id, idempotency_key
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: existem chaves de idempotencia duplicadas dentro da mesma organizacao';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM financial_contacts
		GROUP BY organization_id, phone_normalized
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: contatos financeiros duplicados; revise os dados antes de retomar';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM participants p
		CROSS JOIN LATERAL (
			SELECT regexp_replace(coalesce(p.phone_normalized, ''), '[^0-9]', '', 'g') AS digits
		) d
		WHERE p.financial_contact_id IS NULL
			AND d.digits !~ '^55[1-9][0-9]9[0-9]{8}$'
			AND d.digits !~ '^[1-9][0-9]9[0-9]{8}$'
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: existem telefones legados invalidos; corrija-os antes de continuar';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM participants p
		CROSS JOIN LATERAL (
			SELECT regexp_replace(coalesce(p.phone_normalized, ''), '[^0-9]', '', 'g') AS digits
		) d
		LEFT JOIN financial_contacts fc
			ON fc.organization_id = p.organization_id
			AND fc.phone_normalized = CASE
				WHEN d.digits ~ '^55[1-9][0-9]9[0-9]{8}$' THEN '+' || d.digits
				ELSE '+55' || d.digits
			END
		WHERE p.financial_contact_id IS NULL
		GROUP BY p.id
		HAVING count(fc.id) <> 1
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: o backfill inicial de contatos nao cobre exatamente uma vez cada participante';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM participants p
		WHERE p.financial_contact_id IS NOT NULL
			AND NOT EXISTS (
				SELECT 1
				FROM financial_contacts fc
				WHERE fc.id = p.financial_contact_id
					AND fc.organization_id = p.organization_id
			)
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: participante ja vinculado aponta para contato ausente ou de outra organizacao';
	END IF;
END
$$;

-- Valida todo indice de 0004 que ja exista. Indices ausentes serao criados
-- mais abaixo; um indice homonimo com tabela, colunas ou predicado diferente
-- interrompe a reconciliacao.
DO $$
DECLARE
	expected record;
	actual record;
	normalized_predicate text;
BEGIN
	FOR expected IN
		SELECT *
		FROM (
			VALUES
				('checkout_sessions_idempotency_unique', 'checkout_sessions', true, ARRAY['idempotency_key']::text[], NULL::text),
				('checkout_sessions_organization_idempotency_unique', 'checkout_sessions', true, ARRAY['organization_id', 'idempotency_key']::text[], NULL::text),
				('checkout_sessions_financial_contact_idx', 'checkout_sessions', false, ARRAY['financial_contact_id']::text[], NULL::text),
				('checkout_sessions_request_fingerprint_idx', 'checkout_sessions', false, ARRAY['organization_id', 'request_fingerprint']::text[], NULL::text),
				('financial_contacts_organization_phone_unique', 'financial_contacts', true, ARRAY['organization_id', 'phone_normalized']::text[], NULL::text),
				('financial_contacts_organization_id_id_unique', 'financial_contacts', true, ARRAY['organization_id', 'id']::text[], NULL::text),
				('participants_financial_contact_idx', 'participants', false, ARRAY['financial_contact_id']::text[], NULL::text),
				('participants_organization_id_id_unique', 'participants', true, ARRAY['organization_id', 'id']::text[], NULL::text),
				('participants_financial_contact_responsible_unique', 'participants', true, ARRAY['financial_contact_id']::text[], 'financial_role=''responsible'''),
				('group_participants_active_name_unique', 'group_participants', true, ARRAY['group_id', 'participant_name_normalized']::text[], 'status=''active'''),
				('groups_organization_id_id_unique', 'groups', true, ARRAY['organization_id', 'id']::text[], NULL::text),
				('groups_organization_status_idx', 'groups', false, ARRAY['organization_id', 'status']::text[], NULL::text),
				('gateway_accounts_organization_provider_unique', 'gateway_accounts', true, ARRAY['organization_id', 'provider']::text[], NULL::text),
				('gateway_accounts_organization_id_id_unique', 'gateway_accounts', true, ARRAY['organization_id', 'id']::text[], NULL::text),
				('payment_allocations_charge_unique', 'payment_allocations', true, ARRAY['charge_id']::text[], NULL::text)
		) AS definitions(index_name, table_name, is_unique, column_names, predicate_prefix)
	LOOP
		IF EXISTS (
			SELECT 1
			FROM pg_class reserved_relation
			JOIN pg_namespace reserved_namespace
				ON reserved_namespace.oid = reserved_relation.relnamespace
			WHERE reserved_namespace.nspname = 'public'
				AND reserved_relation.relname::text = expected.index_name
				AND reserved_relation.relkind <> 'i'
		) THEN
			RAISE EXCEPTION 'CobraDora recovery 0004: nome de indice % esta ocupado por outro tipo de objeto', expected.index_name;
		END IF;

		FOR actual IN
			SELECT
			table_relation.relname::text AS table_name,
			i.indisunique AS is_unique,
			am.amname::text AS access_method,
			ARRAY(
				SELECT replace(pg_get_indexdef(i.indexrelid, positions.position, false), '"', '')
				FROM generate_series(1, i.indnkeyatts) AS positions(position)
				ORDER BY positions.position
			) AS column_names,
			pg_get_expr(i.indpred, i.indrelid) AS predicate,
			i.indisvalid AS is_valid,
			i.indisready AS is_ready,
			(i.indnatts <> i.indnkeyatts) AS has_included_columns,
			i.indisexclusion AS is_exclusion,
			EXISTS (
				SELECT 1
				FROM pg_constraint constraint_definition
				WHERE constraint_definition.conindid = i.indexrelid
			) AS backs_constraint
			FROM pg_class index_relation
			JOIN pg_namespace index_namespace ON index_namespace.oid = index_relation.relnamespace
			JOIN pg_index i ON i.indexrelid = index_relation.oid
			JOIN pg_class table_relation ON table_relation.oid = i.indrelid
			JOIN pg_am am ON am.oid = index_relation.relam
			WHERE index_namespace.nspname = 'public'
				AND index_relation.relname::text = expected.index_name
		LOOP
			IF actual.table_name IS DISTINCT FROM expected.table_name
				OR actual.is_unique IS DISTINCT FROM expected.is_unique
				OR actual.access_method IS DISTINCT FROM 'btree'
				OR actual.column_names IS DISTINCT FROM expected.column_names
				OR NOT actual.is_valid
				OR NOT actual.is_ready
				OR actual.has_included_columns
				OR actual.is_exclusion
				OR (
					actual.backs_constraint
					AND expected.index_name = 'checkout_sessions_idempotency_unique'
				) THEN
				RAISE EXCEPTION 'CobraDora recovery 0004: indice % possui definicao inesperada', expected.index_name;
			END IF;

			normalized_predicate := translate(
				regexp_replace(lower(coalesce(actual.predicate, '')), '[[:space:]]+', '', 'g'),
				'"()',
				''
			);
			normalized_predicate := regexp_replace(
				normalized_predicate,
				'(public\.)?' || expected.table_name || '\.',
				'',
				'g'
			);

			IF expected.predicate_prefix IS NULL AND actual.predicate IS NOT NULL THEN
				RAISE EXCEPTION 'CobraDora recovery 0004: indice % possui predicado inesperado', expected.index_name;
			ELSIF expected.predicate_prefix IS NOT NULL
				AND (
					actual.predicate IS NULL
					OR normalized_predicate !~ (
						'^' || expected.predicate_prefix || '(::[a-z0-9_.]+)?$'
					)
				) THEN
				RAISE EXCEPTION 'CobraDora recovery 0004: indice parcial % possui predicado inesperado: %', expected.index_name, actual.predicate;
			END IF;
		END LOOP;
	END LOOP;
END
$$;

-- Valida FKs e CHECKs existentes por tabela, colunas e alvo. Os ausentes
-- continuam permitidos e serao instalados de forma condicional.
DO $$
DECLARE
	expected record;
	actual record;
	normalized_expression text;
BEGIN
	FOR expected IN
		SELECT *
		FROM (
			VALUES
				('financial_contacts_organization_id_organizations_id_fk', 'financial_contacts', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
				('organization_settings_organization_id_organizations_id_fk', 'organization_settings', ARRAY['organization_id']::text[], 'organizations', ARRAY['id']::text[]),
				('participants_financial_contact_id_financial_contacts_id_fk', 'participants', ARRAY['financial_contact_id']::text[], 'financial_contacts', ARRAY['id']::text[]),
				('checkout_sessions_financial_contact_id_financial_contacts_id_fk', 'checkout_sessions', ARRAY['financial_contact_id']::text[], 'financial_contacts', ARRAY['id']::text[]),
				('checkout_sessions_gateway_account_id_gateway_accounts_id_fk', 'checkout_sessions', ARRAY['gateway_account_id']::text[], 'gateway_accounts', ARRAY['id']::text[]),
				('participants_organization_financial_contact_fk', 'participants', ARRAY['organization_id', 'financial_contact_id']::text[], 'financial_contacts', ARRAY['organization_id', 'id']::text[]),
				('checkout_sessions_organization_participant_fk', 'checkout_sessions', ARRAY['organization_id', 'participant_id']::text[], 'participants', ARRAY['organization_id', 'id']::text[]),
				('checkout_sessions_organization_financial_contact_fk', 'checkout_sessions', ARRAY['organization_id', 'financial_contact_id']::text[], 'financial_contacts', ARRAY['organization_id', 'id']::text[]),
				('checkout_sessions_organization_gateway_account_fk', 'checkout_sessions', ARRAY['organization_id', 'gateway_account_id']::text[], 'gateway_accounts', ARRAY['organization_id', 'id']::text[]),
				('payments_organization_participant_fk', 'payments', ARRAY['organization_id', 'participant_id']::text[], 'participants', ARRAY['organization_id', 'id']::text[])
		) AS definitions(constraint_name, table_name, column_names, referenced_table_name, referenced_column_names)
	LOOP
		FOR actual IN
			SELECT
			c.contype,
			table_relation.relname::text AS table_name,
			referenced_relation.relname::text AS referenced_table_name,
			referenced_namespace.nspname::text AS referenced_schema_name,
			ARRAY(
				SELECT a.attname::text
				FROM unnest(c.conkey) WITH ORDINALITY AS keys(attnum, position)
				JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum
				ORDER BY keys.position
			) AS column_names,
			ARRAY(
				SELECT a.attname::text
				FROM unnest(c.confkey) WITH ORDINALITY AS keys(attnum, position)
				JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = keys.attnum
				ORDER BY keys.position
			) AS referenced_column_names,
			c.confupdtype,
			c.confdeltype,
			c.confmatchtype,
			c.condeferrable,
			c.convalidated
			FROM pg_constraint c
			JOIN pg_namespace n ON n.oid = c.connamespace
			LEFT JOIN pg_class table_relation ON table_relation.oid = c.conrelid
			LEFT JOIN pg_class referenced_relation ON referenced_relation.oid = c.confrelid
			LEFT JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
			WHERE n.nspname = 'public'
				AND c.conname::text = expected.constraint_name
		LOOP
			IF actual.contype IS DISTINCT FROM 'f'
				OR actual.table_name IS DISTINCT FROM expected.table_name
				OR actual.referenced_table_name IS DISTINCT FROM expected.referenced_table_name
				OR actual.referenced_schema_name IS DISTINCT FROM 'public'
				OR actual.column_names IS DISTINCT FROM expected.column_names
				OR actual.referenced_column_names IS DISTINCT FROM expected.referenced_column_names
				OR actual.confupdtype IS DISTINCT FROM 'a'
				OR actual.confdeltype IS DISTINCT FROM 'a'
				OR actual.confmatchtype IS DISTINCT FROM 's'
				OR actual.condeferrable
				OR NOT actual.convalidated THEN
				RAISE EXCEPTION 'CobraDora recovery 0004: FK % possui definicao inesperada', expected.constraint_name;
			END IF;
		END LOOP;
	END LOOP;

	FOR expected IN
		SELECT *
		FROM (
			VALUES
				('groups_billing_day_check', 'groups', 'billing_day'),
				('groups_default_amount_check', 'groups', 'default_amount'),
				('checkout_sessions_external_creation_state_check', 'checkout_sessions', 'external_creation_state')
		) AS definitions(constraint_name, table_name, expression_kind)
	LOOP
		FOR actual IN
			SELECT
			c.contype,
			table_relation.relname::text AS table_name,
			pg_get_expr(c.conbin, c.conrelid) AS expression,
			c.convalidated,
			c.connoinherit
			FROM pg_constraint c
			JOIN pg_namespace n ON n.oid = c.connamespace
			LEFT JOIN pg_class table_relation ON table_relation.oid = c.conrelid
			WHERE n.nspname = 'public'
				AND c.conname::text = expected.constraint_name
		LOOP
			normalized_expression := translate(
				regexp_replace(lower(actual.expression), '[[:space:]]+', '', 'g'),
				'"()',
				''
			);
			normalized_expression := regexp_replace(
				normalized_expression,
				'(public\.)?' || expected.table_name || '\.',
				'',
				'g'
			);

			IF actual.contype IS DISTINCT FROM 'c'
				OR actual.table_name IS DISTINCT FROM expected.table_name
				OR NOT actual.convalidated
				OR actual.connoinherit THEN
				RAISE EXCEPTION 'CobraDora recovery 0004: CHECK % possui definicao estrutural inesperada', expected.constraint_name;
			END IF;

			IF expected.expression_kind = 'billing_day'
				AND normalized_expression IS DISTINCT FROM 'billing_day>=1andbilling_day<=28' THEN
				RAISE EXCEPTION 'CobraDora recovery 0004: CHECK % possui expressao inesperada: %', expected.constraint_name, actual.expression;
			ELSIF expected.expression_kind = 'default_amount'
				AND normalized_expression IS DISTINCT FROM 'default_amount>0' THEN
				RAISE EXCEPTION 'CobraDora recovery 0004: CHECK % possui expressao inesperada: %', expected.constraint_name, actual.expression;
			ELSIF expected.expression_kind = 'external_creation_state' THEN
				IF position('external_creation_state' IN normalized_expression) = 0
					OR position('=any' IN normalized_expression) = 0
					OR (
						SELECT ARRAY(
							SELECT matched_value[1]
							FROM regexp_matches(actual.expression, '''([^'']+)''', 'g')
								AS matched_values(matched_value)
							ORDER BY matched_value[1]
						)
					) IS DISTINCT FROM ARRAY['ambiguous', 'in_flight', 'linked', 'not_started']::text[] THEN
					RAISE EXCEPTION 'CobraDora recovery 0004: CHECK % possui expressao inesperada: %', expected.constraint_name, actual.expression;
				END IF;
			END IF;
		END LOOP;
	END LOOP;
END
$$;

-- Nomes reservados precisam ter assinaturas/tabelas compativeis antes de
-- serem canonicalizados transacionalmente.
DO $$
DECLARE
	expected record;
BEGIN
	-- CREATE OR REPLACE nao pode mudar o tipo de retorno. Se um objeto estranho
	-- ocupou um nome reservado, pare antes de tocar nos dados.
	IF EXISTS (
		SELECT 1
		FROM pg_proc p
		JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = 'public'
			AND p.pronargs = 0
			AND p.proname::text = ANY (ARRAY[
				'cobradora_enforce_participant_contact_organization',
				'cobradora_sync_group_participant_name',
				'cobradora_propagate_participant_name',
				'cobradora_enforce_charge_tenant',
				'cobradora_enforce_checkout_session_tenant',
				'cobradora_enforce_checkout_item_tenant',
				'cobradora_enforce_payment_tenant',
				'cobradora_enforce_payment_allocation_tenant',
				'cobradora_enforce_commission_tenant',
				'cobradora_enforce_contact_responsible',
				'cobradora_prevent_organization_reassignment'
			]::text[])
			AND (p.prokind <> 'f' OR p.prorettype <> 'trigger'::regtype)
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: nome de funcao reservado possui assinatura incompatível';
	END IF;

	-- Trigger e nome de trigger sao locais a uma tabela. Rejeitamos apenas um
	-- homonimo instalado em tabela diferente; os da tabela canonica serao
	-- recriados transacionalmente logo abaixo.
	FOR expected IN
		SELECT *
		FROM (
			VALUES
				('participants_contact_organization_trigger', 'participants'),
				('group_participants_name_sync_trigger', 'group_participants'),
				('participants_name_propagation_trigger', 'participants'),
				('charges_tenant_trigger', 'charges'),
				('checkout_sessions_tenant_trigger', 'checkout_sessions'),
				('checkout_items_tenant_trigger', 'checkout_items'),
				('payments_tenant_trigger', 'payments'),
				('payment_allocations_tenant_trigger', 'payment_allocations'),
				('commissions_tenant_trigger', 'commissions'),
				('participants_contact_responsible_constraint_trigger', 'participants'),
				('groups_organization_immutable_trigger', 'groups'),
				('financial_contacts_organization_immutable_trigger', 'financial_contacts'),
				('participants_organization_immutable_trigger', 'participants'),
				('gateway_accounts_organization_immutable_trigger', 'gateway_accounts'),
				('checkout_sessions_organization_immutable_trigger', 'checkout_sessions'),
				('payments_organization_immutable_trigger', 'payments'),
				('commissions_organization_immutable_trigger', 'commissions')
		) AS definitions(trigger_name, table_name)
	LOOP
		IF EXISTS (
			SELECT 1
			FROM pg_trigger t
			JOIN pg_class table_relation ON table_relation.oid = t.tgrelid
			JOIN pg_namespace n ON n.oid = table_relation.relnamespace
			WHERE n.nspname = 'public'
				AND t.tgname::text = expected.trigger_name
				AND table_relation.relname::text <> expected.table_name
				AND NOT t.tgisinternal
		) THEN
			RAISE EXCEPTION 'CobraDora recovery 0004: trigger reservado % existe em tabela inesperada', expected.trigger_name;
		END IF;
	END LOOP;
END
$$;
-- Canonicaliza as funcoes e triggers reservadas pela 0004 antes de qualquer
-- backfill. Assim um objeto parcialmente criado nunca executa durante a
-- reconciliacao. DROP/CREATE de trigger e transacional.
CREATE OR REPLACE FUNCTION public.cobradora_enforce_participant_contact_organization()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM public.financial_contacts fc
		WHERE fc.id = NEW.financial_contact_id AND fc.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'financial contact and participant must belong to the same organization';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participants_contact_organization_trigger ON public.participants;
CREATE TRIGGER participants_contact_organization_trigger
BEFORE INSERT OR UPDATE OF financial_contact_id, organization_id ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_participant_contact_organization();

CREATE OR REPLACE FUNCTION public.cobradora_sync_group_participant_name()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
	participant_organization_id uuid;
	group_organization_id uuid;
BEGIN
	NEW.participant_name_normalized := (
		SELECT p.name_normalized
		FROM public.participants p
		WHERE p.id = NEW.participant_id
	);
	participant_organization_id := (
		SELECT p.organization_id
		FROM public.participants p
		WHERE p.id = NEW.participant_id
	);
	group_organization_id := (
		SELECT g.organization_id
		FROM public.groups g
		WHERE g.id = NEW.group_id
	);

	IF participant_organization_id IS NULL
		OR group_organization_id IS NULL
		OR participant_organization_id <> group_organization_id THEN
		RAISE EXCEPTION 'group participant must belong to the group organization';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS group_participants_name_sync_trigger ON public.group_participants;
CREATE TRIGGER group_participants_name_sync_trigger
BEFORE INSERT OR UPDATE OF group_id, participant_id ON public.group_participants
FOR EACH ROW EXECUTE FUNCTION public.cobradora_sync_group_participant_name();

CREATE OR REPLACE FUNCTION public.cobradora_propagate_participant_name()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
	IF NEW.name_normalized IS DISTINCT FROM OLD.name_normalized THEN
		UPDATE public.group_participants
		SET participant_name_normalized = NEW.name_normalized
		WHERE participant_id = NEW.id AND status = 'active';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS participants_name_propagation_trigger ON public.participants;
CREATE TRIGGER participants_name_propagation_trigger
AFTER UPDATE OF name_normalized ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.cobradora_propagate_participant_name();

CREATE OR REPLACE FUNCTION public.cobradora_enforce_charge_tenant()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
	charge_organization_id uuid;
	participant_organization_id uuid;
	charge_group_id uuid;
BEGIN
	charge_organization_id := (
		SELECT g.organization_id
		FROM public.billing_periods bp
		JOIN public.groups g ON g.id = bp.group_id
		WHERE bp.id = NEW.billing_period_id
	);
	charge_group_id := (
		SELECT g.id
		FROM public.billing_periods bp
		JOIN public.groups g ON g.id = bp.group_id
		WHERE bp.id = NEW.billing_period_id
	);
	participant_organization_id := (
		SELECT p.organization_id
		FROM public.participants p
		WHERE p.id = NEW.participant_id
	);

	IF charge_organization_id IS NULL
		OR participant_organization_id IS NULL
		OR charge_organization_id <> participant_organization_id
		OR NOT EXISTS (
			SELECT 1 FROM public.group_participants gp
			WHERE gp.group_id = charge_group_id AND gp.participant_id = NEW.participant_id
		) THEN
		RAISE EXCEPTION 'charge must belong to the participant organization and group';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS charges_tenant_trigger ON public.charges;
CREATE TRIGGER charges_tenant_trigger
BEFORE INSERT OR UPDATE OF billing_period_id, participant_id ON public.charges
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_charge_tenant();

CREATE OR REPLACE FUNCTION public.cobradora_enforce_checkout_session_tenant()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
	participant_organization_id uuid;
	participant_contact_id uuid;
	participant_financial_role public.financial_role;
	contact_organization_id uuid;
	gateway_organization_id uuid;
	gateway_provider varchar(40);
BEGIN
	participant_organization_id := (
		SELECT p.organization_id
		FROM public.participants p
		WHERE p.id = NEW.participant_id
	);
	participant_contact_id := (
		SELECT p.financial_contact_id
		FROM public.participants p
		WHERE p.id = NEW.participant_id
	);
	participant_financial_role := (
		SELECT p.financial_role
		FROM public.participants p
		WHERE p.id = NEW.participant_id
	);
	contact_organization_id := (
		SELECT fc.organization_id
		FROM public.financial_contacts fc
		WHERE fc.id = NEW.financial_contact_id
	);

	IF NEW.gateway_account_id IS NOT NULL THEN
		gateway_organization_id := (
			SELECT ga.organization_id
			FROM public.gateway_accounts ga
			WHERE ga.id = NEW.gateway_account_id
		);
		gateway_provider := (
			SELECT ga.provider
			FROM public.gateway_accounts ga
			WHERE ga.id = NEW.gateway_account_id
		);
	END IF;

	IF participant_organization_id IS NULL
		OR contact_organization_id IS NULL
		OR participant_organization_id <> NEW.organization_id
		OR contact_organization_id <> NEW.organization_id
		OR participant_contact_id <> NEW.financial_contact_id
		OR participant_financial_role <> 'responsible'::public.financial_role
		OR (NEW.gateway_account_id IS NOT NULL AND (
			gateway_organization_id IS NULL
			OR gateway_organization_id <> NEW.organization_id
			OR gateway_provider <> NEW.gateway
		)) THEN
		RAISE EXCEPTION 'checkout session must use the responsible participant, contact and gateway from its organization';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_sessions_tenant_trigger ON public.checkout_sessions;
CREATE TRIGGER checkout_sessions_tenant_trigger
BEFORE INSERT OR UPDATE OF organization_id, participant_id, financial_contact_id, gateway_account_id, gateway ON public.checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_checkout_session_tenant();

CREATE OR REPLACE FUNCTION public.cobradora_enforce_checkout_item_tenant()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
	session_organization_id uuid;
	session_contact_id uuid;
	charge_organization_id uuid;
	debtor_contact_id uuid;
BEGIN
	session_organization_id := (
		SELECT cs.organization_id
		FROM public.checkout_sessions cs
		WHERE cs.id = NEW.checkout_session_id
	);
	session_contact_id := (
		SELECT cs.financial_contact_id
		FROM public.checkout_sessions cs
		WHERE cs.id = NEW.checkout_session_id
	);
	charge_organization_id := (
		SELECT g.organization_id
		FROM public.charges c
		JOIN public.billing_periods bp ON bp.id = c.billing_period_id
		JOIN public.groups g ON g.id = bp.group_id
		WHERE c.id = NEW.charge_id
	);
	debtor_contact_id := (
		SELECT p.financial_contact_id
		FROM public.charges c
		JOIN public.participants p ON p.id = c.participant_id
		WHERE c.id = NEW.charge_id
	);

	IF session_organization_id IS NULL
		OR charge_organization_id IS NULL
		OR session_organization_id <> charge_organization_id
		OR session_contact_id <> debtor_contact_id THEN
		RAISE EXCEPTION 'checkout item must belong to the session tenant and financial contact';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checkout_items_tenant_trigger ON public.checkout_items;
CREATE TRIGGER checkout_items_tenant_trigger
BEFORE INSERT OR UPDATE OF checkout_session_id, charge_id ON public.checkout_items
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_checkout_item_tenant();

CREATE OR REPLACE FUNCTION public.cobradora_enforce_payment_tenant()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM public.participants p
		WHERE p.id = NEW.participant_id AND p.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'payment participant must belong to the payment organization';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_tenant_trigger ON public.payments;
CREATE TRIGGER payments_tenant_trigger
BEFORE INSERT OR UPDATE OF organization_id, participant_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_payment_tenant();

CREATE OR REPLACE FUNCTION public.cobradora_enforce_payment_allocation_tenant()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
	payment_organization_id uuid;
	payer_contact_id uuid;
	charge_organization_id uuid;
	debtor_contact_id uuid;
BEGIN
	payment_organization_id := (
		SELECT pay.organization_id
		FROM public.payments pay
		WHERE pay.id = NEW.payment_id
	);
	payer_contact_id := (
		SELECT payer.financial_contact_id
		FROM public.payments pay
		JOIN public.participants payer ON payer.id = pay.participant_id
		WHERE pay.id = NEW.payment_id
	);
	charge_organization_id := (
		SELECT g.organization_id
		FROM public.charges c
		JOIN public.billing_periods bp ON bp.id = c.billing_period_id
		JOIN public.groups g ON g.id = bp.group_id
		WHERE c.id = NEW.charge_id
	);
	debtor_contact_id := (
		SELECT debtor.financial_contact_id
		FROM public.charges c
		JOIN public.participants debtor ON debtor.id = c.participant_id
		WHERE c.id = NEW.charge_id
	);

	IF payment_organization_id IS NULL
		OR charge_organization_id IS NULL
		OR payment_organization_id <> charge_organization_id
		OR payer_contact_id <> debtor_contact_id THEN
		RAISE EXCEPTION 'payment allocation must stay inside one tenant and financial contact';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_allocations_tenant_trigger ON public.payment_allocations;
CREATE TRIGGER payment_allocations_tenant_trigger
BEFORE INSERT OR UPDATE OF payment_id, charge_id ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_payment_allocation_tenant();

CREATE OR REPLACE FUNCTION public.cobradora_enforce_commission_tenant()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
	IF NEW.group_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM public.groups g
		WHERE g.id = NEW.group_id AND g.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'commission group must belong to the commission organization';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commissions_tenant_trigger ON public.commissions;
CREATE TRIGGER commissions_tenant_trigger
BEFORE INSERT OR UPDATE OF organization_id, group_id ON public.commissions
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_commission_tenant();

CREATE OR REPLACE FUNCTION public.cobradora_enforce_contact_responsible()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
DECLARE
	contact_id uuid;
BEGIN
	FOR contact_id IN
		SELECT DISTINCT candidate
		FROM pg_catalog.unnest(ARRAY[
			CASE WHEN TG_OP <> 'INSERT' THEN OLD.financial_contact_id ELSE NULL END,
			CASE WHEN TG_OP <> 'DELETE' THEN NEW.financial_contact_id ELSE NULL END
		]) AS candidate
		WHERE candidate IS NOT NULL
	LOOP
		IF EXISTS (SELECT 1 FROM public.participants p WHERE p.financial_contact_id = contact_id)
			AND NOT EXISTS (
				SELECT 1 FROM public.participants p
				WHERE p.financial_contact_id = contact_id
					AND p.financial_role = 'responsible'::public.financial_role
			) THEN
			RAISE EXCEPTION 'financial contact with participants must have one responsible participant';
		END IF;
	END LOOP;
	RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS participants_contact_responsible_constraint_trigger ON public.participants;
CREATE CONSTRAINT TRIGGER participants_contact_responsible_constraint_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.participants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.cobradora_enforce_contact_responsible();

CREATE OR REPLACE FUNCTION public.cobradora_prevent_organization_reassignment()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
	IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
		RAISE EXCEPTION 'organization ownership is immutable';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS groups_organization_immutable_trigger ON public.groups;
CREATE TRIGGER groups_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.cobradora_prevent_organization_reassignment();

DROP TRIGGER IF EXISTS financial_contacts_organization_immutable_trigger ON public.financial_contacts;
CREATE TRIGGER financial_contacts_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON public.financial_contacts
FOR EACH ROW EXECUTE FUNCTION public.cobradora_prevent_organization_reassignment();

DROP TRIGGER IF EXISTS participants_organization_immutable_trigger ON public.participants;
CREATE TRIGGER participants_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.cobradora_prevent_organization_reassignment();

DROP TRIGGER IF EXISTS gateway_accounts_organization_immutable_trigger ON public.gateway_accounts;
CREATE TRIGGER gateway_accounts_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON public.gateway_accounts
FOR EACH ROW EXECUTE FUNCTION public.cobradora_prevent_organization_reassignment();

DROP TRIGGER IF EXISTS checkout_sessions_organization_immutable_trigger ON public.checkout_sessions;
CREATE TRIGGER checkout_sessions_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON public.checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.cobradora_prevent_organization_reassignment();

DROP TRIGGER IF EXISTS payments_organization_immutable_trigger ON public.payments;
CREATE TRIGGER payments_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.cobradora_prevent_organization_reassignment();

DROP TRIGGER IF EXISTS commissions_organization_immutable_trigger ON public.commissions;
CREATE TRIGGER commissions_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON public.commissions
FOR EACH ROW EXECUTE FUNCTION public.cobradora_prevent_organization_reassignment();

-- Corrige somente nomes legados cujo valor normalizado e vazio. O UUID evita
-- colisao entre dois placeholders dentro do mesmo grupo.
UPDATE participants
SET name = 'Participante ' || id::text
WHERE trim(regexp_replace(
	translate(lower(coalesce(name, '')),
		'áàâãäéèêëíìîïóòôõöúùûüçñ',
		'aaaaaeeeeiiiiooooouuuucn'),
	'[[:space:]]+', ' ', 'g'
)) = '';

-- Detecta colisoes pelo valor canonico antes de alterar qualquer coluna
-- normalizada. Assim um indice parcial existente nao mascara duplicatas com
-- valores legados divergentes.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM public.group_participants gp
		JOIN public.participants p ON p.id = gp.participant_id
		WHERE gp.status = 'active'
		GROUP BY
			gp.group_id,
			trim(regexp_replace(
				translate(lower(p.name),
					'áàâãäéèêëíìîïóòôõöúùûüçñ',
					'aaaaaeeeeiiiiooooouuuucn'),
				'[[:space:]]+', ' ', 'g'
			))
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: existem nomes canonicamente duplicados no mesmo grupo; resolva-os antes de continuar';
	END IF;
END
$$;

-- Recalcula canonicamente o backfill que depende do nome. Nao recria contatos
-- financeiros; valores normalizados legados divergentes sao corrigidos apenas
-- depois do preflight de duplicidade acima.
WITH participant_data AS (
	SELECT
		p.id,
		fc.id AS financial_contact_id,
		p.financial_role AS current_financial_role,
		trim(regexp_replace(
			translate(lower(p.name),
				'áàâãäéèêëíìîïóòôõöúùûüçñ',
				'aaaaaeeeeiiiiooooouuuucn'),
			'[[:space:]]+', ' ', 'g'
		)) AS name_normalized,
		min(gp.joined_at) AS first_joined_at
	FROM participants p
	JOIN financial_contacts fc
		ON fc.organization_id = p.organization_id
		AND (
			(fc.id = p.financial_contact_id)
			OR (
				p.financial_contact_id IS NULL
				AND fc.phone_normalized = CASE
					WHEN regexp_replace(coalesce(p.phone_normalized, ''), '[^0-9]', '', 'g') ~ '^55[1-9][0-9]9[0-9]{8}$'
						THEN '+' || regexp_replace(p.phone_normalized, '[^0-9]', '', 'g')
					ELSE '+55' || regexp_replace(p.phone_normalized, '[^0-9]', '', 'g')
				END
			)
		)
	LEFT JOIN group_participants gp ON gp.participant_id = p.id
	GROUP BY p.id, fc.id
), ranked AS (
	SELECT *,
		count(*) FILTER (
			WHERE current_financial_role = 'responsible'::public.financial_role
		) OVER (PARTITION BY financial_contact_id) AS existing_responsible_count,
		row_number() OVER (
			PARTITION BY financial_contact_id
			ORDER BY
				CASE WHEN current_financial_role = 'responsible'::public.financial_role THEN 0 ELSE 1 END,
				first_joined_at NULLS LAST,
				id
		) AS responsibility_rank
	FROM participant_data
)
UPDATE participants p
SET financial_contact_id = coalesce(p.financial_contact_id, ranked.financial_contact_id),
	name_normalized = ranked.name_normalized,
	financial_role = coalesce(
		p.financial_role,
		CASE
			WHEN ranked.existing_responsible_count = 0 AND ranked.responsibility_rank = 1
				THEN 'responsible'::public.financial_role
			ELSE 'dependent'::public.financial_role
		END
	),
	created_at = coalesce(p.created_at, ranked.first_joined_at, now())
FROM ranked
WHERE ranked.id = p.id
	AND (
		p.financial_contact_id IS NULL
		OR p.name_normalized IS DISTINCT FROM ranked.name_normalized
		OR p.financial_role IS NULL
		OR p.created_at IS NULL
	);

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM participants
		WHERE name_normalized IS NULL
			OR name_normalized = ''
			OR name_normalized IS DISTINCT FROM trim(regexp_replace(
				translate(lower(name),
					'áàâãäéèêëíìîïóòôõöúùûüçñ',
					'aaaaaeeeeiiiiooooouuuucn'),
				'[[:space:]]+', ' ', 'g'
			))
			OR financial_contact_id IS NULL
			OR financial_role IS NULL
			OR created_at IS NULL
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: backfill de participantes permaneceu incompleto; nenhuma alteracao foi aplicada';
	END IF;
END
$$;

UPDATE group_participants gp
SET participant_name_normalized = p.name_normalized,
	billing_starts_on = coalesce(
		gp.billing_starts_on,
		CASE
			WHEN extract(day FROM gp.joined_at AT TIME ZONE 'America/Sao_Paulo') < g.billing_day
				THEN make_date(
					extract(year FROM gp.joined_at AT TIME ZONE 'America/Sao_Paulo')::integer,
					extract(month FROM gp.joined_at AT TIME ZONE 'America/Sao_Paulo')::integer,
					g.billing_day
				)
			ELSE (
				date_trunc('month', gp.joined_at AT TIME ZONE 'America/Sao_Paulo')
				+ interval '1 month'
				+ (g.billing_day - 1) * interval '1 day'
			)::date
		END
	)
FROM participants p, groups g
WHERE p.id = gp.participant_id
	AND g.id = gp.group_id
	AND (
		gp.participant_name_normalized IS DISTINCT FROM p.name_normalized
		OR gp.billing_starts_on IS NULL
	);

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM group_participants
		WHERE status = 'active'
		GROUP BY group_id, participant_name_normalized
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'CobraDora migration: existem nomes normalizados duplicados no mesmo grupo; resolva-os antes de continuar';
	END IF;
END $$;

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM gateway_accounts GROUP BY organization_id, provider HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'CobraDora migration: existem contas de gateway duplicadas por organizacao/provider';
	END IF;
END $$;

-- Reconcilia apenas sessoes cujo contato ainda esta nulo. O filtro identifica
-- o estado legado na propria linha, sem criar tabela auxiliar. Sessoes ja
-- reconciliadas preservam participante, conta e snapshots historicos.
UPDATE checkout_sessions cs
SET participant_id = responsible.id,
	financial_contact_id = responsible.financial_contact_id,
	gateway_account_id = coalesce(
		cs.gateway_account_id,
		(
			SELECT ga.id
			FROM gateway_accounts ga
			WHERE ga.organization_id = cs.organization_id
				AND ga.provider = cs.gateway
		)
	),
	gateway_external_account_id_snapshot = coalesce(
		cs.gateway_external_account_id_snapshot,
		(
			SELECT ga.external_account_id
			FROM gateway_accounts ga
			WHERE ga.organization_id = cs.organization_id
				AND ga.provider = cs.gateway
		)
	)
FROM participants current_participant
JOIN participants responsible
	ON responsible.financial_contact_id = current_participant.financial_contact_id
	AND responsible.financial_role = 'responsible'::financial_role
WHERE current_participant.id = cs.participant_id
	AND cs.financial_contact_id IS NULL;

INSERT INTO organization_settings (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM group_participants
		WHERE billing_starts_on IS NULL
			OR participant_name_normalized IS NULL
			OR participant_name_normalized = ''
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: backfill de vinculos de grupo permaneceu incompleto';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM group_participants gp
		JOIN participants p ON p.id = gp.participant_id
		WHERE gp.participant_name_normalized IS DISTINCT FROM p.name_normalized
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: nome normalizado do vinculo diverge do participante';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM checkout_sessions
		WHERE financial_contact_id IS NULL
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: backfill de sessoes legadas permaneceu incompleto';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM organizations organization
		WHERE NOT EXISTS (
			SELECT 1
			FROM organization_settings settings
			WHERE settings.organization_id = organization.id
		)
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: configuracoes de organizacao permaneceram incompletas';
	END IF;
END
$$;

-- Preflight estrutural: falhar antes de instalar constraints/triggers e
-- apontar inconsistencias legadas, nunca corrigi-las por aproximacao.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM participants p
		GROUP BY p.financial_contact_id
		HAVING count(*) FILTER (WHERE p.financial_role = 'responsible'::financial_role) <> 1
	) THEN
		RAISE EXCEPTION 'CobraDora migration: contato financeiro sem exatamente um responsavel';
	END IF;

	IF EXISTS (
		SELECT 1 FROM participants p
		JOIN financial_contacts fc ON fc.id = p.financial_contact_id
		WHERE p.organization_id <> fc.organization_id
	) THEN
		RAISE EXCEPTION 'CobraDora migration: participante e contato financeiro pertencem a organizacoes diferentes';
	END IF;

	IF EXISTS (
		SELECT 1 FROM group_participants gp
		JOIN groups g ON g.id = gp.group_id
		JOIN participants p ON p.id = gp.participant_id
		WHERE g.organization_id <> p.organization_id
	) THEN
		RAISE EXCEPTION 'CobraDora migration: vinculo de grupo cruza organizacoes';
	END IF;

	IF EXISTS (
		SELECT 1 FROM charges c
		JOIN billing_periods bp ON bp.id = c.billing_period_id
		JOIN groups g ON g.id = bp.group_id
		JOIN participants p ON p.id = c.participant_id
		WHERE g.organization_id <> p.organization_id
			OR NOT EXISTS (
				SELECT 1 FROM group_participants gp
				WHERE gp.group_id = g.id AND gp.participant_id = p.id
			)
	) THEN
		RAISE EXCEPTION 'CobraDora migration: cobranca nao corresponde ao tenant/grupo do participante';
	END IF;

	IF EXISTS (
		SELECT 1 FROM checkout_sessions cs
		JOIN participants p ON p.id = cs.participant_id
		JOIN financial_contacts fc ON fc.id = cs.financial_contact_id
		LEFT JOIN gateway_accounts ga ON ga.id = cs.gateway_account_id
		WHERE cs.organization_id <> p.organization_id
			OR cs.organization_id <> fc.organization_id
			OR p.financial_contact_id <> cs.financial_contact_id
			OR p.financial_role <> 'responsible'::financial_role
			OR (cs.gateway_account_id IS NOT NULL AND (
				ga.id IS NULL OR ga.organization_id <> cs.organization_id OR ga.provider <> cs.gateway
			))
	) THEN
		RAISE EXCEPTION 'CobraDora migration: sessao de checkout cruza organizacao, participante, contato ou gateway';
	END IF;

	IF EXISTS (
		SELECT 1 FROM checkout_items ci
		JOIN checkout_sessions cs ON cs.id = ci.checkout_session_id
		JOIN charges c ON c.id = ci.charge_id
		JOIN billing_periods bp ON bp.id = c.billing_period_id
		JOIN groups g ON g.id = bp.group_id
		JOIN participants debtor ON debtor.id = c.participant_id
		WHERE cs.organization_id <> g.organization_id
			OR cs.financial_contact_id <> debtor.financial_contact_id
	) THEN
		RAISE EXCEPTION 'CobraDora migration: item de checkout cruza tenant ou contato financeiro';
	END IF;

	IF EXISTS (
		SELECT 1 FROM payments pay
		JOIN participants payer ON payer.id = pay.participant_id
		WHERE pay.organization_id <> payer.organization_id
	) THEN
		RAISE EXCEPTION 'CobraDora migration: pagamento cruza organizacao do participante';
	END IF;

	IF EXISTS (
		SELECT 1 FROM payment_allocations pa
		JOIN payments pay ON pay.id = pa.payment_id
		JOIN participants payer ON payer.id = pay.participant_id
		JOIN charges c ON c.id = pa.charge_id
		JOIN participants debtor ON debtor.id = c.participant_id
		JOIN billing_periods bp ON bp.id = c.billing_period_id
		JOIN groups g ON g.id = bp.group_id
		WHERE pay.organization_id <> g.organization_id
			OR payer.financial_contact_id <> debtor.financial_contact_id
	) THEN
		RAISE EXCEPTION 'CobraDora migration: alocacao cruza tenant ou contato financeiro';
	END IF;

	IF EXISTS (
		SELECT 1 FROM commissions c
		JOIN groups g ON g.id = c.group_id
		WHERE c.group_id IS NOT NULL AND c.organization_id <> g.organization_id
	) THEN
		RAISE EXCEPTION 'CobraDora migration: comissao cruza organizacao do grupo';
	END IF;
END $$;

DO $$
DECLARE
	column_definition record;
BEGIN
	FOR column_definition IN
		SELECT *
		FROM (
			VALUES
				('participants', 'financial_contact_id'),
				('participants', 'name_normalized'),
				('participants', 'financial_role'),
				('participants', 'created_at'),
				('group_participants', 'billing_starts_on'),
				('group_participants', 'participant_name_normalized'),
				('checkout_sessions', 'financial_contact_id')
		) AS definitions(table_name, column_name)
	LOOP
		IF NOT EXISTS (
			SELECT 1
			FROM pg_attribute a
			JOIN pg_class table_relation ON table_relation.oid = a.attrelid
			JOIN pg_namespace n ON n.oid = table_relation.relnamespace
			WHERE n.nspname = 'public'
				AND table_relation.relname::text = column_definition.table_name
				AND a.attname::text = column_definition.column_name
				AND a.attnotnull
				AND NOT a.attisdropped
		) THEN
			EXECUTE format(
				'ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL',
				column_definition.table_name,
				column_definition.column_name
			);
		END IF;
	END LOOP;
END
$$;

DO $$
DECLARE
	constraint_definition record;
BEGIN
	FOR constraint_definition IN
		SELECT *
		FROM (
			VALUES
				('financial_contacts_organization_id_organizations_id_fk', 'financial_contacts', 'ALTER TABLE public.financial_contacts ADD CONSTRAINT financial_contacts_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('organization_settings_organization_id_organizations_id_fk', 'organization_settings', 'ALTER TABLE public.organization_settings ADD CONSTRAINT organization_settings_organization_id_organizations_id_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('participants_financial_contact_id_financial_contacts_id_fk', 'participants', 'ALTER TABLE public.participants ADD CONSTRAINT participants_financial_contact_id_financial_contacts_id_fk FOREIGN KEY (financial_contact_id) REFERENCES public.financial_contacts(id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('checkout_sessions_financial_contact_id_financial_contacts_id_fk', 'checkout_sessions', 'ALTER TABLE public.checkout_sessions ADD CONSTRAINT checkout_sessions_financial_contact_id_financial_contacts_id_fk FOREIGN KEY (financial_contact_id) REFERENCES public.financial_contacts(id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('checkout_sessions_gateway_account_id_gateway_accounts_id_fk', 'checkout_sessions', 'ALTER TABLE public.checkout_sessions ADD CONSTRAINT checkout_sessions_gateway_account_id_gateway_accounts_id_fk FOREIGN KEY (gateway_account_id) REFERENCES public.gateway_accounts(id) ON DELETE NO ACTION ON UPDATE NO ACTION')
		) AS definitions(constraint_name, table_name, ddl)
	LOOP
		IF EXISTS (
			SELECT 1
			FROM pg_constraint c
			JOIN pg_namespace n ON n.oid = c.connamespace
			WHERE n.nspname = 'public'
				AND c.conname::text = constraint_definition.constraint_name
				AND c.conrelid IS DISTINCT FROM to_regclass('public.' || constraint_definition.table_name)
		) THEN
			RAISE EXCEPTION 'CobraDora recovery 0004: constraint % possui homonimo fora de public.%', constraint_definition.constraint_name, constraint_definition.table_name;
		ELSIF NOT EXISTS (
			SELECT 1
			FROM pg_constraint c
			WHERE c.conrelid = to_regclass('public.' || constraint_definition.table_name)
				AND c.conname::text = constraint_definition.constraint_name
		) THEN
			EXECUTE constraint_definition.ddl;
		END IF;
	END LOOP;
END
$$;

DROP INDEX IF EXISTS public.checkout_sessions_idempotency_unique;
CREATE UNIQUE INDEX IF NOT EXISTS checkout_sessions_organization_idempotency_unique ON public.checkout_sessions USING btree (organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS checkout_sessions_financial_contact_idx ON public.checkout_sessions USING btree (financial_contact_id);
CREATE INDEX IF NOT EXISTS checkout_sessions_request_fingerprint_idx ON public.checkout_sessions USING btree (organization_id, request_fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS financial_contacts_organization_phone_unique ON public.financial_contacts USING btree (organization_id, phone_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS financial_contacts_organization_id_id_unique ON public.financial_contacts USING btree (organization_id, id);
CREATE INDEX IF NOT EXISTS participants_financial_contact_idx ON public.participants USING btree (financial_contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS participants_organization_id_id_unique ON public.participants USING btree (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS participants_financial_contact_responsible_unique ON public.participants USING btree (financial_contact_id) WHERE financial_role = 'responsible';
CREATE UNIQUE INDEX IF NOT EXISTS group_participants_active_name_unique ON public.group_participants USING btree (group_id, participant_name_normalized) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS groups_organization_id_id_unique ON public.groups USING btree (organization_id, id);
CREATE INDEX IF NOT EXISTS groups_organization_status_idx ON public.groups USING btree (organization_id, status);

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM payment_allocations GROUP BY charge_id HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'CobraDora migration: existem cobrancas com mais de uma alocacao de pagamento';
	END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS gateway_accounts_organization_provider_unique ON public.gateway_accounts USING btree (organization_id, provider);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_accounts_organization_id_id_unique ON public.gateway_accounts USING btree (organization_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_allocations_charge_unique ON public.payment_allocations USING btree (charge_id);

DO $$
DECLARE
	constraint_definition record;
BEGIN
	FOR constraint_definition IN
		SELECT *
		FROM (
			VALUES
				('participants_organization_financial_contact_fk', 'participants', 'ALTER TABLE public.participants ADD CONSTRAINT participants_organization_financial_contact_fk FOREIGN KEY (organization_id, financial_contact_id) REFERENCES public.financial_contacts(organization_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('checkout_sessions_organization_participant_fk', 'checkout_sessions', 'ALTER TABLE public.checkout_sessions ADD CONSTRAINT checkout_sessions_organization_participant_fk FOREIGN KEY (organization_id, participant_id) REFERENCES public.participants(organization_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('checkout_sessions_organization_financial_contact_fk', 'checkout_sessions', 'ALTER TABLE public.checkout_sessions ADD CONSTRAINT checkout_sessions_organization_financial_contact_fk FOREIGN KEY (organization_id, financial_contact_id) REFERENCES public.financial_contacts(organization_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('checkout_sessions_organization_gateway_account_fk', 'checkout_sessions', 'ALTER TABLE public.checkout_sessions ADD CONSTRAINT checkout_sessions_organization_gateway_account_fk FOREIGN KEY (organization_id, gateway_account_id) REFERENCES public.gateway_accounts(organization_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('payments_organization_participant_fk', 'payments', 'ALTER TABLE public.payments ADD CONSTRAINT payments_organization_participant_fk FOREIGN KEY (organization_id, participant_id) REFERENCES public.participants(organization_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION'),
				('groups_billing_day_check', 'groups', 'ALTER TABLE public.groups ADD CONSTRAINT groups_billing_day_check CHECK (billing_day BETWEEN 1 AND 28)'),
				('groups_default_amount_check', 'groups', 'ALTER TABLE public.groups ADD CONSTRAINT groups_default_amount_check CHECK (default_amount > 0)'),
				('checkout_sessions_external_creation_state_check', 'checkout_sessions', 'ALTER TABLE public.checkout_sessions ADD CONSTRAINT checkout_sessions_external_creation_state_check CHECK (external_creation_state IN (''not_started'', ''in_flight'', ''ambiguous'', ''linked''))')
		) AS definitions(constraint_name, table_name, ddl)
	LOOP
		IF EXISTS (
			SELECT 1
			FROM pg_constraint c
			JOIN pg_namespace n ON n.oid = c.connamespace
			WHERE n.nspname = 'public'
				AND c.conname::text = constraint_definition.constraint_name
				AND c.conrelid IS DISTINCT FROM to_regclass('public.' || constraint_definition.table_name)
		) THEN
			RAISE EXCEPTION 'CobraDora recovery 0004: constraint % possui homonimo fora de public.%', constraint_definition.constraint_name, constraint_definition.table_name;
		ELSIF NOT EXISTS (
			SELECT 1
			FROM pg_constraint c
			WHERE c.conrelid = to_regclass('public.' || constraint_definition.table_name)
				AND c.conname::text = constraint_definition.constraint_name
		) THEN
			EXECUTE constraint_definition.ddl;
		END IF;
	END LOOP;
END
$$;

DO $$
BEGIN
	IF to_regclass('public.checkout_sessions_idempotency_unique') IS NOT NULL THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: indice global legado de idempotencia ainda existe';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM (
			VALUES
				('participants', 'financial_contact_id'),
				('participants', 'name_normalized'),
				('participants', 'financial_role'),
				('participants', 'created_at'),
				('group_participants', 'billing_starts_on'),
				('group_participants', 'participant_name_normalized'),
				('checkout_sessions', 'financial_contact_id')
		) AS expected(table_name, column_name)
		LEFT JOIN pg_namespace n ON n.nspname = 'public'
		LEFT JOIN pg_class table_relation
			ON table_relation.relnamespace = n.oid
			AND table_relation.relname::text = expected.table_name
		LEFT JOIN pg_attribute a
			ON a.attrelid = table_relation.oid
			AND a.attname::text = expected.column_name
			AND NOT a.attisdropped
		WHERE a.attnum IS NULL OR NOT a.attnotnull
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: reconciliacao terminou com coluna obrigatoria ainda anulavel';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM (
			VALUES
				('checkout_sessions_organization_idempotency_unique'),
				('checkout_sessions_financial_contact_idx'),
				('checkout_sessions_request_fingerprint_idx'),
				('financial_contacts_organization_phone_unique'),
				('financial_contacts_organization_id_id_unique'),
				('participants_financial_contact_idx'),
				('participants_organization_id_id_unique'),
				('participants_financial_contact_responsible_unique'),
				('group_participants_active_name_unique'),
				('groups_organization_id_id_unique'),
				('groups_organization_status_idx'),
				('gateway_accounts_organization_provider_unique'),
				('gateway_accounts_organization_id_id_unique'),
				('payment_allocations_charge_unique')
		) AS expected(index_name)
		WHERE NOT EXISTS (
			SELECT 1
			FROM pg_class index_relation
			JOIN pg_namespace n ON n.oid = index_relation.relnamespace
			JOIN pg_index i ON i.indexrelid = index_relation.oid
			WHERE n.nspname = 'public'
				AND index_relation.relname::text = expected.index_name
				AND index_relation.relkind = 'i'
				AND i.indisvalid
				AND i.indisready
		)
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: reconciliacao terminou com indice obrigatorio ausente';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM (
			VALUES
				('financial_contacts_organization_id_organizations_id_fk', 'financial_contacts'),
				('organization_settings_organization_id_organizations_id_fk', 'organization_settings'),
				('participants_financial_contact_id_financial_contacts_id_fk', 'participants'),
				('checkout_sessions_financial_contact_id_financial_contacts_id_fk', 'checkout_sessions'),
				('checkout_sessions_gateway_account_id_gateway_accounts_id_fk', 'checkout_sessions'),
				('participants_organization_financial_contact_fk', 'participants'),
				('checkout_sessions_organization_participant_fk', 'checkout_sessions'),
				('checkout_sessions_organization_financial_contact_fk', 'checkout_sessions'),
				('checkout_sessions_organization_gateway_account_fk', 'checkout_sessions'),
				('payments_organization_participant_fk', 'payments'),
				('groups_billing_day_check', 'groups'),
				('groups_default_amount_check', 'groups'),
				('checkout_sessions_external_creation_state_check', 'checkout_sessions')
		) AS expected(constraint_name, table_name)
		JOIN pg_constraint c ON c.conname::text = expected.constraint_name
		JOIN pg_namespace n ON n.oid = c.connamespace
		WHERE n.nspname = 'public'
			AND c.conrelid IS DISTINCT FROM to_regclass('public.' || expected.table_name)
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: reconciliacao terminou com homonimo de constraint em dominio ou tabela inesperada';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM (
			VALUES
				('financial_contacts_organization_id_organizations_id_fk', 'financial_contacts'),
				('organization_settings_organization_id_organizations_id_fk', 'organization_settings'),
				('participants_financial_contact_id_financial_contacts_id_fk', 'participants'),
				('checkout_sessions_financial_contact_id_financial_contacts_id_fk', 'checkout_sessions'),
				('checkout_sessions_gateway_account_id_gateway_accounts_id_fk', 'checkout_sessions'),
				('participants_organization_financial_contact_fk', 'participants'),
				('checkout_sessions_organization_participant_fk', 'checkout_sessions'),
				('checkout_sessions_organization_financial_contact_fk', 'checkout_sessions'),
				('checkout_sessions_organization_gateway_account_fk', 'checkout_sessions'),
				('payments_organization_participant_fk', 'payments'),
				('groups_billing_day_check', 'groups'),
				('groups_default_amount_check', 'groups'),
				('checkout_sessions_external_creation_state_check', 'checkout_sessions')
		) AS expected(constraint_name, table_name)
		WHERE NOT EXISTS (
			SELECT 1
			FROM pg_constraint c
			WHERE c.conrelid = to_regclass('public.' || expected.table_name)
				AND c.conname::text = expected.constraint_name
		)
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: reconciliacao terminou com constraint obrigatoria ausente';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM (
			VALUES
				('cobradora_enforce_participant_contact_organization'),
				('cobradora_sync_group_participant_name'),
				('cobradora_propagate_participant_name'),
				('cobradora_enforce_charge_tenant'),
				('cobradora_enforce_checkout_session_tenant'),
				('cobradora_enforce_checkout_item_tenant'),
				('cobradora_enforce_payment_tenant'),
				('cobradora_enforce_payment_allocation_tenant'),
				('cobradora_enforce_commission_tenant'),
				('cobradora_enforce_contact_responsible'),
				('cobradora_prevent_organization_reassignment')
		) AS expected(function_name)
		WHERE to_regprocedure('public.' || expected.function_name || '()') IS NULL
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: reconciliacao terminou com funcao obrigatoria ausente';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM (
			VALUES
				('participants_contact_organization_trigger'),
				('group_participants_name_sync_trigger'),
				('participants_name_propagation_trigger'),
				('charges_tenant_trigger'),
				('checkout_sessions_tenant_trigger'),
				('checkout_items_tenant_trigger'),
				('payments_tenant_trigger'),
				('payment_allocations_tenant_trigger'),
				('commissions_tenant_trigger'),
				('participants_contact_responsible_constraint_trigger'),
				('groups_organization_immutable_trigger'),
				('financial_contacts_organization_immutable_trigger'),
				('participants_organization_immutable_trigger'),
				('gateway_accounts_organization_immutable_trigger'),
				('checkout_sessions_organization_immutable_trigger'),
				('payments_organization_immutable_trigger'),
				('commissions_organization_immutable_trigger')
		) AS expected(trigger_name)
		WHERE NOT EXISTS (
			SELECT 1
			FROM pg_trigger t
			JOIN pg_class table_relation ON table_relation.oid = t.tgrelid
			JOIN pg_namespace n ON n.oid = table_relation.relnamespace
			WHERE n.nspname = 'public'
				AND t.tgname::text = expected.trigger_name
				AND NOT t.tgisinternal
		)
	) THEN
		RAISE EXCEPTION 'CobraDora recovery 0004: reconciliacao terminou com trigger obrigatorio ausente';
	END IF;
END
$$;

COMMIT;
