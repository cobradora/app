import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  timestamp,
  date,
  pgEnum,
  unique,
  uniqueIndex,
  index,
  check,
  foreignKey,
  jsonb,
  text,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- Enums ----------
export const orgStatusEnum = pgEnum("org_status", ["active", "suspended"]);
export const billingModuleEnum = pgEnum("billing_module", ["dora", "cobradora"]);
export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);
export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);
export const groupStatusEnum = pgEnum("group_status", ["active", "archived"]);
export const participantStatusEnum = pgEnum("participant_status", ["active", "inactive"]);
export const financialRoleEnum = pgEnum("financial_role", ["responsible", "dependent"]);
export const groupParticipantStatusEnum = pgEnum("group_participant_status", ["active", "left"]);
export const billingPeriodStatusEnum = pgEnum("billing_period_status", ["open", "closed"]);
export const messageParticipantFilterEnum = pgEnum("message_participant_filter", ["all", "paid", "pending"]);
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
export const whatsappNotificationKindEnum = pgEnum("whatsapp_notification_kind", [
  "charge_reminder",
  "organizer_cycle_start",
  "organizer_list_update",
]);
export const whatsappDeliveryStatusEnum = pgEnum("whatsapp_delivery_status", [
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
]);
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system", "participant"]);
export const devicePlatformEnum = pgEnum("device_platform", ["ios", "android"]);
export const depositStatusEnum = pgEnum("deposit_status", ["created", "pending", "confirmed", "failed", "refunded"]);
export const withdrawalStatusEnum = pgEnum("withdrawal_status", ["created", "reserved", "pending", "completed", "failed"]);
export const ledgerKindEnum = pgEnum("ledger_kind", ["deposit", "refund", "withdrawal_reserve", "withdrawal_settle", "withdrawal_release"]);

// ---------- organizations ----------
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  status: orgStatusEnum("status").notNull().default("active"),
  billingModule: billingModuleEnum("billing_module").notNull().default("dora"),
  organizerPhoneNormalized: varchar("organizer_phone_normalized", { length: 16 }),
  organizerPhoneDisplay: varchar("organizer_phone_display", { length: 25 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizerPhonePairCheck: check(
    "organizations_organizer_phone_pair_check",
    sql`(${table.organizerPhoneNormalized} is null and ${table.organizerPhoneDisplay} is null) or (${table.organizerPhoneNormalized} is not null and ${table.organizerPhoneDisplay} is not null)`,
  ),
  organizerPhoneFormatCheck: check(
    "organizations_organizer_phone_format_check",
    sql`${table.organizerPhoneNormalized} is null or ${table.organizerPhoneNormalized} ~ '^\\+[1-9][0-9]{7,14}$'`,
  ),
  cobradoraPhoneRequiredCheck: check(
    "organizations_cobradora_phone_required_check",
    sql`${table.billingModule} <> 'cobradora' or ${table.organizerPhoneNormalized} is not null`,
  ),
}));

// ---------- organization_settings ----------
export const organizationSettings = pgTable("organization_settings", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id),
  messageIntro: varchar("message_intro", { length: 1000 }).notNull().default(""),
  messageOutro: varchar("message_outro", { length: 1000 }).notNull().default(""),
  messageParticipantFilter: messageParticipantFilterEnum("message_participant_filter").notNull().default("all"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- users ----------
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }),
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
  sport: varchar("sport", { length: 60 }),
  publicSlug: varchar("public_slug", { length: 100 }).notNull(),
  // Nulo = renovação manual (sem cron automático para este grupo).
  billingDay: integer("billing_day"),
  defaultAmount: integer("default_amount").notNull(),
  status: groupStatusEnum("status").notNull().default("active"),
  messageIntro: varchar("message_intro", { length: 1000 }).notNull().default(""),
  messageOutro: varchar("message_outro", { length: 1000 }).notNull().default(""),
  messageParticipantFilter: messageParticipantFilterEnum("message_participant_filter").notNull().default("all"),
}, (table) => ({
  slugUnique: uniqueIndex("groups_public_slug_unique").on(table.publicSlug),
  organizationIdentityUnique: uniqueIndex("groups_organization_id_id_unique")
    .on(table.organizationId, table.id),
  organizationStatusIndex: index("groups_organization_status_idx").on(table.organizationId, table.status),
  billingDayCheck: check("groups_billing_day_check", sql`${table.billingDay} between 1 and 28`),
  defaultAmountCheck: check("groups_default_amount_check", sql`${table.defaultAmount} > 0`),
}));

