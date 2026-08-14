CREATE TYPE "public"."financial_role" AS ENUM('responsible', 'dependent');--> statement-breakpoint
CREATE TABLE "financial_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_normalized" varchar(14) NOT NULL,
	"phone_display" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_contacts_phone_check" CHECK ("phone_normalized" ~ '^\+55[1-9][0-9]9[0-9]{8}$')
);--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"message_intro" varchar(1000) DEFAULT '' NOT NULL,
	"message_outro" varchar(1000) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- O modelo antigo aceitava qualquer sequencia de digitos. A migration para
-- explicitamente se encontrar um telefone que nao possa ser convertido em
-- celular brasileiro, evitando associar devedores ao contato errado.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM participants p
		CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(p.phone_normalized, ''), '[^0-9]', '', 'g') AS digits) d
		WHERE d.digits !~ '^55[1-9][0-9]9[0-9]{8}$'
		  AND d.digits !~ '^[1-9][0-9]9[0-9]{8}$'
	) THEN
		RAISE EXCEPTION 'CobraDora migration: existem telefones legados invalidos; corrija-os antes de continuar';
	END IF;
END $$;--> statement-breakpoint

-- Cadastros legados podiam conter apenas espacos. Como nao existe um nome
-- original para recuperar, preservamos o participante com um placeholder
-- explicito e unico; o administrador pode renomea-lo depois pela interface.
UPDATE participants
SET name = 'Participante ' || id::text
WHERE trim(regexp_replace(
	translate(lower(coalesce(name, '')),
		'áàâãäéèêëíìîïóòôõöúùûüçñ',
		'aaaaaeeeeiiiiooooouuuucn'),
	'[[:space:]]+', ' ', 'g'
)) = '';--> statement-breakpoint

ALTER TABLE "participants" ALTER COLUMN "phone_normalized" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "phone_display" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "financial_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "name_normalized" varchar(200);--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "financial_role" "financial_role";--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "group_participants" ADD COLUMN "billing_starts_on" date;--> statement-breakpoint
ALTER TABLE "group_participants" ADD COLUMN "participant_name_normalized" varchar(200);--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "financial_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "gateway_account_id" uuid;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "gateway_external_account_id_snapshot" varchar(200);--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "gateway_payment_id" varchar(200);--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "gateway_invoice_slug" varchar(200);--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "recovery_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "external_creation_state" varchar(24) DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "external_request_started_at" timestamp with time zone;--> statement-breakpoint

-- Nunca presumir que uma sessao legada created/pending ainda nao chamou o
-- provedor: sem evidencia local, o estado seguro e exigir reconciliacao.
UPDATE checkout_sessions
SET external_creation_state = CASE
		WHEN checkout_url IS NOT NULL OR gateway_checkout_id IS NOT NULL OR status = 'completed' THEN 'linked'
		WHEN status IN ('created', 'pending') THEN 'ambiguous'
		ELSE 'not_started'
	END,
	external_request_started_at = CASE
		WHEN checkout_url IS NOT NULL
			OR gateway_checkout_id IS NOT NULL
			OR status IN ('created', 'pending', 'completed')
			THEN created_at
		ELSE NULL
	END;--> statement-breakpoint

WITH normalized_phones AS (
	SELECT
		p.id,
		p.organization_id,
		CASE
			WHEN d.digits ~ '^55[1-9][0-9]9[0-9]{8}$' THEN '+' || d.digits
			ELSE '+55' || d.digits
		END AS phone_normalized,
		min(gp.joined_at) AS first_joined_at
	FROM participants p
	LEFT JOIN group_participants gp ON gp.participant_id = p.id
	CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(p.phone_normalized, ''), '[^0-9]', '', 'g') AS digits) d
	GROUP BY p.id, p.organization_id, d.digits
), ranked AS (
	SELECT *, row_number() OVER (
		PARTITION BY organization_id, phone_normalized
		ORDER BY first_joined_at NULLS LAST, id
	) AS contact_rank
	FROM normalized_phones
)
INSERT INTO financial_contacts (organization_id, phone_normalized, phone_display, created_at, updated_at)
SELECT
	organization_id,
	phone_normalized,
	format('(%s) %s-%s', substr(phone_normalized, 4, 2), substr(phone_normalized, 6, 5), substr(phone_normalized, 11, 4)),
	coalesce(first_joined_at, now()),
	now()
