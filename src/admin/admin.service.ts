import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { announcement, auditEvent, notificationDelivery, payment, subscription, user } from '../db/schema';

function pageValue(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly config: ConfigService,
  ) {}

  private async count(query: Promise<Array<{ count: unknown }>>): Promise<number> {
    const [row] = await query;
    return Number(row?.count ?? 0);
  }

  async dashboard() {
    const [usersCount, activeSubscriptions, successfulPayments, pendingPayments, publishedAnnouncements, recentActivity] =
      await Promise.all([
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(user)),
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(subscription).where(and(
          eq(subscription.status, 'active'),
          or(isNull(subscription.currentPeriodEnd), gte(subscription.currentPeriodEnd, new Date())),
        ))),
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(payment).where(eq(payment.status, 'succeeded'))),
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(payment).where(or(
          eq(payment.status, 'pending'),
          eq(payment.status, 'processing'),
        ))),
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(announcement).where(eq(announcement.status, 'published'))),
        this.db.select().from(auditEvent).orderBy(desc(auditEvent.createdAt)).limit(15),
      ]);

    return {
      totals: {
        users: usersCount,
        activeSubscriptions,
        successfulPayments,
        pendingPayments,
        publishedAnnouncements,
      },
      recentActivity,
    };
  }

  async listAuditEvents(
    action?: string,
    actorUserId?: string,
    targetType?: string,
    limitInput?: string,
    offsetInput?: string,
  ) {
    const limit = pageValue(limitInput, 50, 100);
    const offset = pageValue(offsetInput, 0, 1000000);
    const conditions = [];
    if (action) conditions.push(eq(auditEvent.action, action));
    if (actorUserId) conditions.push(eq(auditEvent.actorUserId, actorUserId));
    if (targetType) conditions.push(eq(auditEvent.targetType, targetType));
    const where = conditions.length ? and(...conditions) : undefined;

    const [items, countRows] = await Promise.all([
      this.db.select({
        id: auditEvent.id,
        actorUserId: auditEvent.actorUserId,
        actorEmail: user.email,
        action: auditEvent.action,
        targetType: auditEvent.targetType,
        targetId: auditEvent.targetId,
        requestId: auditEvent.requestId,
        createdAt: auditEvent.createdAt,
      }).from(auditEvent)
        .leftJoin(user, eq(auditEvent.actorUserId, user.id))
        .where(where)
        .orderBy(desc(auditEvent.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: sql<number>`count(*)` })
        .from(auditEvent)
        .where(where),
    ]);

    return {
      items,
      total: Number(countRows[0]?.count ?? 0),
      limit,
      offset,
    };
  }

  async listPayments(status?: string, limitInput?: string, offsetInput?: string) {
    const limit = pageValue(limitInput, 50, 100);
    const offset = pageValue(offsetInput, 0, 1000000);
    const where = status ? eq(payment.status, status as typeof payment.$inferSelect.status) : undefined;
    const items = await this.db.select({
      id: payment.id,
      userId: payment.userId,
      userEmail: user.email,
      provider: payment.provider,
      providerReference: payment.providerReference,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      plan: payment.plan,
      status: payment.status,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    }).from(payment)
      .leftJoin(user, eq(payment.userId, user.id))
      .where(where)
      .orderBy(desc(payment.createdAt))
      .limit(limit)
      .offset(offset);

    return { items, limit, offset };
  }

  async listSubscriptions(status?: string, limitInput?: string, offsetInput?: string) {
    const limit = pageValue(limitInput, 50, 100);
    const offset = pageValue(offsetInput, 0, 1000000);
    const where = status ? eq(subscription.status, status) : undefined;
    const items = await this.db.select({
      id: subscription.id,
      userId: subscription.userId,
      userEmail: user.email,
      plan: subscription.plan,
      status: subscription.status,
      provider: subscription.provider,
      providerSubscriptionId: subscription.providerSubscriptionId,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    }).from(subscription)
      .leftJoin(user, eq(subscription.userId, user.id))
      .where(where)
      .orderBy(desc(subscription.updatedAt))
      .limit(limit)
      .offset(offset);

    return { items, limit, offset };
  }

  async listPublications(status?: string, limitInput?: string, offsetInput?: string) {
    const limit = pageValue(limitInput, 50, 100);
    const offset = pageValue(offsetInput, 0, 1000000);
    const where = status ? eq(announcement.status, status) : undefined;
    const items = await this.db.select().from(announcement)
      .where(where)
      .orderBy(desc(announcement.createdAt))
      .limit(limit)
      .offset(offset);
    return { items, limit, offset };
  }

  async listNotificationDeliveries(status?: string, category?: string, limitInput?: string, offsetInput?: string) {
    const limit = pageValue(limitInput, 50, 100);
    const offset = pageValue(offsetInput, 0, 1000000);
    const conditions = [];
    if (status) conditions.push(eq(notificationDelivery.status, status));
    if (category) conditions.push(eq(notificationDelivery.category, category));
    const items = await this.db.select().from(notificationDelivery)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(notificationDelivery.createdAt))
      .limit(limit)
      .offset(offset);
    return { items, limit, offset };
  }

  async notificationSummary() {
    const rows = await this.db.select({
      category: notificationDelivery.category,
      channel: notificationDelivery.channel,
      status: notificationDelivery.status,
      count: sql<number>`count(*)`,
    }).from(notificationDelivery).groupBy(
      notificationDelivery.category,
      notificationDelivery.channel,
      notificationDelivery.status,
    );
    return { items: rows };
  }

  getSettingsStatus() {
    const configured = (keys: string[]) => keys.every(key => Boolean(this.config.get<string>(key)));
    const jemenipayConfigured = configured(['jemenipayApiKey', 'jemenipaySecretKey', 'jemenipayWebhookSecret']);
    const novuConfigured = configured(['novuApiKey', 'novuAppIdentifier']);
    const dodoConfigured = configured([
      'dodoPaymentsApiKey', 'dodoPaymentsWebhookKey', 'dodoProductPlus',
      'dodoProductPro', 'dodoPaymentsReturnUrl',
    ]);
    const revenueCatConfigured = configured([
      'revenueCatApiKey', 'revenueCatWebhookAuthorization',
      'revenueCatPlusEntitlementId', 'revenueCatProEntitlementId',
    ]);
    const huaweiConfigured = configured([
      'huaweiIapClientId', 'huaweiIapClientSecret', 'huaweiIapApiBaseUrl',
      'huaweiIapPublicKey', 'huaweiIapPlusProductId', 'huaweiIapProProductId',
    ]);

    return {
      providers: {
        jemenipay: { status: jemenipayConfigured ? 'credentials_configured' : 'missing_configuration' },
        dodoPayments: {
          status: dodoConfigured ? 'credentials_configured' : 'missing_configuration',
          environment: this.config.get<string>('dodoPaymentsEnvironment') ?? 'test_mode',
        },
        revenueCat: { status: revenueCatConfigured ? 'credentials_configured' : 'missing_configuration' },
        huaweiIap: { status: huaweiConfigured ? 'credentials_configured' : 'missing_configuration' },
      },
      notifications: {
        novu: { status: novuConfigured ? 'credentials_configured' : 'missing_configuration' },
      },
      note: 'Credential presence only; this endpoint does not claim that external accounts, webhooks or live transactions have been verified. Secrets are never returned.',
    };
  }
}