// ---------- financial_contacts ----------
export const financialContacts = pgTable("financial_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  phoneNormalized: varchar("phone_normalized", { length: 16 }).notNull(),
  phoneDisplay: varchar("phone_display", { length: 25 }).notNull(),
  whatsappOptInAt: timestamp("whatsapp_opt_in_at", { withTimezone: true }),
  whatsappOptOutAt: timestamp("whatsapp_opt_out_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationPhoneUnique: uniqueIndex("financial_contacts_organization_phone_unique")
    .on(table.organizationId, table.phoneNormalized),
  organizationIdentityUnique: uniqueIndex("financial_contacts_organization_id_id_unique")
    .on(table.organizationId, table.id),
  phoneCheck: check("financial_contacts_phone_check", sql`${table.phoneNormalized} ~ '^\\+[1-9][0-9]{7,14}$'`),
}));

// ---------- participants ----------
export const participants = pgTable("participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  financialContactId: uuid("financial_contact_id").notNull().references(() => financialContacts.id),
  name: varchar("name", { length: 200 }).notNull(),
  nameNormalized: varchar("name_normalized", { length: 200 }).notNull(),
  financialRole: financialRoleEnum("financial_role").notNull(),
  // Colunas legadas mantidas temporariamente para um rollout aditivo. Novas
  // escritas usam financial_contacts; uma migration futura pode removê-las.
  legacyPhoneNormalized: varchar("phone_normalized", { length: 20 }),
  legacyPhoneDisplay: varchar("phone_display", { length: 30 }),
  status: participantStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  contactIndex: index("participants_financial_contact_idx").on(table.financialContactId),
  organizationIdentityUnique: uniqueIndex("participants_organization_id_id_unique")
    .on(table.organizationId, table.id),
  organizationContactReference: foreignKey({
    name: "participants_organization_financial_contact_fk",
    columns: [table.organizationId, table.financialContactId],
    foreignColumns: [financialContacts.organizationId, financialContacts.id],
  }),
  oneResponsiblePerContact: uniqueIndex("participants_financial_contact_responsible_unique")
    .on(table.financialContactId)
    .where(sql`${table.financialRole} = 'responsible'`),
}));

// ---------- group_participants ----------
export const groupParticipants = pgTable("group_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").notNull().references(() => groups.id),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  billingAmount: integer("billing_amount").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  billingStartsOn: date("billing_starts_on").notNull(),
  participantNameNormalized: varchar("participant_name_normalized", { length: 200 }).notNull(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  status: groupParticipantStatusEnum("status").notNull().default("active"),
  // Categoria livre do participante neste grupo (ex.: "Sub-15"). A ordem de
  // exibição na mensagem de cobrança vem de group_tags.createdAt, não daqui.
  tag: varchar("tag", { length: 60 }),
}, (table) => ({
  // Um participante só pode ter UM vínculo ativo por grupo (RB-003 + RB-018:
  // sair e voltar cria uma nova linha, preservando o histórico da anterior).
  oneActivePerGroup: uniqueIndex("group_participants_active_unique")
    .on(table.groupId, table.participantId)
    .where(sql`status = 'active'`),
  oneActiveNormalizedNamePerGroup: uniqueIndex("group_participants_active_name_unique")
    .on(table.groupId, table.participantNameNormalized)
    .where(sql`${table.status} = 'active'`),
  billingAmountCheck: check(
    "group_participants_billing_amount_check",
    sql`${table.billingAmount} between 1 and 100000000`,
  ),
}));

