import { createHmac } from 'node:crypto';
import { DodoPaymentsProvider } from './dodo-payments.provider';

describe('DodoPaymentsProvider', () => {
  it('verifies Standard Webhooks signatures over the raw body', () => {
    const secretBytes = Buffer.from('dodo-webhook-test-secret');
    const config = {
      get: (key: string) => key === 'dodoPaymentsWebhookKey' ? `whsec_${secretBytes.toString('base64')}` : undefined,
    };
    const provider = new DodoPaymentsProvider(config as any);
    const id = 'wh_123';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const raw = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: 'pay_1' } });
    const signature = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${raw}`).digest('base64');

    expect(provider.verifyWebhook(raw, {
      webhookId: id,
      webhookTimestamp: timestamp,
      webhookSignature: `v1,${signature}`,
    })).toEqual({
      eventId: id,
      type: 'payment.succeeded',
      data: { payment_id: 'pay_1' },
    });
  });

  it('rejects stale webhook timestamps', () => {
    const secretBytes = Buffer.from('dodo-webhook-test-secret');
    const config = { get: () => `whsec_${secretBytes.toString('base64')}` };
    const provider = new DodoPaymentsProvider(config as any);
    expect(() => provider.verifyWebhook('{}', {
      webhookId: 'wh_123',
      webhookTimestamp: String(Math.floor(Date.now() / 1000) - 600),
      webhookSignature: 'v1,invalid',
    })).toThrow('outside the accepted window');
  });
});
