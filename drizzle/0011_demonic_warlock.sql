CREATE TYPE "public"."billing_module" AS ENUM('dora', 'cobradora');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_delivery_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_notification_kind" AS ENUM('charge_reminder', 'organizer_list_update');--> statement-breakpoint
CREATE TABLE "whatsapp_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"billing_period_id" uuid NOT NULL,
	"financial_contact_id" uuid,
	"kind" "whatsapp_notification_kind" NOT NULL,
	"status" "whatsapp_delivery_status" DEFAULT 'queued' NOT NULL,
	"recipient_phone_normalized" varchar(14) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"meta_message_id" varchar(200),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_notifications_recipient_phone_check" CHECK ("whatsapp_notifications"."recipient_phone_normalized" ~ '^\+55[1-9][0-9]9[0-9]{8}$'),
	CONSTRAINT "whatsapp_notifications_attempt_count_check" CHECK ("whatsapp_notifications"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "financial_contacts" ADD COLUMN "whatsapp_opt_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial_contacts" ADD COLUMN "whatsapp_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_module" "billing_module" DEFAULT 'dora' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "organizer_phone_normalized" varchar(14);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "organizer_phone_display" varchar(20);--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_billing_period_id_billing_periods_id_fk" FOREIGN KEY ("billing_period_id") REFERENCES "public"."billing_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_financial_contact_id_financial_contacts_id_fk" FOREIGN KEY ("financial_contact_id") REFERENCES "public"."financial_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_notifications_idempotency_unique" ON "whatsapp_notifications" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_notifications_meta_message_unique" ON "whatsapp_notifications" USING btree ("meta_message_id");--> statement-breakpoint
CREATE INDEX "whatsapp_notifications_dispatch_idx" ON "whatsapp_notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "whatsapp_notifications_organization_idx" ON "whatsapp_notifications" USING btree ("organization_id","created_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_organizer_phone_pair_check" CHECK (("organizations"."organizer_phone_normalized" is null and "organizations"."organizer_phone_display" is null) or ("organizations"."organizer_phone_normalized" is not null and "organizations"."organizer_phone_display" is not null));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_organizer_phone_format_check" CHECK ("organizations"."organizer_phone_normalized" is null or "organizations"."organizer_phone_normalized" ~ '^\+55[1-9][0-9]9[0-9]{8}$');--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_cobradora_phone_required_check" CHECK ("organizations"."billing_module" <> 'cobradora' or "organizations"."organizer_phone_normalized" is not null);