// ---------- group_tags ----------
// Registra a ordem de primeira aparição de cada valor de tag dentro de um
// grupo (nunca atualizado depois de criado), para a mensagem de cobrança
// ordenar participantes pela ordem de cadastro das tags, não alfabeticamente.
export const groupTags = pgTable("group_tags", {
  groupId: uuid("group_id").notNull().references(() => groups.id),
  tag: varchar("tag", { length: 60 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: unique("group_tags_pk").on(table.groupId, table.tag),
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

// ---------- gateway_accounts ----------
export const gatewayAccounts = pgTable("gateway_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  provider: varchar("provider", { length: 40 }).notNull(),
  externalAccountId: varchar("external_account_id", { length: 200 }).notNull(),
  status: gatewayAccountStatusEnum("status").notNull().default("pending"),
  configurationReference: varchar("configuration_reference", { length: 200 }),
}, (table) => ({
  organizationProviderUnique: uniqueIndex("gateway_accounts_organization_provider_unique")
    .on(table.organizationId, table.provider),
  organizationIdentityUnique: uniqueIndex("gateway_accounts_organization_id_id_unique")
    .on(table.organizationId, table.id),
}));

// ---------- checkout_sessions ----------
export const checkoutSessions = pgTable("checkout_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  participantId: uuid("participant_id").notNull().references(() => participants.id),
  financialContactId: uuid("financial_contact_id").notNull().references(() => financialContacts.id),
  gatewayAccountId: uuid("gateway_account_id").references(() => gatewayAccounts.id),
  gatewayExternalAccountIdSnapshot: varchar("gateway_external_account_id_snapshot", { length: 200 }),
  gateway: varchar("gateway", { length: 40 }).notNull(),
  gatewayCheckoutId: varchar("gateway_checkout_id", { length: 200 }),
  gatewayPaymentId: varchar("gateway_payment_id", { length: 200 }),
  gatewayInvoiceSlug: varchar("gateway_invoice_slug", { length: 200 }),
  status: checkoutSessionStatusEnum("status").notNull().default("created"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }),
  webhookTokenHash: varchar("webhook_token_hash", { length: 64 }),
  recoveryTokenHash: varchar("recovery_token_hash", { length: 64 }),
  externalCreationState: varchar("external_creation_state", { length: 24 }).notNull().default("not_started"),
  externalRequestStartedAt: timestamp("external_request_started_at", { withTimezone: true }),
  checkoutUrl: text("checkout_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyUnique: uniqueIndex("checkout_sessions_organization_idempotency_unique")
    .on(table.organizationId, table.idempotencyKey),
  tenantIdentity: uniqueIndex("checkout_sessions_tenant_identity").on(table.organizationId, table.id),
  financialContactIndex: index("checkout_sessions_financial_contact_idx").on(table.financialContactId),
  requestFingerprintIndex: index("checkout_sessions_request_fingerprint_idx")
    .on(table.organizationId, table.requestFingerprint),
  organizationParticipantReference: foreignKey({
    name: "checkout_sessions_organization_participant_fk",
    columns: [table.organizationId, table.participantId],
    foreignColumns: [participants.organizationId, participants.id],
  }),
  organizationContactReference: foreignKey({
    name: "checkout_sessions_organization_financial_contact_fk",
    columns: [table.organizationId, table.financialContactId],
    foreignColumns: [financialContacts.organizationId, financialContacts.id],
  }),
  organizationGatewayAccountReference: foreignKey({
    name: "checkout_sessions_organization_gateway_account_fk",
    columns: [table.organizationId, table.gatewayAccountId],
    foreignColumns: [gatewayAccounts.organizationId, gatewayAccounts.id],
  }),
  externalCreationStateCheck: check(
    "checkout_sessions_external_creation_state_check",
    sql`${table.externalCreationState} in ('not_started', 'in_flight', 'ambiguous', 'linked')`,
  ),
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
  organizationParticipantReference: foreignKey({
    name: "payments_organization_participant_fk",
    columns: [table.organizationId, table.participantId],
    foreignColumns: [participants.organizationId, participants.id],
  }),
}));

// ---------- payment_allocations ----------
export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  amount: integer("amount").notNull(),
}, (table) => ({
  chargeUnique: uniqueIndex("payment_allocations_charge_unique").on(table.chargeId),
}));

