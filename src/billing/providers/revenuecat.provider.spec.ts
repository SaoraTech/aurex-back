import { createHmac } from 'node:crypto';
import { RevenueCatProvider } from './revenuecat.provider';

describe('RevenueCatProvider', () => {
  it('validates authorization and raw-body HMAC signatures', () => {
    const authorization = 'Bearer aurex-revenuecat-secret';
    const signingSecret = 'revenuecat-signing-secret';
    const config = {
      get: (key: string) => ({
        revenueCatWebhookAuthorization: authorization,
        revenueCatWebhookSigningSecret: signingSecret,
      })[key],
    };
    const provider = new RevenueCatProvider(config as any);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const raw = JSON.stringify({
      event: {
        id: 'evt_123',
        type: 'INITIAL_PURCHASE',
        app_user_id: 'user_1',
        original_app_user_id: 'user_1',
        product_id: 'aurex_plus_monthly',
      },
    });
    const signature = createHmac('sha256', signingSecret).update(`${timestamp}.${raw}`).digest('hex');

    expect(provider.verifyWebhook(raw, authorization, `t=${timestamp},v1=${signature}`)).toMatchObject({
      id: 'evt_123',
      type: 'INITIAL_PURCHASE',
      appUserId: 'user_1',
      productId: 'aurex_plus_monthly',
    });
  });

  it('rejects an invalid authorization header', () => {
    const provider = new RevenueCatProvider({
      get: (key: string) => key === 'revenueCatWebhookAuthorization' ? 'Bearer expected' : undefined,
    } as any);
    expect(() => provider.verifyWebhook('{"event":{}}', 'Bearer wrong')).toThrow('authorization is invalid');
  });
  it('parses RevenueCat transfer source and destination app user IDs', () => {
    const provider = new RevenueCatProvider({
      get: (key: string) => key === 'revenueCatWebhookAuthorization' ? 'Bearer expected' : undefined,
    } as any);
    const raw = JSON.stringify({
      event: {
        id: 'evt_transfer',
        type: 'TRANSFER',
        app_user_id: 'user_destination',
        transferred_from: ['user_source', '$RCAnonymousID:old'],
        transferred_to: ['user_destination', 'user_family'],
      },
    });

    expect(provider.verifyWebhook(raw, 'Bearer expected')).toMatchObject({
      id: 'evt_transfer',
      type: 'TRANSFER',
      appUserId: 'user_destination',
      transferredFrom: ['user_source', '$RCAnonymousID:old'],
      transferredTo: ['user_destination', 'user_family'],
    });
  });

});
