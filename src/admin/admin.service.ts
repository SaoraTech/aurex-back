import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, sql } from 'drizzle-orm';
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
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(subscription).where(eq(subscription.status, 'active'))),
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(payment).where(eq(payment.status, 'succeeded'))),
        this.count(this.db.select({ count: sql<number>`count(*)` }).from(payment).where(eq(payment.status, 'pending'))),
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

  getSettingsStatus() {
    const jemenipayConfigured = Boolean(
      this.config.get<string>('jemenipayApiKey') &&
      this.config.get<string>('jemenipaySecretKey'),
    );
    const novuConfigured = Boolean(this.config.get<string>('novuApiKey'));

    return {
      providers: {
        jemenipay: { status: jemenipayConfigured ? 'configured' : 'missing_credentials' },
        revenueCat: { status: 'pending_integration' },
        dodoPayments: { status: 'pending_integration' },
        huaweiIap: { status: 'pending_integration' },
      },
      notifications: {
        novu: { status: novuConfigured ? 'configured' : 'missing_credentials' },
      },
      note: 'Configuration status only. Credentials are never returned by this endpoint.',
    };
  }
}
