import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout } from '../../common/http';

export interface RevenueCatEvent {
  id: string;
  type: string;
  appUserId: string;
  originalAppUserId?: string;
  productId?: string;
  transactionId?: string;
  expirationAtMs?: number;
  transferredFrom?: string[];
  transferredTo?: string[];
}

@Injectable()
export class RevenueCatProvider {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('revenueCatApiKey') &&
      this.config.get<string>('revenueCatWebhookAuthorization') &&
      this.config.get<string>('revenueCatPlusEntitlementId') &&
      this.config.get<string>('revenueCatProEntitlementId'),
    );
  }

  verifyWebhook(rawBody: Buffer | string, authorization?: string, signature?: string): RevenueCatEvent {
    const expectedAuthorization = this.config.get<string>('revenueCatWebhookAuthorization');
    if (!expectedAuthorization || !authorization || !this.constantTimeEqual(authorization, expectedAuthorization)) {
      throw new Error('RevenueCat webhook authorization is invalid');
    }

    const signingSecret = this.config.get<string>('revenueCatWebhookSigningSecret');
    if (signingSecret) {
      if (!signature) throw new Error('RevenueCat HMAC signature is required');
      const fields = Object.fromEntries(signature.split(',').map(part => {
        const [key, value] = part.split('=');
        return [key, value];
      }));
      const timestamp = fields.t;
      const supplied = fields.v1;
      const ts = Number(timestamp);
      if (!timestamp || !supplied || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) {
        throw new Error('RevenueCat webhook signature timestamp is invalid');
      }
      const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
      const expected = createHmac('sha256', signingSecret).update(`${timestamp}.${raw}`).digest('hex');
      if (!this.constantTimeEqual(supplied, expected)) throw new Error('RevenueCat webhook HMAC is invalid');
    }

    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const payload = JSON.parse(raw) as { event?: Record<string, any> };
    const event = payload.event;
    if (!event?.id || !event?.type || !event?.app_user_id) throw new Error('RevenueCat event is missing required identity fields');

    return {
      id: String(event.id),
      type: String(event.type),
      appUserId: String(event.app_user_id),
      originalAppUserId: event.original_app_user_id ? String(event.original_app_user_id) : undefined,
      productId: event.product_id ? String(event.product_id) : undefined,
      transactionId: event.transaction_id ? String(event.transaction_id) : undefined,
      expirationAtMs: event.expiration_at_ms ? Number(event.expiration_at_ms) : undefined,
      transferredFrom: Array.isArray(event.transferred_from) ? event.transferred_from.map(String) : [],
      transferredTo: Array.isArray(event.transferred_to) ? event.transferred_to.map(String) : [],
    };
  }

  async getSubscriber(appUserId: string): Promise<Record<string, any>> {
    const apiKey = this.config.get<string>('revenueCatApiKey');
    if (!apiKey) throw new Error('RevenueCat secret API key is not configured');
    const response = await fetchWithTimeout(
      'revenuecat',
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } },
      10000,
    );
    if (!response.ok) throw new Error(`RevenueCat subscriber lookup returned HTTP ${response.status}`);
    return response.json() as Promise<Record<string, any>>;
  }

  getEntitlementIds() {
    return {
      plus: this.config.get<string>('revenueCatPlusEntitlementId'),
      pro: this.config.get<string>('revenueCatProEntitlementId'),
    };
  }

  private constantTimeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
