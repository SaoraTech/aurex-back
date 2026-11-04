import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { badGateway, badRequest, serviceUnavailable, unauthorized } from '../common/errors';
import { newId } from '../common/ids';
import { DRIZZLE } from '../db/db.constants';
import { payment, subscription, user } from '../db/schema';
import { PlanName, PlansService } from '../plans/plans.service';
import { JemenipayProvider } from './providers/jemenipay.provider';
import { PaymentMethodType } from './providers/payment-provider.interface';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly jemenipay: JemenipayProvider,
    private readonly plans: PlansService,
    @Optional() @Inject(DRIZZLE) private readonly db?: any,
  ) {}

  async checkout(
    userId: string,
    plan: 'plus' | 'pro' | 'plus_promo' | 'pro_promo',
    paymentMethod: PaymentMethodType = 'orange_money_mali',
    returnUrl?: string,
    idempotencyKey?: string,
  ) {
    const prices = this.plans.getPrices();
    const amount = prices[plan];
    if (!amount || amount <= 0) {
      throw badRequest('INVALID_PLAN', 'Plan payant invalide ou gratuit.');
    }

    // 1. Fetch authentic user email from database
    let email = 'user@saora.tech';
    if (this.db) {
      const [usr] = await this.db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      if (!usr?.email) {
        throw badRequest('USER_NOT_FOUND', 'Utilisateur introuvable pour ce paiement.');
      }
      email = usr.email;
    }

    // 2. Verify provider configuration
    if (!this.jemenipay.isConfigured()) {
      throw serviceUnavailable(
        'PAYMENT_SERVICE_NOT_CONFIGURED',
        'Le service de paiement Jɛmɛnipay n’est pas configuré sur ce serveur.',
      );
    }

    // 3. Create local payment order record before external call
    const localPaymentId = newId();
    const finalIdempotencyKey = idempotencyKey ?? `idem_${localPaymentId}`;

    if (this.db) {
      await this.db.insert(payment).values({
        id: localPaymentId,
        userId,
        provider: 'jemenipay',
        idempotencyKey: finalIdempotencyKey,
        amountMinor: amount,
        currency: 'XOF',
        plan,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // 4. Perform real checkout initiation via Jemenipay Provider
    try {
      const checkoutRes = await this.jemenipay.initiateCheckout({
        userId,
        email,
        plan,
        amount,
        currency: 'XOF',
        paymentMethod,
        returnUrl,
      });

      // 5. Update local record with provider reference and checkout URL
      if (this.db) {
        await this.db
          .update(payment)
          .set({
            providerReference: checkoutRes.paymentId,
            checkoutUrl: checkoutRes.checkoutUrl,
            status: 'processing',
            updatedAt: new Date(),
          })
          .where(eq(payment.id, localPaymentId));
      }

      return {
        paymentId: checkoutRes.paymentId,
        checkoutUrl: checkoutRes.checkoutUrl,
        provider: 'jemenipay',
        status: 'pending',
      };
    } catch (err: any) {
      this.logger.error(`Jemenipay checkout failed for user ${userId}: ${err.message}`);
      if (this.db) {
        await this.db
          .update(payment)
          .set({
            status: 'failed',
            rawStatus: err.message,
            updatedAt: new Date(),
          })
          .where(eq(payment.id, localPaymentId));
      }
      throw badGateway('PAYMENT_INITIATION_FAILED', `Échec d’initialisation du paiement : ${err.message}`);
    }
  }

  async handleJemenipayWebhook(
    rawBody: Buffer | string,
    signature: string,
    timestamp?: string,
  ) {
    const verified = await this.jemenipay.verifyWebhook(rawBody, signature, timestamp);
    if (!verified.valid) {
      throw unauthorized('INVALID_SIGNATURE', 'Signature webhook Jemenipay invalide.');
    }

    if (!this.db) {
      this.logger.log(`Webhook Jemenipay validé sans base connectée : ${verified.paymentId}`);
      return { received: true, status: verified.status };
    }

    // Find local payment transaction
    const targetRef = verified.paymentId;
    const [local] = await this.db
      .select()
      .from(payment)
      .where(
        or(
          eq(payment.providerReference, targetRef),
          eq(payment.id, targetRef),
        ),
      )
      .limit(1);

    if (!local) {
      this.logger.warn(`Paiement local non trouvé pour la référence: ${targetRef}`);
      return { received: true, status: verified.status, warning: 'LOCAL_TRANSACTION_NOT_FOUND' };
    }

    // Strict idempotency: if already completed, acknowledge HTTP 200 without duplicate action
    if (local.status === 'succeeded') {
      return { received: true, status: 'succeeded', alreadyProcessed: true };
    }

    // Verify amount and currency
    if (local.amountMinor !== verified.amount || local.currency !== verified.currency) {
      this.logger.error(
        `Incohérence montant/devise pour paiement ${local.id}: local=${local.amountMinor} ${local.currency}, reçu=${verified.amount} ${verified.currency}`,
      );
      throw badRequest('PAYMENT_MISMATCH', 'Montant ou devise incohérente avec la commande initiale.');
    }

    if (verified.status === 'success') {
      const plan = (verified.metadata?.plan ?? local.plan) as PlanName;
      const isPromo = plan.endsWith('_promo');
      const durationDays = isPromo ? 7 : 30; // 7 days for promotions, 30 days for standard monthly subscriptions

      const now = new Date();
      const currentPeriodStart = now;
      const currentPeriodEnd = new Date(now.getTime() + durationDays * 86400 * 1000);

      await this.db.transaction(async (tx: any) => {
        // 1. Mark payment as succeeded
        await tx
          .update(payment)
          .set({
            status: 'succeeded',
            rawStatus: verified.externalReference ?? 'COMPLETED',
            updatedAt: now,
          })
          .where(eq(payment.id, local.id));

        // 2. Deactivate any previous active subscription for this user
        await tx
          .update(subscription)
          .set({
            status: 'canceled',
            updatedAt: now,
          })
          .where(
            and(
              eq(subscription.userId, local.userId),
              eq(subscription.status, 'active'),
            ),
          );

        // 3. Atomically activate new subscription with exact validity period
        await tx.insert(subscription).values({
          id: newId(),
          userId: local.userId,
          plan,
          status: 'active',
          provider: 'jemenipay',
          providerSubscriptionId: verified.externalReference ?? verified.paymentId,
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd: false,
          createdAt: now,
          updatedAt: now,
        });
      });

      this.logger.log(
        `Abonnement ${plan} (${durationDays}j) activé avec succès pour l'utilisateur ${local.userId} (Paiement: ${local.id})`,
      );

      return {
        received: true,
        status: 'succeeded',
        subscriptionActivated: true,
        plan,
        periodEnd: currentPeriodEnd.toISOString(),
      };
    } else {
      // Payment failed at provider
      await this.db
        .update(payment)
        .set({
          status: 'failed',
          rawStatus: verified.externalReference ?? 'FAILED',
          updatedAt: new Date(),
        })
        .where(eq(payment.id, local.id));

      return { received: true, status: 'failed' };
    }
  }
}
