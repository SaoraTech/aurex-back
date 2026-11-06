import { BillingWebhooksService } from './billing-webhooks.service';

describe('BillingWebhooksService', () => {
  const createService = (subscriber: Record<string, any>) => {
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([{ id: 'user_1' }]),
          })),
        })),
      })),
    };
    const revenueCat = {
      getEntitlementIds: jest.fn().mockReturnValue({ plus: 'aurex_plus', pro: 'aurex_pro' }),
      getSubscriber: jest.fn().mockResolvedValue({ subscriber }),
    };
    const entitlements = {
      activateSubscription: jest.fn().mockResolvedValue({ id: 'sub_1' }),
      expireProviderSubscriptions: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BillingWebhooksService(
      db as any,
      {} as any,
      revenueCat as any,
      {} as any,
      entitlements as any,
    );
    return { service, db, revenueCat, entitlements };
  };

  it('keeps RevenueCat access through the later grace-period expiry', async () => {
    const graceExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { service, entitlements } = createService({
      original_app_user_id: 'user_1',
      entitlements: {
        aurex_plus: {
          purchase_date: '2026-11-01T00:00:00.000Z',
          expires_date: '2026-11-05T00:00:00.000Z',
          grace_period_expires_date: graceExpiry.toISOString(),
        },
      },
    });

    await (service as any).applyRevenueCatEvent({ appUserId: 'user_1', type: 'BILLING_ISSUE' });

    expect(entitlements.activateSubscription).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user_1',
      provider: 'revenuecat',
      plan: 'plus',
      status: 'active',
      currentPeriodEnd: graceExpiry,
    }));
  });

  it('expires RevenueCat access when no configured entitlement remains active', async () => {
    const { service, entitlements } = createService({
      original_app_user_id: 'user_1',
      entitlements: {},
    });

    await (service as any).applyRevenueCatEvent({ appUserId: 'user_1', type: 'EXPIRATION' });

    expect(entitlements.expireProviderSubscriptions).toHaveBeenCalledWith('user_1', 'revenuecat');
    expect(entitlements.activateSubscription).not.toHaveBeenCalled();
  });
});
