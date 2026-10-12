import { ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { payment } from '../db/schema';
import { newId } from '../common/ids';
import { PlansService, PlanName } from '../plans/plans.service';

@Injectable()
export class BillingService {
  constructor(@Inject(DRIZZLE) private readonly db: any, private readonly config: ConfigService, private readonly plans: PlansService) {}

  async createCheckout(userId: string, plan: PlanName, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length > 120) throw new ConflictException('A valid Idempotency-Key is required');
    if (plan === 'free') throw new ConflictException('Free plan does not require checkout');
    const provider = this.config.get<string>('paymentProvider') ?? 'disabled';
    if (provider === 'disabled') throw new ServiceUnavailableException('Payments are not enabled until a provider is approved and configured');
    // Deliberately fail closed: provider-specific signed checkout adapters must be implemented and tested before enabling a provider.
    throw new ServiceUnavailableException(`Payment provider "${provider}" has no validated adapter configured`);
  }

  async history(userId: string) {
    return this.db.select({
      id: payment.id, provider: payment.provider, amountMinor: payment.amountMinor,
      currency: payment.currency, plan: payment.plan, status: payment.status, createdAt: payment.createdAt,
    }).from(payment).where(eq(payment.userId, userId)).limit(100);
  }

  async processVerifiedWebhook(_provider: string, _eventId: string, _payload: unknown, _signature: string) {
    // Must not be exposed until each provider's signature format, replay protection,
    // event idempotency, amount/currency validation and state machine are implemented.
    throw new ServiceUnavailableException('Payment webhooks are not enabled: provider adapter is not validated');
  }
}