FROM ranked
WHERE contact_rank = 1;--> statement-breakpoint

WITH participant_data AS (
	SELECT
		p.id,
		fc.id AS financial_contact_id,
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
		AND fc.phone_normalized = CASE
			WHEN regexp_replace(coalesce(p.phone_normalized, ''), '[^0-9]', '', 'g') ~ '^55[1-9][0-9]9[0-9]{8}$'
				THEN '+' || regexp_replace(p.phone_normalized, '[^0-9]', '', 'g')
			ELSE '+55' || regexp_replace(p.phone_normalized, '[^0-9]', '', 'g')
		END
	LEFT JOIN group_participants gp ON gp.participant_id = p.id
	GROUP BY p.id, fc.id
), ranked AS (
	SELECT *, row_number() OVER (
		PARTITION BY financial_contact_id
		ORDER BY first_joined_at NULLS LAST, id
	) AS responsibility_rank
	FROM participant_data
)
UPDATE participants p
SET financial_contact_id = ranked.financial_contact_id,
	name_normalized = ranked.name_normalized,
	financial_role = CASE WHEN ranked.responsibility_rank = 1 THEN 'responsible'::financial_role ELSE 'dependent'::financial_role END,
	created_at = coalesce(ranked.first_joined_at, now())
FROM ranked
WHERE ranked.id = p.id;--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM participants WHERE name_normalized = '') THEN
		RAISE EXCEPTION 'CobraDora migration: existem participantes com nome vazio; corrija-os antes de continuar';
	END IF;
END $$;--> statement-breakpoint

UPDATE group_participants gp
SET participant_name_normalized = p.name_normalized,
	billing_starts_on = CASE
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
FROM participants p, groups g
WHERE p.id = gp.participant_id AND g.id = gp.group_id;--> statement-breakpoint

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
END $$;--> statement-breakpoint

UPDATE checkout_sessions cs
SET participant_id = responsible.id,
	financial_contact_id = responsible.financial_contact_id
FROM participants current_participant
JOIN participants responsible
	ON responsible.financial_contact_id = current_participant.financial_contact_id
	AND responsible.financial_role = 'responsible'::financial_role
WHERE current_participant.id = cs.participant_id;--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM gateway_accounts GROUP BY organization_id, provider HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'CobraDora migration: existem contas de gateway duplicadas por organizacao/provider';
	END IF;
END $$;--> statement-breakpoint

-- Sessoes legadas podem nao ter conta configurada. Nesse caso os campos de
-- snapshot permanecem nulos e o fluxo de recuperacao exige nova configuracao,
-- em vez de inventar uma associacao entre tenants.
UPDATE checkout_sessions cs
SET gateway_account_id = ga.id,
	gateway_external_account_id_snapshot = ga.external_account_id
FROM gateway_accounts ga
WHERE ga.organization_id = cs.organization_id
	AND ga.provider = cs.gateway;--> statement-breakpoint

INSERT INTO organization_settings (organization_id)
SELECT id FROM organizations
ON CONFLICT (organization_id) DO NOTHING;--> statement-breakpoint

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
END $$;--> statement-breakpoint

ALTER TABLE "participants" ALTER COLUMN "financial_contact_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "name_normalized" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "financial_role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "participants" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "group_participants" ALTER COLUMN "billing_starts_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "group_participants" ALTER COLUMN "participant_name_normalized" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ALTER COLUMN "financial_contact_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "financial_contacts" ADD CONSTRAINT "financial_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_financial_contact_id_financial_contacts_id_fk" FOREIGN KEY ("financial_contact_id") REFERENCES "public"."financial_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_financial_contact_id_financial_contacts_id_fk" FOREIGN KEY ("financial_contact_id") REFERENCES "public"."financial_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_gateway_account_id_gateway_accounts_id_fk" FOREIGN KEY ("gateway_account_id") REFERENCES "public"."gateway_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

