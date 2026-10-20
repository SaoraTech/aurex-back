import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const createService = (configValues: Record<string, any>) => {
    const config = {
      get: (k: string) => configValues[k],
    } as unknown as ConfigService;
    return new NotificationsService(config);
  };

  describe('Novu not configured', () => {
    it('returns sent: false and reason: not_configured when apiKey is missing', async () => {
      const svc = createService({});
      const res = await svc.triggerWorkflow({
        subscriberId: 'user_123',
        workflowId: 'announcement',
      });
      expect(res.sent).toBe(false);
      expect(res.reason).toBe('not_configured');
    });

    it('returns null hmacHash when apiKey is missing', () => {
      const svc = createService({});
      const res = svc.getSubscriberToken('user_123');
      expect(res.subscriberId).toBe('user_123');
      expect(res.hmacHash).toBeNull();
    });
  });

  describe('HMAC Token Generation', () => {
    it('generates the exact SHA256 HMAC for subscriberId using apiKey', () => {
      const apiKey = 'test_secret_api_key_12345';
      const svc = createService({
        novuApiKey: apiKey,
        novuAppIdentifier: 'app_id_test',
      });

      const res = svc.getSubscriberToken('sub_user_456');
      const expectedHmac = createHmac('sha256', apiKey).update('sub_user_456').digest('hex');

      expect(res.subscriberId).toBe('sub_user_456');
      expect(res.hmacHash).toBe(expectedHmac);
      expect(res.appIdentifier).toBe('app_id_test');
    });
  });

  describe('Graceful degradation on provider error', () => {
    it('catches network errors and returns sent: false with provider_error without throwing', async () => {
      const svc = createService({
        novuApiKey: 'nv_key_mock',
        novuApiUrl: 'http://127.0.0.1:1', // Non-routable port to force immediate network error
      });

      const res = await svc.triggerWorkflow({
        subscriberId: 'sub_test',
        workflowId: 'test_workflow',
      });

      expect(res.sent).toBe(false);
      expect(res.reason).toBe('provider_error');
    });
  });
});
