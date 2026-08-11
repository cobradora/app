import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  date,
  pgEnum,
  unique,
  uniqueIndex,
  jsonb,
  text,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- Enums ----------
export const orgStatusEnum = pgEnum("org_status", ["active", "suspended"]);
export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);
export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);
export const groupStatusEnum = pgEnum("group_status", ["active", "archived"]);
export const participantStatusEnum = pgEnum("participant_status", ["active", "inactive"]);
export const groupParticipantStatusEnum = pgEnum("group_participant_status", ["active", "left"]);
export const billingPeriodStatusEnum = pgEnum("billing_period_status", ["open", "closed"]);
export const chargeStatusEnum = pgEnum("charge_status", [
  "open",
  "checkout_pending",
  "paid",
  "manually_paid",
  "canceled",
  "refunded",
]);
export const checkoutSessionStatusEnum = pgEnum("checkout_session_status", [
  "created",
  "pending",
  "completed",
  "expired",
  "canceled",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "confirmed",
  "failed",
  "refunded",
  "partially_refunded",
]);
export const gatewayAccountStatusEnum = pgEnum("gateway_account_status", [
  "pending",
  "active",
  "disabled",
]);
export const commissionTypeEnum = pgEnum("commission_type", ["percentage", "fixed"]);
export const webhookProcessingStatusEnum = pgEnum("webhook_processing_status", [
  "received",
  "processing",
  "processed",
  "failed",
]);
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system", "participant"]);

// ---------- organizations ----------
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  status: orgStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- users ----------
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  role: userRoleEnum("role").notNull().default("member"),
  status: userStatusEnum("status").notNull().default("active"),
}, (table) => ({
  emailUnique: uniqueIndex("users_email_unique").on(table.email),
}));

// ---------- groups ----------
export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 200 }).notNull(),
  publicSlug: varchar("public_slug", { length: 100 }).notNull(),
  billingDay: integer("billing_day").notNull(),
  defaultAmount: integer("default_amount").notNull(),
  status: groupStatusEnum("status").notNull().default("active"),
}, (table) => ({
  slugUnique: uniqueIndex("groups_public_slug_unique").on(table.publicSlug),
}));

// ---------- participants ----------
export const participants = pgTable("participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 200 }).notNull(),
  phoneNormalized: varchar("phone_normalized", { length: 20 }).notNull(),
  phoneDisplay: varchar("phone_display", { length: 30 }).notNull(),
  status: participantStatusEnum("status").notNull().default("active"),
});

// ---------- group_participants ----------
export const groupParticipants = pgTable("group_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  status: groupParticipantStatusEnum("status").notNull().default("active"),
}, (table) => ({
  // Um participante só pode ter UM vínculo ativo por grupo (RB-003 + RB-018:
  // sair e voltar cria uma nova linha, preservando o histórico da anterior).
  oneActivePerGroup: uniqueIndex("group_participants_active_unique")
    .on(table.groupId, table.participantId)
    .where(sql`status = 'active'`),
}));

// ---------- billing_periods ----------
export const billingPeriods = pgTable("billing_periods", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  referenceMonth: varchar("reference_month", { length: 7 }).notNull(), // 'YYYY-MM'
  dueDate: date("due_date").notNull(),
  status: billingPeriodStatusEnum("status").notNull().default("open"),
}, (table) => ({
  refMonthUnique: unique("billing_periods_group_month_unique").on(table.groupId, table.referenceMonth),
}));

// ---------- charges ----------
export const charges = pgTable("charges", {
  id: uuid("id").defaultRandom().primaryKey(),
  billingPeriodId: uuid("billing_period_id").notNull().references(() => billingPeriods.id),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  originalAmount: integer("original_amount").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  fineAmount: integer("fine_amount").notNull().default(0),
  interestAmount: integer("interest_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  status: chargeStatusEnum("status").notNull().default("open"),
  dueDate: date("due_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  perParticipantUnique: unique("charges_period_participant_unique").on(table.billingPeriodId, table.participantId),
}));

// ---------- checkout_sessions ----------
export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  gateway: varchar("gateway", { length: 40 }).notNull(),
  gatewayCheckoutId: varchar("gateway_checkout_id", { length: 200 }),
  status: checkoutSessionStatusEnum("status").notNull().default("created"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  webhookTokenHash: varchar("webhook_token_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyUnique: uniqueIndex("checkout_sessions_idempotency_unique").on(table.idempotencyKey),
}));

// ---------- checkout_items ----------
export const checkoutItems = pgTable("checkout_items", {
  checkoutSessionId: uuid("checkout_session_id").notNull().references(() => checkoutSessions.id),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  amount: integer("amount").notNull(),
}, (table) => ({
  pk: unique("checkout_items_pk").on(table.checkoutSessionId, table.chargeId),
}));

// ---------- payments ----------
export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  gateway: varchar("gateway", { length: 40 }).notNull(),
  gatewayPaymentId: varchar("gateway_payment_id", { length: 200 }),
  amount: integer("amount").notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentMethod: varchar("payment_method", { length: 40 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  gatewayPaymentUnique: uniqueIndex("payments_gateway_payment_unique").on(table.gatewayPaymentId),
}));

// ---------- payment_allocations ----------
export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  amount: integer("amount").notNull(),
});

// ---------- gateway_accounts ----------
export const gatewayAccounts = pgTable("gateway_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  provider: varchar("provider", { length: 40 }).notNull(),
  externalAccountId: varchar("external_account_id", { length: 200 }).notNull(),
  status: gatewayAccountStatusEnum("status").notNull().default("pending"),
  configurationReference: varchar("configuration_reference", { length: 200 }),
});

// ---------- commissions ----------
export const commissions = pgTable("commissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  groupId: uuid("group_id").references(() => groups.id),
  type: commissionTypeEnum("type").notNull(),
  // 'fixed' => centavos; 'percentage' => basis points (1% = 100)
  value: integer("value").notNull(),
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until"),
});

// ---------- webhook_events ----------
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: varchar("provider", { length: 40 }).notNull(),
  externalEventId: varchar("external_event_id", { length: 200 }).notNull(),
  eventType: varchar("event_type", { length: 80 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  processingStatus: webhookProcessingStatusEnum("processing_status").notNull().default("received"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
}, (table) => ({
  providerEventUnique: uniqueIndex("webhook_events_provider_event_unique").on(table.provider, table.externalEventId),
}));

// ---------- audit_events ----------
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  entityType: varchar("entity_type", { length: 60 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  action: varchar("action", { length: 60 }).notNull(),
  actorType: auditActorTypeEnum("actor_type").notNull(),
  actorId: uuid("actor_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
