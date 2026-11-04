import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CheckoutRequest, CheckoutResponse, PaymentProvider, WebhookVerificationResult } from './payment-provider.interface';

@Injectable()
export class JemenipayProvider implements PaymentProvider {
  readonly providerName = 'jemenipay' as const;
  private readonly logger = new Logger(JemenipayProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('jemenipayApiKey') &&
      this.config.get<string>('jemenipaySecretKey')
    );
  }

  private getBaseUrl(): string {
    const env = this.config.get<string>('jemenipayEnv') ?? 'sandbox';
    return env === 'live'
      ? 'https://jemeni.net/api/live'
      : 'https://jemeni.net/api/sandbox';
  }

  async initiateCheckout(request: CheckoutRequest): Promise<CheckoutResponse> {
    const apiKey = this.config.get<string>('jemenipayApiKey') || 'sandbox_api_key';
    const secretKey = this.config.get<string>('jemenipaySecretKey') || 'sandbox_secret_key';
    const baseUrl = this.getBaseUrl();

    const timestamp = Date.now().toString();
    const paymentId = `jem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const body = {
      amount: request.amount,
      currency: request.currency,
      reference: paymentId,
      customer: {
        id: request.userId,
        email: request.email,
      },
      payment_method: request.paymentMethod,
      metadata: {
        plan: request.plan,
        userId: request.userId,
      },
      return_url: request.returnUrl,
      cancel_url: request.cancelUrl,
    };

    const signature = this.calculateSignature(secretKey, apiKey, 'POST', '/payments/checkout', JSON.stringify(body), timestamp);

    this.logger.log(`Jemenipay checkout initiated for plan ${request.plan} (${request.amount} ${request.currency})`);

    return {
      paymentId,
      checkoutUrl: `${baseUrl}/checkout/${paymentId}`,
      provider: 'jemenipay',
      status: 'pending',
    };
  }

  async verifyWebhook(
    payload: Buffer | string,
    signature: string,
    timestamp?: string,
  ): Promise<WebhookVerificationResult> {
    const secret = this.config.get<string>('jemenipayWebhookSecret') || this.config.get<string>('jemenipaySecretKey') || '';
    const payloadStr = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;

    const expected = crypto
      .createHmac('sha512', secret)
      .update(payloadStr + (timestamp ?? ''))
      .digest('hex');

    const isValid = signature && (signature === expected || signature.toLowerCase() === expected.toLowerCase());

    try {
      const data = JSON.parse(payloadStr);
      return {
        valid: Boolean(isValid),
        paymentId: data.reference ?? data.paymentId ?? '',
        externalReference: data.transactionId ?? data.id,
        status: data.status === 'COMPLETED' || data.status === 'SUCCESS' ? 'success' : 'failed',
        amount: Number(data.amount ?? 0),
        currency: data.currency ?? 'XOF',
        metadata: data.metadata,
      };
    } catch {
      return {
        valid: false,
        paymentId: '',
        status: 'failed',
        amount: 0,
        currency: 'XOF',
      };
    }
  }

  private calculateSignature(
    secretKey: string,
    apiKey: string,
    method: string,
    path: string,
    body: string,
    timestamp: string,
  ): string {
    const payload = `${secretKey}${apiKey}${method.toUpperCase()}${path}${body}${timestamp}`;
    return crypto.createHmac('sha512', secretKey).update(payload).digest('hex');
  }
}
