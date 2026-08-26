-- COBRADORA - RETOMADA DA 0013 (execucao parcial anterior)
--
-- Diagnostico confirmado por supabase/recovery/inspect_0011_0013_state.sql:
-- a 0013 foi executada fora de ordem (antes da 0012) e parou logo apos
-- derrubar a FK simples do financial_contact_id, sem criar a FK composta,
-- os 2 indices novos, o check kind_contact_check, a funcao/trigger de tenant
-- e sem revogar os grants de anon/authenticated.
--
-- PRE-REQUISITO: rode a 0012 (drizzle/0012_wandering_blink.sql) ANTES deste
-- script. Este script recusa rodar (RAISE EXCEPTION) se o enum ainda nao
-- tiver o valor 'organizer_cycle_start'.
--
-- Este script e reentrante: cada etapa confere se o objeto ja existe antes
-- de criar, entao pode ser executado novamente sem efeito duplicado caso
-- falhe no meio. Roda tudo dentro de uma unica transacao.

BEGIN;

-- Preflight identico ao da 0013 original: garante integridade multi-tenant
-- antes de qualquer alteracao de schema.
DO $preflight$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "public"."whatsapp_notifications" notification
		WHERE notification."financial_contact_id" IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "public"."financial_contacts" contact
			WHERE contact."id" = notification."financial_contact_id"
			AND contact."organization_id" = notification."organization_id"
		)
	) THEN
		RAISE EXCEPTION 'CobraDora migration: notificacao WhatsApp cruza tenant do contato financeiro'
			USING ERRCODE = '23514';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "public"."whatsapp_notifications" notification
		WHERE NOT EXISTS (
			SELECT 1
			FROM "public"."billing_periods" period
			JOIN "public"."groups" target_group ON target_group."id" = period."group_id"
			WHERE period."id" = notification."billing_period_id"
			AND target_group."organization_id" = notification."organization_id"
		)
	) THEN
		RAISE EXCEPTION 'CobraDora migration: notificacao WhatsApp cruza tenant do ciclo de cobranca'
			USING ERRCODE = '23514';
	END IF;
END
$preflight$;

-- Trava de pre-requisito: nao prossiga sem a 0012 aplicada.
DO $require_0012$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_catalog.pg_enum e
		JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
		JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
		WHERE n.nspname = 'public' AND t.typname = 'whatsapp_notification_kind' AND e.enumlabel = 'organizer_cycle_start'
	) THEN
		RAISE EXCEPTION 'Rode a 0012 (ALTER TYPE whatsapp_notification_kind ADD VALUE organizer_cycle_start) antes deste script de retomada da 0013';
	END IF;
END
$require_0012$;

-- Passo 1: FK simples do financial_contact_id — so derruba se ainda existir
-- (na execucao anterior ja foi derrubada; aqui fica reentrante).
DO $drop_old_fk$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_catalog.pg_constraint
		WHERE conrelid = 'public.whatsapp_notifications'::regclass
			AND conname = 'whatsapp_notifications_financial_contact_id_financial_contacts_id_fk'
	) THEN
		ALTER TABLE "whatsapp_notifications" DROP CONSTRAINT "whatsapp_notifications_financial_contact_id_financial_contacts_id_fk";
	END IF;
END
$drop_old_fk$;

-- Passo 2: FK composta nova — e a que faltou criar na execucao anterior.
DO $add_new_fk$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_constraint
		WHERE conrelid = 'public.whatsapp_notifications'::regclass
			AND conname = 'whatsapp_notifications_org_contact_fk'
	) THEN
		ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_org_contact_fk"
			FOREIGN KEY ("organization_id","financial_contact_id")
			REFERENCES "public"."financial_contacts"("organization_id","id")
			ON DELETE no action ON UPDATE no action;
	END IF;
END
$add_new_fk$;

-- Passo 3: indices que faltaram.
CREATE INDEX IF NOT EXISTS "whatsapp_notifications_billing_period_idx" ON "whatsapp_notifications" USING btree ("billing_period_id");
CREATE INDEX IF NOT EXISTS "whatsapp_notifications_financial_contact_idx" ON "whatsapp_notifications" USING btree ("financial_contact_id");

-- Passo 4: check kind/contato — so agora e seguro, com o enum ja completo
-- (garantido pela trava require_0012 acima).
DO $add_check$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_catalog.pg_constraint
		WHERE conrelid = 'public.whatsapp_notifications'::regclass
			AND conname = 'whatsapp_notifications_kind_contact_check'
	) THEN
		ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_kind_contact_check"
			CHECK (
				("whatsapp_notifications"."kind" = 'charge_reminder' and "whatsapp_notifications"."financial_contact_id" is not null)
				or ("whatsapp_notifications"."kind" in ('organizer_cycle_start', 'organizer_list_update') and "whatsapp_notifications"."financial_contact_id" is null)
			);
	END IF;
END
$add_check$;

-- Passo 5: funcao e trigger de integridade de tenant.
CREATE OR REPLACE FUNCTION "public"."cobradora_enforce_whatsapp_notification_tenant"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
	PERFORM 1
	FROM "public"."billing_periods" period
	JOIN "public"."groups" target_group ON target_group."id" = period."group_id"
	WHERE period."id" = NEW."billing_period_id"
	AND target_group."organization_id" = NEW."organization_id"
	FOR SHARE OF period;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'whatsapp notification must belong to the billing period tenant'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "whatsapp_notifications_tenant_trigger" ON "public"."whatsapp_notifications";
CREATE TRIGGER "whatsapp_notifications_tenant_trigger"
BEFORE INSERT OR UPDATE OF "organization_id", "billing_period_id"
ON "public"."whatsapp_notifications"
FOR EACH ROW
EXECUTE FUNCTION "public"."cobradora_enforce_whatsapp_notification_tenant"();

-- Passo 6: revogar privilegios de PUBLIC/anon/authenticated (REVOKE de algo
-- que ja nao tem privilegio e um no-op seguro em Postgres).
REVOKE ALL PRIVILEGES ON TABLE "public"."whatsapp_notifications" FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."cobradora_enforce_whatsapp_notification_tenant"() FROM PUBLIC;

DO $security$
DECLARE
	target_role name;
BEGIN
	FOR target_role IN
		SELECT role.rolname
		FROM pg_catalog.pg_roles role
		WHERE role.rolname IN ('anon', 'authenticated')
	LOOP
		EXECUTE pg_catalog.format(
			'REVOKE ALL PRIVILEGES ON TABLE public.whatsapp_notifications FROM %I',
			target_role
		);
		EXECUTE pg_catalog.format(
			'REVOKE EXECUTE ON FUNCTION public.cobradora_enforce_whatsapp_notification_tenant() FROM %I',
			target_role
		);
	END LOOP;
END
$security$;

COMMIT;
