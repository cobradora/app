BEGIN;--> statement-breakpoint
ALTER TABLE "public"."group_participants" ADD COLUMN IF NOT EXISTS "billing_amount" integer;--> statement-breakpoint
DO $$
DECLARE
	existing_column_type text;
	existing_column_generated text;
	existing_column_identity text;
	existing_column_has_default boolean;
BEGIN
	FOR
		existing_column_type,
		existing_column_generated,
		existing_column_identity,
		existing_column_has_default
	IN
		SELECT
			format_type(a.atttypid, a.atttypmod),
			a.attgenerated::text,
			a.attidentity::text,
			a.atthasdef
		FROM pg_attribute a
		WHERE a.attrelid = 'public.group_participants'::regclass
			AND a.attname = 'billing_amount'
			AND NOT a.attisdropped
	LOOP
		NULL;
	END LOOP;

	IF existing_column_type IS DISTINCT FROM 'integer'
		OR existing_column_generated IS DISTINCT FROM ''
		OR existing_column_identity IS DISTINCT FROM ''
		OR existing_column_has_default IS DISTINCT FROM false THEN
		RAISE EXCEPTION 'CobraDora migration 0005: coluna group_participants.billing_amount possui definicao incompativel (tipo=%, gerada=%, identidade=%, possui_default=%); esperado integer comum sem default',
			coalesce(existing_column_type, '<ausente>'),
			coalesce(existing_column_generated, '<ausente>'),
			coalesce(existing_column_identity, '<ausente>'),
			coalesce(existing_column_has_default::text, '<ausente>');
	END IF;
END $$;--> statement-breakpoint
UPDATE "public"."group_participants" gp
SET "billing_amount" = g."default_amount"
FROM "public"."groups" g
WHERE g."id" = gp."group_id"
	AND gp."billing_amount" IS NULL;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "public"."group_participants"
		WHERE "billing_amount" IS NULL
			OR "billing_amount" < 1
			OR "billing_amount" > 100000000
	) THEN
		RAISE EXCEPTION 'CobraDora migration: existem valores de cobrança de participante nulos ou fora do intervalo permitido (1 a 100000000 centavos)';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "public"."group_participants" ALTER COLUMN "billing_amount" SET NOT NULL;--> statement-breakpoint
DO $$
DECLARE
	existing_constraint_oid oid;
	existing_constraint_type text;
	existing_constraint_validated boolean;
	existing_constraint_expression text;
	normalized_constraint_expression text;
BEGIN
	FOR
		existing_constraint_oid,
		existing_constraint_type,
		existing_constraint_validated,
		existing_constraint_expression
	IN
		SELECT
			c.oid,
			c.contype::text,
			c.convalidated,
			pg_get_expr(c.conbin, c.conrelid, true)
		FROM pg_constraint c
		WHERE c.conrelid = 'public.group_participants'::regclass
			AND c.conname = 'group_participants_billing_amount_check'
	LOOP
		NULL;
	END LOOP;

	IF existing_constraint_oid IS NULL THEN
		ALTER TABLE "public"."group_participants"
			ADD CONSTRAINT "group_participants_billing_amount_check"
			CHECK ("billing_amount" between 1 and 100000000);
	ELSE
		normalized_constraint_expression := lower(existing_constraint_expression);
		normalized_constraint_expression := regexp_replace(normalized_constraint_expression, '[[:space:]()"]', '', 'g');
		normalized_constraint_expression := replace(normalized_constraint_expression, 'public.', '');
		normalized_constraint_expression := replace(normalized_constraint_expression, 'group_participants.', '');
		normalized_constraint_expression := replace(normalized_constraint_expression, '::integer', '');
		normalized_constraint_expression := replace(normalized_constraint_expression, '::int4', '');

		IF existing_constraint_type IS DISTINCT FROM 'c'
			OR (
				normalized_constraint_expression IS DISTINCT FROM 'billing_amount>=1andbilling_amount<=100000000'
				AND normalized_constraint_expression IS DISTINCT FROM 'billing_amountbetween1and100000000'
			) THEN
			RAISE EXCEPTION 'CobraDora migration 0005: constraint group_participants_billing_amount_check ja existe com definicao incompativel: %',
				pg_get_constraintdef(existing_constraint_oid, true);
		END IF;

		IF NOT existing_constraint_validated THEN
			ALTER TABLE "public"."group_participants"
				VALIDATE CONSTRAINT "group_participants_billing_amount_check";
		END IF;
	END IF;
END $$;--> statement-breakpoint
COMMIT;
