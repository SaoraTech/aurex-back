import {
  pgTable, text, timestamp, boolean, integer, varchar, index, pgEnum,
  jsonb, uniqueIndex, bigint,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const planEnum = pgEnum('plan', ['free','plus','pro']);
export const messageRole = pgEnum('message_role', ['user','assistant','system','tool']);
export const subjectEnum = pgEnum('subject', ['calculus','algebra','geometry','statistics','general']);
export const artifactType = pgEnum('artifact_type', ['equation','graph','proof','solution','document','other']);
export const paymentStatus = pgEnum('payment_status', ['pending','processing','succeeded','failed','cancelled','refunded']);
export const privacyRequestStatus = pgEnum('privacy_request_status', ['pending','processing','completed','rejected']);

export const user = pgTable('user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(), expiresAt: timestamp('expires_at').notNull(), token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, t => ({ userIdx: index('session_user_idx').on(t.userId) }));

export const account = pgTable('account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'), refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'), password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => ({ userIdx: index('account_user_idx').on(t.userId) }));

export const verification = pgTable('verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(), createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => ({ identifierIdx: index('verification_identifier_idx').on(t.identifier) }));

export const conversation = pgTable('conversation', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 160 }), subject: subjectEnum('subject').notNull().default('general'),
  archivedAt: timestamp('archived_at'), createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => ({ userIdx: index('conversation_user_idx').on(t.userId), updatedIdx: index('conversation_updated_idx').on(t.updatedAt) }));

export const message = pgTable('message', {
  id: text('id').primaryKey(), conversationId: text('conversation_id').notNull().references(() => conversation.id, { onDelete: 'cascade' }),
  role: messageRole('role').notNull(), content: text('content').notNull(), mathInput: text('math_input'),
  mathResult: text('math_result'), computation: text('computation'), provider: text('provider'),
  requestId: text('request_id'), tokenCount: integer('token_count'),
  model: text('model'), latencyMs: integer('latency_ms'),
  /** Web sources used for this answer (url/title/snippet metadata only), when a real web search was performed. */
  sources: jsonb('sources'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => ({
  conversationIdx: index('message_conversation_idx').on(t.conversationId),
  requestIdx: index('message_request_idx').on(t.requestId),
  // Idempotency: at most one message per (conversation, client request id, role).
  idempotencyIdx: uniqueIndex('message_idempotency_uq').on(t.conversationId, t.requestId, t.role).where(sql`request_id is not null`),
}));

export const subscription = pgTable('subscription', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  plan: planEnum('plan').notNull().default('free'), status: text('status').notNull().default('active'),
  provider: text('provider'), providerSubscriptionId: text('provider_subscription_id'),
  currentPeriodStart: timestamp('current_period_start').notNull().defaultNow(),
  currentPeriodEnd: timestamp('current_period_end'), cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => ({ userIdx: index('subscription_user_idx').on(t.userId), providerIdx: index('subscription_provider_idx').on(t.providerSubscriptionId) }));

export const payment = pgTable('payment', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), providerReference: text('provider_reference'),
  idempotencyKey: text('idempotency_key').notNull(), amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('XOF'), plan: planEnum('plan').notNull(),
  status: paymentStatus('status').notNull().default('pending'), checkoutUrl: text('checkout_url'),
  rawStatus: text('raw_status'), createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => ({ idempotencyIdx: uniqueIndex('payment_user_idempotency_uq').on(t.userId, t.idempotencyKey), providerRefIdx: index('payment_provider_ref_idx').on(t.providerReference) }));

export const memoryItem = pgTable('memory_item', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 120 }).notNull(), content: text('content').notNull(),
  pinned: boolean('pinned').notNull().default(false), createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => ({ userIdx: index('memory_user_idx').on(t.userId) }));

export const artifact = pgTable('artifact', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 180 }).notNull(), type: artifactType('type').notNull().default('other'),
  currentVersion: integer('current_version').notNull().default(1), createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => ({ userIdx: index('artifact_user_idx').on(t.userId), updatedIdx: index('artifact_updated_idx').on(t.updatedAt) }));

export const artifactVersion = pgTable('artifact_version', {
  id: text('id').primaryKey(), artifactId: text('artifact_id').notNull().references(() => artifact.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(), content: jsonb('content').notNull(), note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => ({ versionIdx: uniqueIndex('artifact_version_uq').on(t.artifactId, t.version) }));

export const libraryDocument = pgTable('library_document', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(), mimeType: varchar('mime_type', { length: 120 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(), objectKey: text('object_key').notNull(),
  sha256: varchar('sha256', { length: 64 }),
  status: text('status').notNull().default('stored'), createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => ({ userIdx: index('library_user_idx').on(t.userId), objectKeyIdx: uniqueIndex('library_object_key_uq').on(t.objectKey) }));

export const privacyRequest = pgTable('privacy_request', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), status: privacyRequestStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(), completedAt: timestamp('completed_at'),
}, t => ({ userIdx: index('privacy_user_idx').on(t.userId) }));

export const auditEvent = pgTable('audit_event', {
  id: text('id').primaryKey(), actorUserId: text('actor_user_id'), action: varchar('action', { length: 120 }).notNull(),
  targetType: varchar('target_type', { length: 80 }), targetId: text('target_id'),
  metadata: jsonb('metadata'), requestId: text('request_id'), createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => ({ actorIdx: index('audit_actor_idx').on(t.actorUserId), actionIdx: index('audit_action_idx').on(t.action), createdIdx: index('audit_created_idx').on(t.createdAt) }));

export const notificationPreference = pgTable('notification_preference', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').notNull().default(true), productEnabled: boolean('product_enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(), updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Billable / quota-relevant provider calls (tts chars, stt calls, web searches, deep research, ...). */
export const providerUsage = pgTable('provider_usage', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  kind: varchar('kind', { length: 40 }).notNull(),
  provider: varchar('provider', { length: 40 }).notNull(),
  units: integer('units').notNull().default(1),
  latencyMs: integer('latency_ms'),
  outcome: varchar('outcome', { length: 30 }).notNull(),
  requestId: text('request_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => ({ userKindIdx: index('provider_usage_user_kind_idx').on(t.userId, t.kind, t.createdAt) }));
