import { BillingService } from './billing.service';
import { JemenipayProvider } from './providers/jemenipay.provider';

describe('BillingService & JemenipayProvider', () => {
  let svc: BillingService;
  let jemenipay: JemenipayProvider;
  let plans: any;

  beforeEach(() => {
    const cfg: any = {
      get: (k: string) => ({
        jemenipayApiKey: 'api_test',
        jemenipaySecretKey: 'secret_test',
        jemenipayWebhookSecret: 'webhook_secret',
        jemenipayEnv: 'sandbox',
      }[k]),
    };
    jemenipay = new JemenipayProvider(cfg);
    plans = {};
    svc = new BillingService(jemenipay, plans);
  });

  it('initiates Jemenipay checkout for Plus plan in FCFA', async () => {
    const res = await svc.checkout('u1', 'u1@test.com', 'plus', 'orange_money_mali');
    expect(res.provider).toBe('jemenipay');
    expect(res.paymentId).toBeDefined();
    expect(res.status).toBe('pending');
  });

  it('initiates Jemenipay checkout for 7-day promo offer (1500 FCFA)', async () => {
    const res = await svc.checkout('u1', 'u1@test.com', 'plus_promo', 'moov_africa_mali');
    expect(res.status).toBe('pending');
  });

  it('rejects invalid plan names', async () => {
    await expect(svc.checkout('u1', 'u1@test.com', 'invalid' as any)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects webhooks with invalid HMAC signatures', async () => {
    const raw = Buffer.from(JSON.stringify({ status: 'SUCCESS', reference: 'p1' }));
    await expect(svc.handleJemenipayWebhook(raw, 'bad_signature')).rejects.toMatchObject({
      status: 401,
    });
  });
});
