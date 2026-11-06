import { EntitlementsService } from './entitlements.service';

describe('EntitlementsService', () => {
  it('returns the server-resolved plan and its quota policy', async () => {
    const plans = {
      getSubscriptionInfo: jest.fn().mockResolvedValue({
        plan: 'plus_promo',
        commercialTier: 'plus',
        status: 'active',
        isPromo: true,
        currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-11-08T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
      }),
      getLimits: jest.fn().mockReturnValue({ dailyMessages: 100 }),
    };
    const service = new EntitlementsService(plans as any);

    await expect(service.getForUser('user_1')).resolves.toEqual({
      plan: 'plus_promo',
      tier: 'plus',
      subscription: {
        status: 'active',
        isPromo: true,
        currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-11-08T00:00:00.000Z'),
        cancelAtPeriodEnd: false,
      },
      quotas: { dailyMessages: 100 },
    });
    expect(plans.getSubscriptionInfo).toHaveBeenCalledWith('user_1');
    expect(plans.getLimits).toHaveBeenCalledWith('plus_promo');
  });
});
