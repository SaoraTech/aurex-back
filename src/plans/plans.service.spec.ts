import { PlansService } from './plans.service';

describe('PlansService - Pricing, Promotions & Retention', () => {
  let svc: PlansService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: jest.fn(),
    };
    svc = new PlansService(undefined, mockDb);
  });

  it('provides official Saora prices for all tiers including 7-day promotions', () => {
    const prices = svc.getPrices();
    expect(prices.free).toBe(0);
    expect(prices.plus).toBe(5000);
    expect(prices.pro).toBe(10000);
    expect(prices.plus_promo).toBe(1500);
    expect(prices.pro_promo).toBe(3000);
  });

  it('lists plans indicating exact promotional duration of 7 days', () => {
    const list = svc.list();
    const plusPromo = list.find(p => p.id === 'plus_promo');
    const proPromo = list.find(p => p.id === 'pro_promo');
    const plus = list.find(p => p.id === 'plus');

    expect(plusPromo?.isPromotion).toBe(true);
    expect(plusPromo?.durationDays).toBe(7);
    expect(proPromo?.isPromotion).toBe(true);
    expect(proPromo?.durationDays).toBe(7);
    expect(plus?.durationDays).toBe(30);
  });

  it('preserves plus_promo identity without converting prematurely to standard plus', async () => {
    const futureDate = new Date(Date.now() + 5 * 86400 * 1000); // 5 days left in 7-day promo
    mockDb.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([
              {
                plan: 'plus_promo',
                status: 'active',
                currentPeriodStart: new Date(),
                currentPeriodEnd: futureDate,
                cancelAtPeriodEnd: false,
              },
            ]),
          })),
        })),
      })),
    });

    const plan = await svc.getEffectivePlan('u1');
    expect(plan).toBe('plus_promo');

    const info = await svc.getSubscriptionInfo('u1');
    expect(info.plan).toBe('plus_promo');
    expect(info.isPromo).toBe(true);
    expect(info.commercialTier).toBe('plus');
    expect(info.status).toBe('active');
  });

  it('preserves pro_promo identity for active promotional subscribers', async () => {
    const futureDate = new Date(Date.now() + 3 * 86400 * 1000);
    mockDb.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([
              {
                plan: 'pro_promo',
                status: 'active',
                currentPeriodStart: new Date(),
                currentPeriodEnd: futureDate,
                cancelAtPeriodEnd: false,
              },
            ]),
          })),
        })),
      })),
    });

    const plan = await svc.getEffectivePlan('u2');
    expect(plan).toBe('pro_promo');
  });

  it('reverts to free plan when subscription is expired or none found', async () => {
    mockDb.select.mockReturnValue({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          orderBy: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([]),
          })),
        })),
      })),
    });

    const plan = await svc.getEffectivePlan('u3');
    expect(plan).toBe('free');
  });
});
