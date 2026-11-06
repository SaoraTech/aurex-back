import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const createService = (configValues: Record<string, any>) => {
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService;
    return new NotificationsService(config);
  };

  afterEach(() => jest.restoreAllMocks());

  it('skips workflows when Novu is not configured', async () => {
    const svc = createService({});
    await expect(svc.triggerWorkflow({ subscriberId: 'user_123', workflowId: 'announcement' }))
      .resolves.toMatchObject({ sent: false, reason: 'not_configured' });
    expect(svc.getSubscriberToken('user_123').hmacHash).toBeNull();
  });

  it('generates the SHA256 HMAC subscriber hash and returns app identifier', () => {
    const apiKey = 'test_secret_api_key_12345';
    const svc = createService({ novuApiKey: apiKey, novuAppIdentifier: 'app_id_test' });
    const result = svc.getSubscriberToken('sub_user_456');
    expect(result.hmacHash).toBe(createHmac('sha256', apiKey).update('sub_user_456').digest('hex'));
    expect(result.appIdentifier).toBe('app_id_test');
  });

  it('targets Novu topics using the documented Topic recipient shape', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { transactionId: 'txn_1' } }),
    } as Response);
    const svc = createService({ novuApiKey: 'novu_test', novuApiUrl: 'https://api.novu.co' });

    await expect(svc.triggerWorkflow({
      topicKey: 'announcements:plus',
      workflowId: 'aurex-announcement',
      payload: { announcementId: 'ann_1' },
    })).resolves.toMatchObject({ sent: true, transactionId: 'txn_1' });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      workflowId: 'aurex-announcement',
      to: { type: 'Topic', topicKey: 'announcements:plus' },
    });
  });

  it('upserts a subscriber and subscribes it to the audience-filtered announcements topic', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as Response);
    const svc = createService({ novuApiKey: 'novu_test', novuApiUrl: 'https://api.novu.co' });

    await expect(svc.syncSubscriber({
      subscriberId: 'user_1',
      email: 'user@example.com',
      firstName: 'Aurex User',
      plan: 'plus',
      preferences: { editorialEmailEnabled: true, editorialPushEnabled: false, transactionalEmailEnabled: true, transactionalPushEnabled: true },
    })).resolves.toMatchObject({ sent: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const topicCall = fetchMock.mock.calls[1];
    expect(String(topicCall[0])).toContain('/v2/topics/announcements%3Aall/subscriptions');
    const body = JSON.parse(String(topicCall[1]?.body));
    expect(body).toMatchObject({ name: 'Aurex announcements' });
    expect(body.subscriptions[0]).toMatchObject({ identifier: 'user_1-announcements', subscriberId: 'user_1' });
    expect(body.preferences[0]).toMatchObject({ workflowId: 'aurex-announcement' });
    expect(body.preferences[0].condition.or).toHaveLength(2);
  });

  it('refuses to trigger a workflow without a recipient', async () => {
    const svc = createService({ novuApiKey: 'novu_test' });
    await expect(svc.triggerWorkflow({ workflowId: 'test_workflow' }))
      .resolves.toMatchObject({ sent: false, reason: 'recipient_missing' });
  });

  it('gracefully reports provider/network errors', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const svc = createService({ novuApiKey: 'novu_test', novuApiUrl: 'https://api.novu.co' });
    await expect(svc.triggerWorkflow({ subscriberId: 'sub_test', workflowId: 'test_workflow' }))
      .resolves.toMatchObject({ sent: false, reason: 'provider_error' });
  });
});
