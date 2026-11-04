import { Injectable, Logger } from '@nestjs/common';
import { badRequest, unauthorized } from '../common/errors';
import { PlansService } from '../plans/plans.service';
import { JemenipayProvider } from './providers/jemenipay.provider';
import { PaymentMethodType } from './providers/payment-provider.interface';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly jemenipay: JemenipayProvider,
    private readonly plans: PlansService,
  ) {}

  async checkout(
    userId: string,
    email: string,
    plan: 'plus' | 'pro' | 'plus_promo' | 'pro_promo',
    paymentMethod: PaymentMethodType = 'orange_money_mali',
    returnUrl?: string,
  ) {
    const pricing: Record<string, number> = {
      plus: 5000,
      pro: 10000,
      plus_promo: 1500,
      pro_promo: 3000,
    };

    const amount = pricing[plan];
    if (!amount) throw badRequest('INVALID_PLAN', 'Plan invalide');

    return this.jemenipay.initiateCheckout({
      userId,
      email,
      plan,
      amount,
      currency: 'XOF',
      paymentMethod,
      returnUrl,
    });
  }

  async handleJemenipayWebhook(rawBody: Buffer | string, signature: string, timestamp?: string) {
    const verified = await this.jemenipay.verifyWebhook(rawBody, signature, timestamp);
    if (!verified.valid) {
      throw unauthorized('INVALID_SIGNATURE', 'Signature webhook Jemenipay invalide');
    }

    if (verified.status === 'success') {
      const plan = verified.metadata?.plan;
      const userId = verified.metadata?.userId;
      this.logger.log(`Paiement Jemenipay confirmé: ${verified.paymentId} pour ${userId} (Plan: ${plan})`);
    }

    return { received: true, status: verified.status };
  }
}
