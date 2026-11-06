import { createHmac } from 'node:crypto';
import { JemenipayProvider } from './jemenipay.provider';

describe('JemenipayProvider', () => {
  const secret = 'jemenipay-webhook-test-secret';
  const provider = new JemenipayProvider({
    get: (key: string) => key === 'jemenipayWebhookSecret' ? secret : undefined,
  } as any);

  const verifyStatus = (status: string) => {
    const raw = JSON.stringify({
      status,
      reference: 'local-payment-1',
      transaction_id: 'jem-transaction-1',
      amount: 5000,
      currency: 'XOF',
      metadata: { plan: 'plus', userId: 'user_1' },
    });
    const signature = createHmac('sha512', secret).update(raw).digest('hex');
    return provider.verifyWebhook(raw, signature);
  };

  it('keeps pending provider events in a non-terminal state', async () => {
    await expect(verifyStatus('PENDING')).resolves.toMatchObject({
      valid: true,
      status: 'pending',
      paymentId: 'local-payment-1',
    });
  });

  it('maps explicit provider failures to failed', async () => {
    await expect(verifyStatus('FAILED')).resolves.toMatchObject({
      valid: true,
      status: 'failed',
    });
  });

  it('maps completed payments to success', async () => {
    await expect(verifyStatus('COMPLETED')).resolves.toMatchObject({
      valid: true,
      status: 'success',
    });
  });
});
