import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { subscription } from '../db/schema';
import { newId } from '../common/ids';
import { PlanName, PlansService } from '../plans/plans.service';
import { NotificationSubscribersService } from '../notifications/notification-subscribers.service';

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    private readonly plans: PlansService,
    @Inject(DRIZZLE) private readonly db?: any,
    @Optional() private readonly notificationSubscribers?: NotificationSubscribersService,
  ) {}

  async getForUser(userId: string) {
    const subscription = await this.plans.getSubscriptionInfo(userId);
    const plan = subscription.plan ?? 'free';

    return {
      plan,
      tier: subscription.commercialTier ?? 'free',
      subscription: {
        status: subscription.status,
        isPromo: subscription.isPromo,
        currentPeriodStart: subscription.currentPeriodStart ?? null,
        currentPeriodEnd: subscription.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
      },
      quotas: this.plans.getLimits(plan as PlanName),
    };
  }

  async activateSubscription(input: {
    userId: string;
    plan: string;
    provider: string;
    providerSubscriptionId: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }, executor?: any) {
    if (!executor && this.db?.transaction) {
      const result = await this.db.transaction((tx: any) => this.activateSubscription(input, tx));
      await this.syncNotificationMembership(input.userId);
      return result;
    }
    const db = executor ?? this.db;
    if (!db) throw new Error('Entitlements database is unavailable');

    // Serialize concurrent upserts for the same Aurex account. Keep every
    // provider subscription row: marking another provider's subscription as
    // canceled locally would not cancel billing at Apple, Google, Huawei or Dodo.
    if (typeof db.execute === 'function') {
      await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))`);
    }

    const [existing] = await db.select().from(subscription).where(and(
      eq(subscription.userId, input.userId),
      eq(subscription.provider, input.provider),
      eq(subscription.providerSubscriptionId, input.providerSubscriptionId),
    )).limit(1);

    const values = {
      plan: input.plan,
      status: input.status,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      updatedAt: new Date(),
    };

    if (existing) {
      // Ignore an older activation/renewal arriving after a newer billing period.
      if (
        input.status === 'active' &&
        existing.currentPeriodStart &&
        input.currentPeriodStart < existing.currentPeriodStart
      ) {
        return existing;
      }
      const [updated] = await db.update(subscription).set(values)
        .where(eq(subscription.id, existing.id)).returning();
      return updated ?? { id: existing.id, ...values };
    }

    const [created] = await db.insert(subscription).values({
      id: newId(),
      userId: input.userId,
      ...values,
      provider: input.provider,
      providerSubscriptionId: input.providerSubscriptionId,
      createdAt: new Date(),
    }).returning();

    return created;
  }

  async expireProviderSubscriptions(userId: string, provider: string) {
    if (!this.db) throw new Error('Entitlements database is unavailable');
    await this.db.update(subscription).set({
      status: 'expired',
      updatedAt: new Date(),
    }).where(and(
      eq(subscription.userId, userId),
      eq(subscription.provider, provider),
      eq(subscription.status, 'active'),
    ));
    await this.syncNotificationMembership(userId);
  }

  async syncNotificationMembership(userId: string) {
    if (!this.notificationSubscribers) return;
    try {
      await this.notificationSubscribers.sync(userId);
    } catch (error) {
      this.logger.warn(`Novu membership sync failed for user ${userId}: ${(error as Error).message}`);
    }
  }

  async expireElapsedSubscriptions(limit = 500) {
    if (!this.db) return { expiredSubscriptions: 0, usersSynced: 0 };
    const now = new Date();
    const due = await this.db.select({ id: subscription.id, userId: subscription.userId })
      .from(subscription)
      .where(and(
        inArray(subscription.status, ['active', 'past_due']),
        isNotNull(subscription.currentPeriodEnd),
        lte(subscription.currentPeriodEnd, now),
      ))
      .orderBy(asc(subscription.currentPeriodEnd))
      .limit(Math.min(Math.max(1, limit), 1000));

    if (due.length === 0) return { expiredSubscriptions: 0, usersSynced: 0 };

    const updated = await this.db.update(subscription).set({
      status: 'expired',
      updatedAt: now,
    }).where(and(
      inArray(subscription.id, due.map((row: { id: string }) => row.id)),
      inArray(subscription.status, ['active', 'past_due']),
      lte(subscription.currentPeriodEnd, now),
    )).returning({ userId: subscription.userId });

    const updatedUserIds: string[] = (updated as Array<{ userId: string }>).map(row => row.userId);
    const userIds: string[] = [...new Set<string>(updatedUserIds)];
    for (const userId of userIds) {
      await this.syncNotificationMembership(userId);
    }

    return { expiredSubscriptions: updated.length, usersSynced: userIds.length };
  }

}
