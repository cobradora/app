ALTER TABLE "financial_contacts" DROP CONSTRAINT "financial_contacts_phone_check";--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_organizer_phone_format_check";--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" DROP CONSTRAINT "whatsapp_notifications_recipient_phone_check";--> statement-breakpoint
ALTER TABLE "financial_contacts" ALTER COLUMN "phone_normalized" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "financial_contacts" ALTER COLUMN "phone_display" SET DATA TYPE varchar(25);--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "organizer_phone_normalized" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "organizer_phone_display" SET DATA TYPE varchar(25);--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ALTER COLUMN "recipient_phone_normalized" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "financial_contacts" ADD CONSTRAINT "financial_contacts_phone_check" CHECK ("financial_contacts"."phone_normalized" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_organizer_phone_format_check" CHECK ("organizations"."organizer_phone_normalized" is null or "organizations"."organizer_phone_normalized" ~ '^\+[1-9][0-9]{7,14}$');--> statement-breakpoint
ALTER TABLE "whatsapp_notifications" ADD CONSTRAINT "whatsapp_notifications_recipient_phone_check" CHECK ("whatsapp_notifications"."recipient_phone_normalized" ~ '^\+[1-9][0-9]{7,14}$');