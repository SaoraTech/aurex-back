import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { badGateway, badRequest, notFound, unauthorized } from '../common/errors';
import { newId } from '../common/ids';
import { DRIZZLE } from '../db/db.constants';
import { billingWebhookEvent, payment, subscription, user } from '../db/schema';
import { DodoPaymentsProvider } from './providers/dodo-payments.provider';
import { RevenueCatProvider } from './providers/revenuecat.provider';
import { HuaweiIapProvider } from './providers/huawei-iap.provider';
import { EntitlementsService } from '../entitlements/entitlements.service';

@Injectable()
export class BillingWebhooksService {
  private readonly logger = new Logger(BillingWebhooksService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly dodo: DodoPaymentsProvider,
    private readonly revenueCat: RevenueCatProvider,
    private readonly huawei: HuaweiIapProvider,
    private readonly entitlements: EntitlementsService,
  ) {}

  async handleDodo(rawBody: Buffer | string, headers: {
    webhookId?: string;
    webhookTimestamp?: string;
    webhookSignature?: string;
  }) {
    let event;
    try {
      event = this.dodo.verifyWebhook(rawBody, headers);
    } catch {
      throw unauthorized('INVALID_DODO_SIGNATURE', 'Signature du webhook Dodo Payments invalide.');
    }

    return this.processEvent('dodo_payments', event.eventId, event.type, () => this.applyDodoEvent(event));
  }

  async handleRevenueCat(rawBody: Buffer | string, authorization?: string, signature?: string) {
    let event;
    try {
      event = this.revenueCat.verifyWebhook(rawBody, authorization, signature);
    } catch {
      throw unauthorized('INVALID_REVENUECAT_WEBHOOK', 'Authentification ou signature RevenueCat invalide.');
    }

    return this.processEvent('revenuecat', event.id, event.type, () => this.applyRevenueCatEvent(event));
  }

  async handleHuawei(rawBody: Buffer | string) {
    let notification: Record<string, any>;
    try {
      notification = this.huawei.verifyNotification(rawBody);
    } catch {
      throw unauthorized('INVALID_HUAWEI_SIGNATURE', 'Signature de notification Huawei IAP invalide.');
    }

    const purchaseToken = String(notification.purchaseToken ?? '');
    const subscriptionId = String(notification.subscriptionId ?? '');
    if (!purchaseToken || !subscriptionId) {
      throw badRequest('INVALID_HUAWEI_NOTIFICATION', 'La notification Huawei ne contient pas le purchaseToken et subscriptionId requis.');
    }

    const eventId = String(
      notification.notificationId ??
      notification.eventId ??
      `${subscriptionId}:${notification.notificationType ?? 'subscription'}:${purchaseToken}`,
    );
    const eventType = String(notification.notificationType ?? 'subscription.status_changed');

    return this.processEvent('huawei_iap', eventId, eventType, async () => {
      const verified = await this.huawei.verifySubscriptionToken(purchaseToken, subscriptionId);
      const [account] = await this.db.select({ id: user.id }).from(user).where(eq(user.id, verified.userId)).limit(1);
      if (!account) throw notFound('HUAWEI_USER_NOT_FOUND', 'Utilisateur Aurex associé à cet achat introuvable.');

      await this.upsertSubscription({
        userId: verified.userId,
        plan: verified.plan,
        provider: 'huawei_iap',
        providerSubscriptionId: verified.subscriptionId,
        status: verified.isActive ? 'active' : 'expired',
        currentPeriodStart: verified.purchaseTime,
        currentPeriodEnd: verified.expirationDate,
        cancelAtPeriodEnd: !verified.isAutoRenewing,
      });

      return {
        status: verified.isActive ? 'active' : 'expired',
        plan: verified.isActive ? verified.plan : 'free',
        providerSubscriptionId: verified.subscriptionId,
      };
    });
  }

