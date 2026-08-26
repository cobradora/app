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

	IF EXISTS (
		SELECT 1
		FROM "public"."whatsapp_notifications" notification
		WHERE (notification."kind" = 'charge_reminder' AND notification."financial_contact_id" IS NULL)
		OR (notification."kind" IN ('organizer_cycle_start', 'organizer_list_update') AND notification."financial_contact_id" IS NOT NULL)
	) THEN
		RAISE EXCEPTION 'CobraDora migration: tipo da notificacao WhatsApp incompativel com contato financeiro'
			USING ERRCODE = '23514';
	END IF;
END
$preflight$;
--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" DROP CONSTRAINT "whatsapp_notifications_financial_contact_id_financial_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_org_contact_fk" FOREIGN KEY ("organization_id","financial_contact_id") REFERENCES "public"."financial_contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_notifications_billing_period_idx" ON "whatsapp_notifications" USING btree ("billing_period_id");--> statement-breakpoint
CREATE INDEX "whatsapp_notifications_financial_contact_idx" ON "whatsapp_notifications" USING btree ("financial_contact_id");--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_kind_contact_check" CHECK (("whatsapp_notifications"."kind" = 'charge_reminder' and "whatsapp_notifications"."financial_contact_id" is not null) or ("whatsapp_notifications"."kind" in ('organizer_cycle_start', 'organizer_list_update') and "whatsapp_notifications"."financial_contact_id" is null));
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TRIGGER "whatsapp_notifications_tenant_trigger"
BEFORE INSERT OR UPDATE OF "organization_id", "billing_period_id"
ON "public"."whatsapp_notifications"
FOR EACH ROW
EXECUTE FUNCTION "public"."cobradora_enforce_whatsapp_notification_tenant"();
--> statement-breakpoint
-- The application uses a direct node-postgres pool rather than Supabase's
-- anon/authenticated Data API roles. Keep owner and explicit private grants
-- working while making this sensitive outbox unavailable through that API.
REVOKE ALL PRIVILEGES ON TABLE "public"."whatsapp_notifications" FROM PUBLIC;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "public"."cobradora_enforce_whatsapp_notification_tenant"() FROM PUBLIC;
--> statement-breakpoint
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