DROP INDEX "checkout_sessions_idempotency_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_sessions_organization_idempotency_unique" ON "checkout_sessions" USING btree ("organization_id", "idempotency_key");--> statement-breakpoint
CREATE INDEX "checkout_sessions_financial_contact_idx" ON "checkout_sessions" USING btree ("financial_contact_id");--> statement-breakpoint
CREATE INDEX "checkout_sessions_request_fingerprint_idx" ON "checkout_sessions" USING btree ("organization_id", "request_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_contacts_organization_phone_unique" ON "financial_contacts" USING btree ("organization_id", "phone_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_contacts_organization_id_id_unique" ON "financial_contacts" USING btree ("organization_id", "id");--> statement-breakpoint
CREATE INDEX "participants_financial_contact_idx" ON "participants" USING btree ("financial_contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_organization_id_id_unique" ON "participants" USING btree ("organization_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_financial_contact_responsible_unique" ON "participants" USING btree ("financial_contact_id") WHERE "financial_role" = 'responsible';--> statement-breakpoint
CREATE UNIQUE INDEX "group_participants_active_name_unique" ON "group_participants" USING btree ("group_id", "participant_name_normalized") WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "groups_organization_id_id_unique" ON "groups" USING btree ("organization_id", "id");--> statement-breakpoint
CREATE INDEX "groups_organization_status_idx" ON "groups" USING btree ("organization_id", "status");--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM payment_allocations GROUP BY charge_id HAVING count(*) > 1) THEN
		RAISE EXCEPTION 'CobraDora migration: existem cobrancas com mais de uma alocacao de pagamento';
	END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "gateway_accounts_organization_provider_unique" ON "gateway_accounts" USING btree ("organization_id", "provider");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_accounts_organization_id_id_unique" ON "gateway_accounts" USING btree ("organization_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_charge_unique" ON "payment_allocations" USING btree ("charge_id");--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_organization_financial_contact_fk" FOREIGN KEY ("organization_id", "financial_contact_id") REFERENCES "public"."financial_contacts"("organization_id", "id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_organization_participant_fk" FOREIGN KEY ("organization_id", "participant_id") REFERENCES "public"."participants"("organization_id", "id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_organization_financial_contact_fk" FOREIGN KEY ("organization_id", "financial_contact_id") REFERENCES "public"."financial_contacts"("organization_id", "id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_organization_gateway_account_fk" FOREIGN KEY ("organization_id", "gateway_account_id") REFERENCES "public"."gateway_accounts"("organization_id", "id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_participant_fk" FOREIGN KEY ("organization_id", "participant_id") REFERENCES "public"."participants"("organization_id", "id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_billing_day_check" CHECK ("billing_day" between 1 and 28);--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_default_amount_check" CHECK ("default_amount" > 0);--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_external_creation_state_check" CHECK ("external_creation_state" in ('not_started', 'in_flight', 'ambiguous', 'linked'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_participant_contact_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM financial_contacts fc
		WHERE fc.id = NEW.financial_contact_id AND fc.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'financial contact and participant must belong to the same organization';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER participants_contact_organization_trigger
BEFORE INSERT OR UPDATE OF financial_contact_id, organization_id ON participants
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_participant_contact_organization();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_sync_group_participant_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	participant_organization_id uuid;
	group_organization_id uuid;
BEGIN
	SELECT p.name_normalized, p.organization_id
	INTO NEW.participant_name_normalized, participant_organization_id
	FROM participants p
	WHERE p.id = NEW.participant_id;

	SELECT g.organization_id INTO group_organization_id
	FROM groups g
	WHERE g.id = NEW.group_id;

	IF participant_organization_id IS NULL
		OR group_organization_id IS NULL
		OR participant_organization_id <> group_organization_id THEN
		RAISE EXCEPTION 'group participant must belong to the group organization';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER group_participants_name_sync_trigger
BEFORE INSERT OR UPDATE OF group_id, participant_id ON group_participants
FOR EACH ROW EXECUTE FUNCTION cobradora_sync_group_participant_name();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_propagate_participant_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.name_normalized IS DISTINCT FROM OLD.name_normalized THEN
		UPDATE group_participants
		SET participant_name_normalized = NEW.name_normalized
		WHERE participant_id = NEW.id AND status = 'active';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER participants_name_propagation_trigger
AFTER UPDATE OF name_normalized ON participants
FOR EACH ROW EXECUTE FUNCTION cobradora_propagate_participant_name();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_charge_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	charge_organization_id uuid;
	participant_organization_id uuid;
	charge_group_id uuid;
BEGIN
	SELECT g.organization_id, g.id
	INTO charge_organization_id, charge_group_id
	FROM billing_periods bp
	JOIN groups g ON g.id = bp.group_id
	WHERE bp.id = NEW.billing_period_id;

	SELECT p.organization_id INTO participant_organization_id
	FROM participants p
	WHERE p.id = NEW.participant_id;

	IF charge_organization_id IS NULL
		OR participant_organization_id IS NULL
		OR charge_organization_id <> participant_organization_id
		OR NOT EXISTS (
			SELECT 1 FROM group_participants gp
			WHERE gp.group_id = charge_group_id AND gp.participant_id = NEW.participant_id
		) THEN
		RAISE EXCEPTION 'charge must belong to the participant organization and group';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER charges_tenant_trigger
BEFORE INSERT OR UPDATE OF billing_period_id, participant_id ON charges
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_charge_tenant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_checkout_session_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	participant_organization_id uuid;
	participant_contact_id uuid;
	participant_financial_role financial_role;
	contact_organization_id uuid;
	gateway_organization_id uuid;
	gateway_provider varchar(40);
BEGIN
	SELECT p.organization_id, p.financial_contact_id, p.financial_role
	INTO participant_organization_id, participant_contact_id, participant_financial_role
	FROM participants p
	WHERE p.id = NEW.participant_id;

	SELECT fc.organization_id INTO contact_organization_id
	FROM financial_contacts fc
	WHERE fc.id = NEW.financial_contact_id;

	IF NEW.gateway_account_id IS NOT NULL THEN
		SELECT ga.organization_id, ga.provider
		INTO gateway_organization_id, gateway_provider
		FROM gateway_accounts ga
		WHERE ga.id = NEW.gateway_account_id;
	END IF;

	IF participant_organization_id IS NULL
		OR contact_organization_id IS NULL
		OR participant_organization_id <> NEW.organization_id
		OR contact_organization_id <> NEW.organization_id
		OR participant_contact_id <> NEW.financial_contact_id
		OR participant_financial_role <> 'responsible'::financial_role
		OR (NEW.gateway_account_id IS NOT NULL AND (
			gateway_organization_id IS NULL
			OR gateway_organization_id <> NEW.organization_id
			OR gateway_provider <> NEW.gateway
		)) THEN
		RAISE EXCEPTION 'checkout session must use the responsible participant, contact and gateway from its organization';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER checkout_sessions_tenant_trigger
BEFORE INSERT OR UPDATE OF organization_id, participant_id, financial_contact_id, gateway_account_id, gateway ON checkout_sessions
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_checkout_session_tenant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_checkout_item_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	session_organization_id uuid;
	session_contact_id uuid;
	charge_organization_id uuid;
	debtor_contact_id uuid;
BEGIN
	SELECT cs.organization_id, cs.financial_contact_id
	INTO session_organization_id, session_contact_id
	FROM checkout_sessions cs
	WHERE cs.id = NEW.checkout_session_id;

	SELECT g.organization_id, p.financial_contact_id
	INTO charge_organization_id, debtor_contact_id
	FROM charges c
	JOIN billing_periods bp ON bp.id = c.billing_period_id
	JOIN groups g ON g.id = bp.group_id
	JOIN participants p ON p.id = c.participant_id
	WHERE c.id = NEW.charge_id;

	IF session_organization_id IS NULL
		OR charge_organization_id IS NULL
		OR session_organization_id <> charge_organization_id
		OR session_contact_id <> debtor_contact_id THEN
		RAISE EXCEPTION 'checkout item must belong to the session tenant and financial contact';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER checkout_items_tenant_trigger
BEFORE INSERT OR UPDATE OF checkout_session_id, charge_id ON checkout_items
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_checkout_item_tenant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_payment_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM participants p
		WHERE p.id = NEW.participant_id AND p.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'payment participant must belong to the payment organization';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER payments_tenant_trigger
BEFORE INSERT OR UPDATE OF organization_id, participant_id ON payments
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_payment_tenant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_payment_allocation_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	payment_organization_id uuid;
	payer_contact_id uuid;
	charge_organization_id uuid;
	debtor_contact_id uuid;
BEGIN
	SELECT pay.organization_id, payer.financial_contact_id
	INTO payment_organization_id, payer_contact_id
	FROM payments pay
	JOIN participants payer ON payer.id = pay.participant_id
	WHERE pay.id = NEW.payment_id;

	SELECT g.organization_id, debtor.financial_contact_id
	INTO charge_organization_id, debtor_contact_id
	FROM charges c
	JOIN participants debtor ON debtor.id = c.participant_id
	JOIN billing_periods bp ON bp.id = c.billing_period_id
	JOIN groups g ON g.id = bp.group_id
	WHERE c.id = NEW.charge_id;

	IF payment_organization_id IS NULL
		OR charge_organization_id IS NULL
		OR payment_organization_id <> charge_organization_id
		OR payer_contact_id <> debtor_contact_id THEN
		RAISE EXCEPTION 'payment allocation must stay inside one tenant and financial contact';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER payment_allocations_tenant_trigger
BEFORE INSERT OR UPDATE OF payment_id, charge_id ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_payment_allocation_tenant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_commission_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.group_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM groups g
		WHERE g.id = NEW.group_id AND g.organization_id = NEW.organization_id
	) THEN
		RAISE EXCEPTION 'commission group must belong to the commission organization';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER commissions_tenant_trigger
BEFORE INSERT OR UPDATE OF organization_id, group_id ON commissions
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_commission_tenant();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_enforce_contact_responsible()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	contact_id uuid;
BEGIN
	FOR contact_id IN
		SELECT DISTINCT candidate
		FROM unnest(ARRAY[
			CASE WHEN TG_OP <> 'INSERT' THEN OLD.financial_contact_id ELSE NULL END,
			CASE WHEN TG_OP <> 'DELETE' THEN NEW.financial_contact_id ELSE NULL END
		]) AS candidate
		WHERE candidate IS NOT NULL
	LOOP
		IF EXISTS (SELECT 1 FROM participants p WHERE p.financial_contact_id = contact_id)
			AND NOT EXISTS (
				SELECT 1 FROM participants p
				WHERE p.financial_contact_id = contact_id
					AND p.financial_role = 'responsible'::financial_role
			) THEN
			RAISE EXCEPTION 'financial contact with participants must have one responsible participant';
		END IF;
	END LOOP;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER participants_contact_responsible_constraint_trigger
AFTER INSERT OR UPDATE OR DELETE ON participants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cobradora_enforce_contact_responsible();--> statement-breakpoint

CREATE OR REPLACE FUNCTION cobradora_prevent_organization_reassignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
		RAISE EXCEPTION 'organization ownership is immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER groups_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON groups
FOR EACH ROW EXECUTE FUNCTION cobradora_prevent_organization_reassignment();--> statement-breakpoint
CREATE TRIGGER financial_contacts_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON financial_contacts
FOR EACH ROW EXECUTE FUNCTION cobradora_prevent_organization_reassignment();--> statement-breakpoint
CREATE TRIGGER participants_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON participants
FOR EACH ROW EXECUTE FUNCTION cobradora_prevent_organization_reassignment();--> statement-breakpoint
CREATE TRIGGER gateway_accounts_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON gateway_accounts
FOR EACH ROW EXECUTE FUNCTION cobradora_prevent_organization_reassignment();--> statement-breakpoint
CREATE TRIGGER checkout_sessions_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON checkout_sessions
FOR EACH ROW EXECUTE FUNCTION cobradora_prevent_organization_reassignment();--> statement-breakpoint
CREATE TRIGGER payments_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON payments
FOR EACH ROW EXECUTE FUNCTION cobradora_prevent_organization_reassignment();--> statement-breakpoint
CREATE TRIGGER commissions_organization_immutable_trigger
BEFORE UPDATE OF organization_id ON commissions
FOR EACH ROW EXECUTE FUNCTION cobradora_prevent_organization_reassignment();
