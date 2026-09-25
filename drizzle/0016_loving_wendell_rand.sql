CREATE TYPE "public"."deposit_status" AS ENUM('created', 'pending', 'confirmed', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('deposit', 'refund', 'withdrawal_reserve', 'withdrawal_settle', 'withdrawal_release');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('created', 'reserved', 'pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "gateway_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"financial_contact_id" uuid NOT NULL,
	"checkout_session_id" uuid,
	"provider" varchar(30) DEFAULT 'xgate' NOT NULL,
	"provider_transaction_id" varchar(200),
	"gross_amount" integer NOT NULL,
	"fee_rate_bps" integer DEFAULT 300 NOT NULL,
	"fee_amount" integer NOT NULL,
	"net_amount" integer NOT NULL,
	"status" "deposit_status" DEFAULT 'created' NOT NULL,
	"pix_copy_paste" text,
	"external_creation_state" varchar(24) DEFAULT 'not_started' NOT NULL,
	"external_request_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_deposits_creation_state_check" CHECK ("gateway_deposits"."external_creation_state" in ('not_started', 'in_flight', 'ambiguous', 'linked')),
	CONSTRAINT "gateway_deposits_valid_amounts" CHECK ("gateway_deposits"."gross_amount" > 0 and "gateway_deposits"."fee_rate_bps" between 0 and 10000 and "gateway_deposits"."fee_amount" = floor(("gateway_deposits"."gross_amount"::bigint * "gateway_deposits"."fee_rate_bps" + 5000) / 10000) and "gateway_deposits"."net_amount" = "gateway_deposits"."gross_amount" - "gateway_deposits"."fee_amount")
);
--> statement-breakpoint
CREATE TABLE "organization_balances" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"settled_amount" bigint DEFAULT 0 NOT NULL,
	"reserved_amount" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_balances_valid_amounts" CHECK ("organization_balances"."reserved_amount" >= 0 and abs("organization_balances"."settled_amount") <= 9007199254740991 and "organization_balances"."reserved_amount" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "organization_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(30) NOT NULL,
	"operation_id" varchar(250) NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount" integer NOT NULL,
	"reserved_delta" integer DEFAULT 0 NOT NULL,
	"deposit_id" uuid,
	"withdrawal_id" uuid,
	"gross_amount" integer,
	"fee_amount" integer,
	"fee_rate_bps" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_payout_profiles" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"document" varchar(14) NOT NULL,
	"email" varchar(255),
	"phone" varchar(25),
	"provider_customer_id" varchar(200),
	"pix_key_type" varchar(20) NOT NULL,
	"pix_key" varchar(255) NOT NULL,
	"provider_pix_key_id" varchar(200),
	"provider_pix_key" jsonb,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payer_gateway_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"financial_contact_id" uuid NOT NULL,
	"provider" varchar(30) DEFAULT 'xgate' NOT NULL,
	"name" varchar(200) NOT NULL,
	"document" varchar(14) NOT NULL,
	"email" varchar(255),
	"phone" varchar(25),
	"provider_customer_id" varchar(200),
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(30) DEFAULT 'xgate' NOT NULL,
	"provider_transaction_id" varchar(200),
	"amount" integer NOT NULL,
	"status" "withdrawal_status" DEFAULT 'created' NOT NULL,
	"beneficiary_snapshot" jsonb NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_positive_amount" CHECK ("withdrawals"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_sessions_tenant_identity" ON "checkout_sessions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_deposits_tenant_identity" ON "gateway_deposits" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_tenant_identity" ON "withdrawals" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "gateway_deposits" ADD CONSTRAINT "gateway_deposits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_deposits" ADD CONSTRAINT "gateway_deposits_checkout_session_id_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "public"."checkout_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_deposits" ADD CONSTRAINT "gateway_deposits_organization_id_financial_contact_id_financial_contacts_organization_id_id_fk" FOREIGN KEY ("organization_id","financial_contact_id") REFERENCES "public"."financial_contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_deposits" ADD CONSTRAINT "gateway_deposits_organization_id_checkout_session_id_checkout_sessions_organization_id_id_fk" FOREIGN KEY ("organization_id","checkout_session_id") REFERENCES "public"."checkout_sessions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_balances" ADD CONSTRAINT "organization_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ledger_entries" ADD CONSTRAINT "organization_ledger_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ledger_entries" ADD CONSTRAINT "organization_ledger_entries_organization_id_deposit_id_gateway_deposits_organization_id_id_fk" FOREIGN KEY ("organization_id","deposit_id") REFERENCES "public"."gateway_deposits"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ledger_entries" ADD CONSTRAINT "organization_ledger_entries_organization_id_withdrawal_id_withdrawals_organization_id_id_fk" FOREIGN KEY ("organization_id","withdrawal_id") REFERENCES "public"."withdrawals"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_payout_profiles" ADD CONSTRAINT "organization_payout_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_gateway_profiles" ADD CONSTRAINT "payer_gateway_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_gateway_profiles" ADD CONSTRAINT "payer_gateway_profiles_organization_id_financial_contact_id_financial_contacts_organization_id_id_fk" FOREIGN KEY ("organization_id","financial_contact_id") REFERENCES "public"."financial_contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_deposits_provider_transaction_unique" ON "gateway_deposits" USING btree ("provider","provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_deposits_session_unique" ON "gateway_deposits" USING btree ("checkout_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_ledger_operation_unique" ON "organization_ledger_entries" USING btree ("provider","operation_id");--> statement-breakpoint
CREATE INDEX "organization_ledger_org_idx" ON "organization_ledger_entries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payer_gateway_profiles_identity_unique" ON "payer_gateway_profiles" USING btree ("organization_id","financial_contact_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_provider_transaction_unique" ON "withdrawals" USING btree ("provider","provider_transaction_id");