  private async processEvent(provider: string, eventId: string, eventType: string, handler: () => Promise<Record<string, unknown>>) {
    const now = new Date();
    const [created] = await this.db.insert(billingWebhookEvent).values({
      id: newId(),
      provider,
      providerEventId: eventId,
      eventType,
      status: 'processing',
      attempts: 1,
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning();

    if (!created) {
      const [existing] = await this.db.select().from(billingWebhookEvent).where(and(
        eq(billingWebhookEvent.provider, provider),
        eq(billingWebhookEvent.providerEventId, eventId),
      )).limit(1);

      if (existing?.status === 'processed') {
        return { received: true, duplicate: true, status: existing.status };
      }

      // A process can crash after claiming an event. Reclaim only failed events or
      // processing leases older than five minutes; the conditional UPDATE is the
      // concurrency gate so only one webhook delivery can acquire the lease.
      const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
      const retryCondition = existing?.status === 'failed'
        ? eq(billingWebhookEvent.status, 'failed')
        : existing?.status === 'processing'
          ? and(
              eq(billingWebhookEvent.status, 'processing'),
              lte(billingWebhookEvent.updatedAt, staleBefore),
            )
          : undefined;

      if (!retryCondition) {
        if (existing?.status === 'processing') {
          // Do not acknowledge an event that is still being processed: a provider
          // retry is the recovery path if the worker crashes before completion.
          throw badGateway('BILLING_WEBHOOK_IN_PROGRESS', 'Un événement identique est déjà en cours de traitement. Réessayez ultérieurement.');
        }
        return { received: true, duplicate: true, status: existing?.status ?? 'processing' };
      }

      const [retry] = await this.db.update(billingWebhookEvent).set({
        status: 'processing',
        attempts: sql`${billingWebhookEvent.attempts} + 1`,
        errorCode: null,
        updatedAt: now,
      }).where(and(
        eq(billingWebhookEvent.provider, provider),
        eq(billingWebhookEvent.providerEventId, eventId),
        retryCondition,
      )).returning();

      if (!retry) return { received: true, duplicate: true, status: 'processing' };
    }

    try {
      const result = await handler();
      await this.db.update(billingWebhookEvent).set({
        status: 'processed',
        processedAt: new Date(),
        errorCode: null,
        updatedAt: new Date(),
      }).where(and(
        eq(billingWebhookEvent.provider, provider),
        eq(billingWebhookEvent.providerEventId, eventId),
      ));
      return { received: true, duplicate: false, ...result };
    } catch (error) {
      this.logger.error({
        msg: 'billing_webhook_processing_failed',
        provider,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.db.update(billingWebhookEvent).set({
        status: 'failed',
        errorCode: error instanceof Error ? error.message.slice(0, 500) : 'PROCESSING_FAILED',
        updatedAt: new Date(),
      }).where(and(
        eq(billingWebhookEvent.provider, provider),
        eq(billingWebhookEvent.providerEventId, eventId),
      ));
      throw badGateway('BILLING_WEBHOOK_PROCESSING_FAILED', 'Le webhook de paiement n’a pas pu être traité. Le fournisseur pourra réessayer.');
    }
  }

  private async applyDodoEvent(event: { type: string; data: Record<string, any> }) {
    const data = event.data;
    const metadata = data.metadata ?? data.subscription?.metadata ?? {};
    const localPaymentId = String(metadata.localPaymentId ?? '');
    const providerSubscriptionId = String(data.subscription_id ?? data.subscription?.id ?? '');

    let localPayment: any;
    if (localPaymentId) {
      const [row] = await this.db.select().from(payment).where(and(
        eq(payment.id, localPaymentId),
        eq(payment.provider, 'dodo_payments'),
      )).limit(1);
      localPayment = row;
    }

    let currentSubscription: any;
    if (!localPayment && providerSubscriptionId) {
      const [row] = await this.db.select().from(subscription).where(and(
        eq(subscription.provider, 'dodo_payments'),
        eq(subscription.providerSubscriptionId, providerSubscriptionId),
      )).limit(1);
      currentSubscription = row;
    }

    const userId = localPayment?.userId ?? currentSubscription?.userId ?? String(metadata.userId ?? '');
    const plan = localPayment?.plan ?? currentSubscription?.plan ?? metadata.plan;
    if (!userId || !plan) {
      this.logger.warn({ msg: 'dodo_webhook_local_reference_missing', eventType: event.type });
      return { ignored: true, reason: 'LOCAL_REFERENCE_NOT_FOUND' };
    }
    if (metadata.userId && metadata.userId !== userId) throw badRequest('DODO_USER_MISMATCH', 'Utilisateur Dodo incohérent.');
    if (metadata.plan && metadata.plan !== plan) throw badRequest('DODO_PLAN_MISMATCH', 'Plan Dodo incohérent.');

    if (localPayment && data.currency && String(data.currency).toUpperCase() !== localPayment.currency) {
      throw badRequest('DODO_CURRENCY_MISMATCH', 'La devise Dodo ne correspond pas à la commande.');
    }
    const receivedAmount = data.total_amount ?? data.amount;
    if (localPayment && receivedAmount !== undefined && Number(receivedAmount) !== Number(localPayment.amountMinor)) {
      throw badRequest('DODO_AMOUNT_MISMATCH', 'Le montant Dodo ne correspond pas à la commande.');
    }

    const type = event.type.toLowerCase();
    if (type === 'payment.failed') {
      if (localPayment) await this.db.update(payment).set({ status: 'failed', rawStatus: type, updatedAt: new Date() }).where(eq(payment.id, localPayment.id));
      return { status: 'failed' };
    }

    if (type === 'refund.succeeded' || type === 'payment.refunded') {
      if (localPayment) await this.db.update(payment).set({ status: 'refunded', rawStatus: type, updatedAt: new Date() }).where(eq(payment.id, localPayment.id));
      if (providerSubscriptionId) {
        await this.db.update(subscription).set({ status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date() }).where(and(
          eq(subscription.provider, 'dodo_payments'),
          eq(subscription.providerSubscriptionId, providerSubscriptionId),
        ));
      }
      return { status: 'refunded' };
    }

    if (type === 'subscription.cancelled' || type === 'subscription.canceled') {
      const end = this.toDate(data.current_period_end ?? data.next_billing_date);
      await this.db.update(subscription).set({
        status: end && end > new Date() ? 'active' : 'canceled',
        cancelAtPeriodEnd: Boolean(end && end > new Date()),
        currentPeriodEnd: end ?? undefined,
        updatedAt: new Date(),
      }).where(and(
        eq(subscription.provider, 'dodo_payments'),
        eq(subscription.providerSubscriptionId, providerSubscriptionId),
      ));
      return { status: 'canceled' };
    }

    if (type === 'subscription.on_hold') {
      await this.db.update(subscription).set({ status: 'past_due', updatedAt: new Date() }).where(and(
        eq(subscription.provider, 'dodo_payments'),
        eq(subscription.providerSubscriptionId, providerSubscriptionId),
      ));
      return { status: 'past_due' };
    }

    if (type === 'payment.succeeded' || type === 'subscription.active' || type === 'subscription.renewed') {
      if (!providerSubscriptionId) {
        throw badRequest('DODO_SUBSCRIPTION_ID_MISSING', 'L’événement Dodo ne contient pas de référence d’abonnement vérifiable.');
      }
      const now = new Date();
      if (localPayment) {
        await this.db.update(payment).set({ status: 'succeeded', rawStatus: type, updatedAt: now })
          .where(and(eq(payment.id, localPayment.id), eq(payment.provider, 'dodo_payments')));
      }
      const durationDays = String(plan).endsWith('_promo') ? 7 : 30;
      const start = this.toDate(data.current_period_start ?? data.created_at) ?? now;
      const end = this.toDate(data.current_period_end ?? data.next_billing_date ?? data.expires_at)
        ?? new Date(start.getTime() + durationDays * 86400 * 1000);

      await this.upsertSubscription({
        userId,
        plan,
        provider: 'dodo_payments',
        providerSubscriptionId,
        status: 'active',
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
      });
      return { status: 'active', plan, periodEnd: end.toISOString() };
    }

    return { ignored: true, reason: 'UNSUPPORTED_EVENT_TYPE' };
  }

  private async applyRevenueCatEvent(event: {
    appUserId: string;
    originalAppUserId?: string;
  }) {
    const response = await this.revenueCat.getSubscriber(event.appUserId);
    const subscriber = response.subscriber ?? response;
    const entitlements = subscriber.entitlements ?? {};
    const ids = this.revenueCat.getEntitlementIds();
    const now = new Date();

    const isActive = (entry: any) => {
      if (!entry) return false;
      if (!entry.expires_date) return true;
      const expiry = new Date(entry.expires_date);
      return Number.isFinite(expiry.getTime()) && expiry > now;
    };

    const proEntitlement = entitlements[ids.pro ?? ''];
    const plusEntitlement = entitlements[ids.plus ?? ''];
    const plan = isActive(proEntitlement) ? 'pro' : isActive(plusEntitlement) ? 'plus' : null;
    const activeEntitlement = plan === 'pro' ? proEntitlement : plan === 'plus' ? plusEntitlement : null;

    const candidates = [event.appUserId, event.originalAppUserId].filter(Boolean) as string[];
    let userId: string | undefined;
    for (const candidate of candidates) {
      const [found] = await this.db.select({ id: user.id }).from(user).where(eq(user.id, candidate)).limit(1);
      if (found) { userId = found.id; break; }
    }
    if (!userId) throw notFound('REVENUECAT_USER_NOT_FOUND', 'Utilisateur Aurex associé à l’achat RevenueCat introuvable.');

    if (!plan) {
      await this.entitlements.expireProviderSubscriptions(userId, 'revenuecat');
      return { status: 'expired', plan: 'free' };
    }

    const periodStart = this.toDate(activeEntitlement.purchase_date) ?? now;
    const periodEnd = this.toDate(activeEntitlement.expires_date);
    const providerSubscriptionId = String(subscriber.original_app_user_id ?? event.originalAppUserId ?? event.appUserId);
    await this.upsertSubscription({
      userId,
      plan,
      provider: 'revenuecat',
      providerSubscriptionId,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });

    return { status: 'active', plan, periodEnd: periodEnd?.toISOString() ?? null };
  }

  private async upsertSubscription(input: {
    userId: string;
    plan: string;
    provider: string;
    providerSubscriptionId: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
  }) {
    return this.entitlements.activateSubscription(input);
  }

  private toDate(value: unknown): Date | null {
    if (value === undefined || value === null || value === '') return null;
    const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date : null;
  }
}
