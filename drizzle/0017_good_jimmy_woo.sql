ALTER TABLE "withdrawals" ADD COLUMN "idempotency_key" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "external_creation_state" varchar(24) DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "external_request_started_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_idempotency_unique" ON "withdrawals" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_creation_state_check" CHECK ("withdrawals"."external_creation_state" in ('not_started', 'in_flight', 'ambiguous', 'linked'));