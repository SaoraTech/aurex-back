import * as crypto from 'crypto';
import { BillingService } from './billing.service';
import { JemenipayProvider } from './providers/jemenipay.provider';

describe('BillingService & JemenipayProvider', () => {
  let svc: BillingService;
  let jemenipay: JemenipayProvider;
  let plans: any;
  let mockDb: any;
  const webhookSecret = 'test_webhook_secret_key_12345';
  const apiKey = 'pk_test_api_key_67890';
  const secretKey = 'sk_test_secret_key_67890';

  beforeEach(() => {
    const cfg: any = {
      get: (k: string) =>
        ({
          jemenipayApiKey: apiKey,
          jemenipaySecretKey: secretKey,
          jemenipayWebhookSecret: webhookSecret,
          jemenipayEnv: 'sandbox',
        })[k],
    };

    jemenipay = new JemenipayProvider(cfg);

    plans = {
      getPrices: () => ({
        free: 0,
        plus: 5000,
        pro: 10000,
        plus_promo: 1500,
        pro_promo: 3000,
      }),
    };

    mockDb = {
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue([
              {
                id: 'pay_1',
                userId: 'u1',
                plan: 'plus',
                amountMinor: 5000,
                currency: 'XOF',
                status: 'pending',
                providerReference: 'jem_ref_123',
                email: 'user1@saora.tech',
              },
            ]),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        values: jest.fn().mockResolvedValue(undefined),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => {
          const whereObj: any = jest.fn().mockResolvedValue([{ id: 'mock_id' }]);
          whereObj.returning = jest.fn().mockResolvedValue([{ id: 'mock_id' }]);
          return { where: whereObj };
        }),
      })),
      transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
        const tx = {
          insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
          update: jest.fn(() => ({
            set: jest.fn(() => {
              const whereObj: any = jest.fn().mockResolvedValue([{ id: 'mock_id' }]);
              whereObj.returning = jest.fn().mockResolvedValue([{ id: 'mock_id' }]);
              return { where: whereObj };
            }),
          })),
        };
        return cb(tx);
      }),
    };

    svc = new BillingService(jemenipay, plans, mockDb);

    // Mock fetch for remote Jɛmɛnipay endpoints
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'pending',
        paymentId: 'jem_remote_987',
        checkoutUrl: 'https://jemeni.net/api/sandbox/checkout/jem_remote_987',
      }),
    });
  });

  it('initiates real Jemenipay checkout for Plus plan in FCFA', async () => {
    const res = await svc.checkout('u1', 'plus', 'orange_money_mali');
    expect(res.provider).toBe('jemenipay');
    expect(res.paymentId).toBe('jem_remote_987');
    expect(res.checkoutUrl).toContain('checkout');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://jemeni.net/api/sandbox/payments/checkout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'auth-apiKey': apiKey,
          'sandbox': 'true',
        }),
      }),
    );
  });

  it('initiates Jemenipay checkout for 7-day promo offer (1500 FCFA)', async () => {
    const res = await svc.checkout('u1', 'plus_promo', 'moov_africa_mali');
    expect(res.status).toBe('pending');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('rejects invalid plan names', async () => {
    await expect(svc.checkout('u1', 'invalid' as any)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects webhooks with invalid HMAC signatures', async () => {
    const raw = Buffer.from(JSON.stringify({ status: 'SUCCESS', reference: 'p1' }));
    await expect(svc.handleJemenipayWebhook(raw, 'bad_signature')).rejects.toMatchObject({
      status: 401,
    });
  });

  it('validates authentic webhook signature and activates subscription atomically', async () => {
    const payload = JSON.stringify({
      status: 'SUCCESS',
      reference: 'jem_ref_123',
      transactionId: 'tx_jemenipay_001',
      amount: 5000,
      currency: 'XOF',
      metadata: { plan: 'plus', userId: 'u1' },
    });

    const validSignature = crypto
      .createHmac('sha512', webhookSecret)
      .update(payload)
      .digest('hex');

    const res = await svc.handleJemenipayWebhook(Buffer.from(payload), validSignature);
    expect(res.received).toBe(true);
    expect(res.status).toBe('succeeded');
    expect(res.subscriptionActivated).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('enforces idempotency on webhook if already succeeded', async () => {
    mockDb.select = jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue([
            {
              id: 'pay_1',
              userId: 'u1',
              plan: 'plus',
              amountMinor: 5000,
              currency: 'XOF',
              status: 'succeeded', // already processed!
              providerReference: 'jem_ref_123',
            },
          ]),
        })),
      })),
    }));

    const payload = JSON.stringify({
      status: 'SUCCESS',
      reference: 'jem_ref_123',
      amount: 5000,
      currency: 'XOF',
    });

    const validSignature = crypto
      .createHmac('sha512', webhookSecret)
      .update(payload)
      .digest('hex');

    const res = await svc.handleJemenipayWebhook(Buffer.from(payload), validSignature);
    expect(res.alreadyProcessed).toBe(true);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('rejects webhook when amount mismatches initial order', async () => {
    const payload = JSON.stringify({
      status: 'SUCCESS',
      reference: 'jem_ref_123',
      amount: 1000, // tampered amount
      currency: 'XOF',
    });

    const validSignature = crypto
      .createHmac('sha512', webhookSecret)
      .update(payload)
      .digest('hex');

    await expect(
      svc.handleJemenipayWebhook(Buffer.from(payload), validSignature),
    ).rejects.toMatchObject({
      status: 400,
    });
  });
});

