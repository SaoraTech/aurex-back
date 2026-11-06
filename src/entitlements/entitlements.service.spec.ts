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

  it('records a provider subscription without falsely canceling another provider subscription', async () => {
    const tx = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([]),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn().mockResolvedValue([{
            id: 'sub_new',
            userId: 'user_1',
            plan: 'pro',
            provider: 'dodo_payments',
            providerSubscriptionId: 'dodo_sub_1',
            status: 'active',
          }]),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn().mockResolvedValue([]),
        })),
      })),
    };
    const db = { transaction: jest.fn(async (callback: (executor: any) => Promise<any>) => callback(tx)) };
    const plans = { getSubscriptionInfo: jest.fn(), getLimits: jest.fn() };
    const notificationSubscribers = { sync: jest.fn().mockResolvedValue({ sent: true }) };
    const service = new EntitlementsService(plans as any, db as any, notificationSubscribers as any);

    const result = await service.activateSubscription({
      userId: 'user_1',
      plan: 'pro',
      provider: 'dodo_payments',
      providerSubscriptionId: 'dodo_sub_1',
      status: 'active',
      currentPeriodStart: new Date('2026-11-06T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-12-06T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
    });

    expect(result.id).toBe('sub_new');
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
    expect(notificationSubscribers.sync).toHaveBeenCalledWith('user_1');
  });

  it('expires elapsed subscriptions and refreshes each affected Novu audience once', async () => {
    const due = [
      { id: 'sub_1', userId: 'user_1' },
      { id: 'sub_2', userId: 'user_1' },
      { id: 'sub_3', userId: 'user_2' },
    ];
    const db = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue(due),
            })),
          })),
        })),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({
            returning: jest.fn().mockResolvedValue([{ userId: 'user_1' }, { userId: 'user_2' }]),
          })),
        })),
      })),
    };
    const notificationSubscribers = { sync: jest.fn().mockResolvedValue({ sent: true }) };
    const service = new EntitlementsService({} as any, db as any, notificationSubscribers as any);

    await expect(service.expireElapsedSubscriptions()).resolves.toEqual({
      expiredSubscriptions: 2,
      usersSynced: 2,
    });
    expect(notificationSubscribers.sync).toHaveBeenCalledTimes(2);
    expect(notificationSubscribers.sync).toHaveBeenCalledWith('user_1');
    expect(notificationSubscribers.sync).toHaveBeenCalledWith('user_2');
  });

});