// ---------- whatsapp_notifications ----------
// Outbox idempotente para mensagens iniciadas pela plataforma. O telefone e
// o payload ficam congelados para que retries não mudem de destinatário nem
// de conteúdo se o cadastro for editado depois do primeiro envio.
export const whatsappNotifications = pgTable("whatsapp_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  billingPeriodId: uuid("billing_period_id").notNull().references(() => billingPeriods.id),
  financialContactId: uuid("financial_contact_id"),
  kind: whatsappNotificationKindEnum("kind").notNull(),
  status: whatsappDeliveryStatusEnum("status").notNull().default("queued"),
  recipientPhoneNormalized: varchar("recipient_phone_normalized", { length: 16 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull(),
  payload: jsonb("payload").notNull(),
  metaMessageId: varchar("meta_message_id", { length: 200 }),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  errorCode: varchar("error_code", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyUnique: uniqueIndex("whatsapp_notifications_idempotency_unique").on(table.idempotencyKey),
  metaMessageUnique: uniqueIndex("whatsapp_notifications_meta_message_unique").on(table.metaMessageId),
  dispatchIndex: index("whatsapp_notifications_dispatch_idx").on(table.status, table.nextAttemptAt),
  organizationIndex: index("whatsapp_notifications_organization_idx").on(table.organizationId, table.createdAt),
  billingPeriodIndex: index("whatsapp_notifications_billing_period_idx").on(table.billingPeriodId),
  financialContactIndex: index("whatsapp_notifications_financial_contact_idx").on(table.financialContactId),
  organizationContactReference: foreignKey({
    name: "whatsapp_notifications_org_contact_fk",
    columns: [table.organizationId, table.financialContactId],
    foreignColumns: [financialContacts.organizationId, financialContacts.id],
  }),
  recipientPhoneCheck: check(
    "whatsapp_notifications_recipient_phone_check",
    sql`${table.recipientPhoneNormalized} ~ '^\\+[1-9][0-9]{7,14}$'`,
  ),
  attemptCountCheck: check("whatsapp_notifications_attempt_count_check", sql`${table.attemptCount} >= 0`),
  kindContactCheck: check(
    "whatsapp_notifications_kind_contact_check",
    sql`(${table.kind} = 'charge_reminder' and ${table.financialContactId} is not null) or (${table.kind} in ('organizer_cycle_start', 'organizer_list_update') and ${table.financialContactId} is null)`,
  ),
}));

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
  reconciliationHint: jsonb("reconciliation_hint").$type<{ depositId: string; transactionId: string }>(),
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

// ---------- rate_limit_hits ----------
// Contador de janela fixa para limitar abuso nas rotas públicas sem sessão
// (src/lib/rate-limit.ts). Linhas antigas são varridas pelo cron diário
// (src/app/api/cron/renewals/route.ts) — não precisa de índice de expiração.
export const rateLimitHits = pgTable("rate_limit_hits", {
  key: varchar("key", { length: 200 }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(1),
}, (table) => ({
  pk: unique("rate_limit_hits_pk").on(table.key, table.windowStart),
}));

// ---------- device_push_tokens ----------
// Token Expo Push por device do app mobile (notificador). Reinstalar/logar de
// novo no mesmo device reusa o mesmo token — por isso o upsert é pelo próprio
// token, não por usuário.
export const devicePushTokens = pgTable("device_push_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  expoPushToken: varchar("expo_push_token", { length: 200 }).notNull(),
  platform: devicePlatformEnum("platform").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  expoPushTokenUnique: uniqueIndex("device_push_tokens_expo_push_token_unique").on(table.expoPushToken),
  organizationIndex: index("device_push_tokens_organization_idx").on(table.organizationId),
}));

// Virtual balances belong to an organization, not an XGate subaccount.
export const organizationBalances = pgTable("organization_balances", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id),
  settledAmount: bigint("settled_amount", { mode: "number" }).notNull().default(0),
  reservedAmount: bigint("reserved_amount", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  validAmounts: check("organization_balances_valid_amounts", sql`${t.reservedAmount} >= 0 and abs(${t.settledAmount}) <= 9007199254740991 and ${t.reservedAmount} <= 9007199254740991`),
}));

export const payerGatewayProfiles = pgTable("payer_gateway_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  financialContactId: uuid("financial_contact_id").notNull(),
  provider: varchar("provider", { length: 30 }).notNull().default("xgate"),
  name: varchar("name", { length: 200 }).notNull(),
  document: varchar("document", { length: 14 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 25 }),
  providerCustomerId: varchar("provider_customer_id", { length: 200 }),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactFk: foreignKey({ columns: [t.organizationId, t.financialContactId], foreignColumns: [financialContacts.organizationId, financialContacts.id] }),
  identityUnique: uniqueIndex("payer_gateway_profiles_identity_unique").on(t.organizationId, t.financialContactId, t.provider),
}));

