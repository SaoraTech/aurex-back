import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { subscription } from '../db/schema';
import { newId } from '../common/ids';
import { PlanName, PlansService } from '../plans/plans.service';

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly plans: PlansService,
    @Inject(DRIZZLE) private readonly db?: any,
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
    const db = executor ?? this.db;
    if (!db) throw new Error('Entitlements database is unavailable');

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
      await db.update(subscription).set(values).where(eq(subscription.id, existing.id));
      return { id: existing.id, ...values };
    }

    await db.update(subscription).set({ status: 'canceled', updatedAt: new Date() }).where(and(
      eq(subscription.userId, input.userId),
      eq(subscription.provider, input.provider),
      eq(subscription.status, 'active'),
    ));

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
  }

}
