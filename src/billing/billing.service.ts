import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, ne, or } from 'drizzle-orm';
import { badGateway, badRequest, serviceUnavailable, unauthorized } from '../common/errors';
import { newId } from '../common/ids';
import { DRIZZLE } from '../db/db.constants';
import { payment, subscription, user } from '../db/schema';
import { PlanName, PlansService } from '../plans/plans.service';
import { JemenipayProvider } from './providers/jemenipay.provider';
import { DodoPaymentsProvider } from './providers/dodo-payments.provider';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PaymentMethodType } from './providers/payment-provider.interface';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly jemenipay: JemenipayProvider,
    private readonly plans: PlansService,
    @Optional() @Inject(DRIZZLE) private readonly db?: any,
    @Optional() private readonly dodo?: DodoPaymentsProvider,
    @Optional() private readonly entitlements?: EntitlementsService,
  ) {}

  async checkout(
    userId: string,
    plan: 'plus' | 'pro' | 'plus_promo' | 'pro_promo',
    paymentMethod: PaymentMethodType = 'orange_money_mali',
    returnUrl?: string,
    idempotencyKey?: string,
    providerName: 'jemenipay' | 'dodo_payments' = 'jemenipay',
  ) {
    const prices = this.plans.getPrices();
    const amount = prices[plan];
    if (!amount || amount <= 0) {
      throw badRequest('INVALID_PLAN', 'Plan payant invalide ou gratuit.');
    }

    // 1. Idempotency: if the client supplied a key and a transaction already exists, return it.
    if (idempotencyKey && this.db) {
      const [existing] = await this.db
        .select()
        .from(payment)
        .where(and(eq(payment.userId, userId), eq(payment.idempotencyKey, idempotencyKey)))
        .limit(1);

      if (existing) {
        if (existing.status === 'failed' || existing.status === 'cancelled' || existing.status === 'refunded') {
          // Allow a fresh attempt for a definitively failed/cancelled transaction by continuing.
        } else {
          this.logger.log(`Returning existing payment ${existing.id} for idempotency key ${idempotencyKey}`);
          return {
            paymentId: existing.providerReference ?? existing.id,
            checkoutUrl: existing.checkoutUrl,
            provider: existing.provider,
            status: existing.status === 'succeeded' ? 'succeeded' : 'pending',
          };
        }
      }
    }

    // 2. Fetch authentic user email from database
    if (!this.db) {
      throw serviceUnavailable('DATABASE_UNAVAILABLE', 'Base de données indisponible pour le paiement.');
    }

    const [usr] = await this.db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!usr?.email) {
      throw badRequest('USER_NOT_FOUND', 'Utilisateur introuvable pour ce paiement.');
    }
    const email = usr.email;

    // 3. Verify the selected provider configuration without changing the legacy Jɛmɛnipay default.
    const providerConfigured = providerName === 'dodo_payments'
      ? Boolean(this.dodo?.isConfiguredForPlan(plan))
      : this.jemenipay.isConfigured();
    if (!providerConfigured) {
      throw serviceUnavailable(
        'PAYMENT_SERVICE_NOT_CONFIGURED',
        providerName === 'dodo_payments'
          ? 'Le service Dodo Payments ou le produit correspondant n’est pas configuré sur ce serveur.'
          : 'Le service de paiement Jɛmɛnipay n’est pas configuré sur ce serveur.',
      );
    }

    // 4. Create local payment order record before external call
    const localPaymentId = newId();
    const finalIdempotencyKey = idempotencyKey ?? `idem_${localPaymentId}`;

    try {
      await this.db.insert(payment).values({
        id: localPaymentId,
        userId,
        provider: providerName,
        idempotencyKey: finalIdempotencyKey,
        amountMinor: amount,
        currency: 'XOF',
        plan,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (err: any) {
      // Race: another concurrent checkout request already created this payment
      const isUniqueConflict =
        err?.code === '23505' ||
        String(err?.message).includes('duplicate key') ||
        String(err?.message).includes('payment_user_idempotency_uq');

      if (isUniqueConflict) {
        const [existing] = await this.db
          .select()
          .from(payment)
          .where(and(eq(payment.userId, userId), eq(payment.idempotencyKey, finalIdempotencyKey)))
          .limit(1);
        if (existing) {
          return {
            paymentId: existing.providerReference ?? existing.id,
            checkoutUrl: existing.checkoutUrl,
            provider: existing.provider,
            status: existing.status === 'succeeded' ? 'succeeded' : 'pending',
          };
        }
      }
      throw err;
    }

    // 5. Perform real checkout initiation via Jemenipay Provider
    try {
      const checkoutRes = providerName === 'dodo_payments'
        ? await this.dodo!.initiateCheckout({
            userId, email, plan, amount, currency: 'XOF', paymentMethod: 'card', returnUrl,
            localPaymentId, idempotencyKey: finalIdempotencyKey,
          })
        : await this.jemenipay.initiateCheckout({
            userId, email, plan, amount, currency: 'XOF', paymentMethod, returnUrl,
            localPaymentId, idempotencyKey: finalIdempotencyKey,
          });

      if (!checkoutRes?.paymentId || !checkoutRes?.checkoutUrl) {
        throw new Error('Réponse Jɛmɛnipay incomplète (paymentId ou checkoutUrl manquant).');
      }

      // 6. Update local record with provider reference and checkout URL
      await this.db
        .update(payment)
        .set({
          providerReference: checkoutRes.paymentId,
          checkoutUrl: checkoutRes.checkoutUrl,
          status: 'processing',
          updatedAt: new Date(),
        })
        .where(eq(payment.id, localPaymentId));

      return {
        paymentId: checkoutRes.paymentId,
        checkoutUrl: checkoutRes.checkoutUrl,
        provider: providerName,
        status: 'pending',
      };
    } catch (err: any) {
      this.logger.error(`${providerName} checkout failed for user ${userId}: ${err.message}`);
      await this.db
        .update(payment)
        .set({
          status: 'failed',
          rawStatus: err.message,
          updatedAt: new Date(),
        })
        .where(eq(payment.id, localPaymentId));
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

    // Provider reference must match the local record when it was stored.
    if (local.providerReference && targetRef && local.providerReference !== targetRef && local.id !== targetRef) {
      throw badRequest('PAYMENT_REFERENCE_MISMATCH', 'Référence de paiement inconnue.');
    }

    // Strict idempotency: if already completed, acknowledge without duplicate action
    if (local.status === 'succeeded') {
      return { received: true, status: 'succeeded', alreadyProcessed: true };
    }

    // Invalid transitions
    if (local.status === 'failed' || local.status === 'cancelled' || local.status === 'refunded') {
      throw badRequest('INVALID_PAYMENT_TRANSITION', 'Transition de paiement invalide.');
    }

    // Verify amount and currency
    if (local.amountMinor !== verified.amount || local.currency !== verified.currency) {
      this.logger.error(
        `Incohérence montant/devise pour paiement ${local.id}: local=${local.amountMinor} ${local.currency}, reçu=${verified.amount} ${verified.currency}`,
      );
      throw badRequest('PAYMENT_MISMATCH', 'Montant ou devise incohérente avec la commande initiale.');
    }

    // Verify plan and user from local data, never trust webhook alone.
    const webhookPlan = verified.metadata?.plan;
    if (webhookPlan && webhookPlan !== local.plan) {
      throw badRequest('PLAN_MISMATCH', 'Le plan du webhook ne correspond pas à la commande locale.');
    }
    const webhookUser = verified.metadata?.userId ?? verified.metadata?.user_id;
    if (webhookUser && webhookUser !== local.userId) {
      throw badRequest('USER_MISMATCH', 'L’utilisateur du webhook ne correspond pas à la commande locale.');
    }

    const plan = local.plan as PlanName;

    if (verified.status === 'success') {
      const isPromo = String(plan).endsWith('_promo');
      const durationDays = isPromo ? 7 : 30;

      const now = new Date();
      const currentPeriodStart = now;
      const currentPeriodEnd = new Date(now.getTime() + durationDays * 86400 * 1000);

      await this.db.transaction(async (tx: any) => {
        // Re-check idempotency inside the transaction (concurrent webhooks) when supported.
        if (typeof tx.select === 'function') {
          const [fresh] = await tx.select().from(payment).where(eq(payment.id, local.id)).limit(1);
          if (fresh?.status === 'succeeded') {
            return;
          }
          if (fresh && (fresh.status === 'failed' || fresh.status === 'cancelled' || fresh.status === 'refunded')) {
            throw badRequest('INVALID_PAYMENT_TRANSITION', 'Transition de paiement invalide.');
          }
        }

        // 1. Mark payment as succeeded ONLY IF still pending or processing (atomic CAS)
        const updateQuery = tx
          .update(payment)
          .set({
            status: 'succeeded',
            rawStatus: verified.externalReference ?? 'COMPLETED',
            updatedAt: now,
          })
          .where(
            and(
              eq(payment.id, local.id),
              or(eq(payment.status, 'pending'), eq(payment.status, 'processing')),
            ),
          );

        if (typeof (updateQuery as any)?.returning === 'function') {
          const updated = await (updateQuery as any).returning({ id: payment.id });
          if (updated && updated.length === 0) {
            return; // Already processed concurrently
          }
        } else {
          await updateQuery;
        }

        // 2. Centralize subscription rights through EntitlementsModule.
        if (this.entitlements) {
          await this.entitlements.activateSubscription({
            userId: local.userId,
            plan,
            status: 'active',
            provider: 'jemenipay',
            providerSubscriptionId: verified.externalReference ?? verified.paymentId,
            currentPeriodStart,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
          }, tx);
        } else {
          // Compatibility fallback for isolated legacy unit tests.
          await tx.update(subscription).set({ status: 'canceled', updatedAt: now }).where(and(
            eq(subscription.userId, local.userId),
            eq(subscription.status, 'active'),
          ));
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
        }
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
      // Payment failed at provider (must NEVER overwrite an already succeeded payment)
      await this.db
        .update(payment)
        .set({
          status: 'failed',
          rawStatus: verified.externalReference ?? 'FAILED',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payment.id, local.id),
            ne(payment.status, 'succeeded'),
          ),
        );

      return { received: true, status: 'failed' };
    }
  }
}

