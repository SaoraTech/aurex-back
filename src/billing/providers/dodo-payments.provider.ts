import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout } from '../../common/http';
import { CheckoutRequest, CheckoutResponse } from './payment-provider.interface';

export interface DodoWebhookEvent {
  eventId: string;
  type: string;
  data: Record<string, any>;
}

@Injectable()
export class DodoPaymentsProvider {
  private readonly logger = new Logger(DodoPaymentsProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get apiKey() { return this.config.get<string>('dodoPaymentsApiKey'); }
  private get environment() { return this.config.get<string>('dodoPaymentsEnvironment') ?? 'test_mode'; }

  private get baseUrl() {
    return this.environment === 'live_mode'
      ? 'https://live.dodopayments.com'
      : 'https://test.dodopayments.com';
  }

  private productId(plan: CheckoutRequest['plan']): string | undefined {
    const keys: Record<CheckoutRequest['plan'], string> = {
      plus: 'dodoProductPlus',
      pro: 'dodoProductPro',
      plus_promo: 'dodoProductPlusPromo',
      pro_promo: 'dodoProductProPromo',
    };
    return this.config.get<string>(keys[plan]);
  }

  isConfiguredForPlan(plan: CheckoutRequest['plan']): boolean {
    return Boolean(this.apiKey && this.productId(plan));
  }

  async initiateCheckout(request: CheckoutRequest): Promise<CheckoutResponse> {
    const productId = this.productId(request.plan);
    if (!this.apiKey || !productId) {
      throw new Error('Dodo Payments API key or product mapping is not configured');
    }

    const returnUrl = request.returnUrl ?? this.config.get<string>('dodoPaymentsReturnUrl');
    if (!returnUrl) throw new Error('Dodo Payments return URL is not configured');

    const response = await fetchWithTimeout('dodo_payments', `${this.baseUrl}/checkout-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(request.idempotencyKey ? { 'Idempotency-Key': request.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email: request.email },
        return_url: returnUrl,
        ...(request.cancelUrl ? { cancel_url: request.cancelUrl } : {}),
        metadata: {
          userId: request.userId,
          plan: request.plan,
          localPaymentId: request.localPaymentId ?? '',
          idempotencyKey: request.idempotencyKey ?? '',
        },
      }),
    }, 15000);

    if (!response.ok) {
      this.logger.error({ msg: 'dodo_checkout_rejected', status: response.status });
      throw new Error(`Dodo Payments returned HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, any>;
    const checkoutUrl = data.checkout_url ?? data.checkoutUrl;
    const sessionId = data.session_id ?? data.sessionId ?? data.id;
    if (!checkoutUrl || !sessionId) throw new Error('Dodo Payments checkout response is incomplete');

    return { paymentId: String(sessionId), checkoutUrl: String(checkoutUrl), provider: 'dodo_payments', status: 'pending' };
  }

  verifyWebhook(rawBody: Buffer | string, headers: {
    webhookId?: string;
    webhookTimestamp?: string;
    webhookSignature?: string;
  }): DodoWebhookEvent {
    const secret = this.config.get<string>('dodoPaymentsWebhookKey');
    const id = headers.webhookId;
    const timestamp = headers.webhookTimestamp;
    const signature = headers.webhookSignature;
    if (!secret || !id || !timestamp || !signature) throw new Error('Dodo webhook verification headers or secret are missing');

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) {
      throw new Error('Dodo webhook timestamp is outside the accepted window');
    }

    const encodedSecret = secret.replace(/^whsec_/, '');
    const key = Buffer.from(encodedSecret, 'base64');
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const signedContent = `${id}.${timestamp}.${raw}`;
    const expected = createHmac('sha256', key).update(signedContent).digest('base64');
    const candidates = signature.split(' ').flatMap(part => {
      const [, value] = part.split(',');
      return value ? [value] : [];
    });
    const valid = candidates.some(candidate => {
      const a = Buffer.from(candidate);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (!valid) throw new Error('Dodo webhook signature is invalid');

    const parsed = JSON.parse(raw) as { type?: string; data?: Record<string, any> };
    if (!parsed.type || !parsed.data) throw new Error('Dodo webhook payload is incomplete');
    return { eventId: id, type: parsed.type, data: parsed.data };
  }
}
