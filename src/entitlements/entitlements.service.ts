import { Injectable } from '@nestjs/common';
import { PlanName, PlansService } from '../plans/plans.service';

@Injectable()
export class EntitlementsService {
  constructor(private readonly plans: PlansService) {}

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
}
