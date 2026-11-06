import { generateKeyPairSync, sign } from 'node:crypto';
import { HuaweiIapProvider } from './huawei-iap.provider';

describe('HuaweiIapProvider', () => {
  afterEach(() => jest.restoreAllMocks());
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const createConfig = () => ({
    get: (key: string) => ({
      huaweiIapClientId: 'huawei-client',
      huaweiIapClientSecret: 'huawei-secret',
      huaweiIapApiBaseUrl: 'https://iap.example.test',
      huaweiIapPublicKey: publicPem,
      huaweiIapPlusProductId: 'aurex_plus_monthly',
      huaweiIapProProductId: 'aurex_pro_monthly',
    })[key],
  });

  it('verifies a signed Huawei event notification', () => {
    const provider = new HuaweiIapProvider(createConfig() as any);
    const payload = JSON.stringify({ purchaseToken: 'purchase_token', subscriptionId: 'sub_1' });
    const signature = sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64');
    const raw = JSON.stringify({ statusUpdateNotification: payload, signature });

    expect(provider.verifyNotification(raw)).toMatchObject({
      purchaseToken: 'purchase_token',
      subscriptionId: 'sub_1',
    });
  });

  it('obtains a server token and verifies the signed subscription purchase data', async () => {
    const provider = new HuaweiIapProvider(createConfig() as any);
    const purchaseData = JSON.stringify({
      kind: 2,
      productId: 'aurex_plus_monthly',
      purchaseState: 0,
      subIsvalid: true,
      subscriptionId: 'sub_1',
      developerPayload: 'user_1',
      purchaseTime: Date.now() - 1000,
      expirationDate: Date.now() + 86_400_000,
      lastOrderId: 'order_1',
      autoRenewing: true,
    });
    const dataSignature = sign('RSA-SHA256', Buffer.from(purchaseData), privateKey).toString('base64');
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ access_token: 'app_at', expires_in: 3600 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ responseCode: '0', inAppPurchaseData: purchaseData, dataSignature }),
      } as Response);

    const result = await provider.verifySubscriptionToken('purchase_token', 'sub_1');
    expect(result).toMatchObject({ userId: 'user_1', plan: 'plus', subscriptionId: 'sub_1', isActive: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