export const organizationPayoutProfiles = pgTable("organization_payout_profiles", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id),
  name: varchar("name", { length: 200 }).notNull(),
  document: varchar("document", { length: 14 }).notNull(),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 25 }),
  providerCustomerId: varchar("provider_customer_id", { length: 200 }),
  pixKeyType: varchar("pix_key_type", { length: 20 }).notNull(),
  pixKey: varchar("pix_key", { length: 255 }).notNull(),
  providerPixKeyId: varchar("provider_pix_key_id", { length: 200 }),
  providerPixKey: jsonb("provider_pix_key").$type<Record<string, unknown>>(),
  status: varchar("status", { length: 30 }).notNull().default("pending"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gatewayDeposits = pgTable("gateway_deposits", {
  id: uuid("id").defaultRandom().primaryKey(), // Also the provider externalId.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  financialContactId: uuid("financial_contact_id").notNull(),
  checkoutSessionId: uuid("checkout_session_id").references(() => checkoutSessions.id),
  provider: varchar("provider", { length: 30 }).notNull().default("xgate"),
  providerTransactionId: varchar("provider_transaction_id", { length: 200 }),
  grossAmount: integer("gross_amount").notNull(),
  feeRateBps: integer("fee_rate_bps").notNull().default(300),
  feeAmount: integer("fee_amount").notNull(),
  netAmount: integer("net_amount").notNull(),
  status: depositStatusEnum("status").notNull().default("created"),
  pixCopyPaste: text("pix_copy_paste"),
  externalCreationState: varchar("external_creation_state", { length: 24 }).notNull().default("not_started"),
  externalRequestStartedAt: timestamp("external_request_started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactFk: foreignKey({ columns: [t.organizationId, t.financialContactId], foreignColumns: [financialContacts.organizationId, financialContacts.id] }),
  providerUnique: uniqueIndex("gateway_deposits_provider_transaction_unique").on(t.provider, t.providerTransactionId),
  sessionFk: foreignKey({ columns: [t.organizationId, t.checkoutSessionId], foreignColumns: [checkoutSessions.organizationId, checkoutSessions.id] }),
  sessionUnique: uniqueIndex("gateway_deposits_session_unique").on(t.checkoutSessionId),
  creationStateCheck: check("gateway_deposits_creation_state_check", sql`${t.externalCreationState} in ('not_started', 'in_flight', 'ambiguous', 'linked')`),
  tenantIdentity: uniqueIndex("gateway_deposits_tenant_identity").on(t.organizationId, t.id),
  validAmounts: check("gateway_deposits_valid_amounts", sql`${t.grossAmount} > 0 and ${t.feeRateBps} between 0 and 10000 and ${t.feeAmount} = floor((${t.grossAmount}::bigint * ${t.feeRateBps} + 5000) / 10000) and ${t.netAmount} = ${t.grossAmount} - ${t.feeAmount}`),
}));

export const withdrawals = pgTable("withdrawals", {
  id: uuid("id").defaultRandom().primaryKey(), // Also the provider externalId.
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  provider: varchar("provider", { length: 30 }).notNull().default("xgate"),
  providerTransactionId: varchar("provider_transaction_id", { length: 200 }),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  amount: integer("amount").notNull(), // No additional withdrawal fee.
  status: withdrawalStatusEnum("status").notNull().default("created"),
  beneficiarySnapshot: jsonb("beneficiary_snapshot").$type<Record<string, unknown>>().notNull(),
  failureReason: text("failure_reason"),
  externalCreationState: varchar("external_creation_state", { length: 24 }).notNull().default("not_started"),
  externalRequestStartedAt: timestamp("external_request_started_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  positiveAmount: check("withdrawals_positive_amount", sql`${t.amount} > 0`),
  providerUnique: uniqueIndex("withdrawals_provider_transaction_unique").on(t.provider, t.providerTransactionId),
  tenantIdentity: uniqueIndex("withdrawals_tenant_identity").on(t.organizationId, t.id),
  idempotencyUnique: uniqueIndex("withdrawals_idempotency_unique").on(t.organizationId, t.idempotencyKey),
  creationStateCheck: check("withdrawals_creation_state_check", sql`${t.externalCreationState} in ('not_started', 'in_flight', 'ambiguous', 'linked')`),
}));

export const organizationLedgerEntries = pgTable("organization_ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  provider: varchar("provider", { length: 30 }).notNull(),
  operationId: varchar("operation_id", { length: 250 }).notNull(),
  kind: ledgerKindEnum("kind").notNull(),
  amount: integer("amount").notNull(), // Signed change to settled balance.
  reservedDelta: integer("reserved_delta").notNull().default(0),
  depositId: uuid("deposit_id"),
  withdrawalId: uuid("withdrawal_id"),
  grossAmount: integer("gross_amount"),
  feeAmount: integer("fee_amount"),
  feeRateBps: integer("fee_rate_bps"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  operationUnique: uniqueIndex("organization_ledger_operation_unique").on(t.provider, t.operationId),
  orgIndex: index("organization_ledger_org_idx").on(t.organizationId, t.createdAt),
  depositFk: foreignKey({ columns: [t.organizationId, t.depositId], foreignColumns: [gatewayDeposits.organizationId, gatewayDeposits.id] }),
  withdrawalFk: foreignKey({ columns: [t.organizationId, t.withdrawalId], foreignColumns: [withdrawals.organizationId, withdrawals.id] }),
}));

// ---------- app_notifications ----------
// Feed simples de eventos mostrado na lista do app mobile, independente do
// sucesso/falha do push em si (o push é best-effort; este registro não é).
export const appNotifications = pgTable("app_notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  kind: varchar("kind", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: varchar("body", { length: 500 }).notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizationIndex: index("app_notifications_organization_idx").on(table.organizationId, table.createdAt),
}));
