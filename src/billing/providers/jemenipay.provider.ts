import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  CheckoutRequest,
  CheckoutResponse,
  PaymentProvider,
  WebhookVerificationResult,
} from './payment-provider.interface';

@Injectable()
export class JemenipayProvider implements PaymentProvider {
  readonly providerName = 'jemenipay' as const;
  private readonly logger = new Logger(JemenipayProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('jemenipayApiKey') &&
        this.config.get<string>('jemenipaySecretKey'),
    );
  }

  getBaseUrl(): string {
    const env = this.config.get<string>('jemenipayEnv') ?? 'sandbox';
    return env === 'live'
      ? 'https://jemeni.net/api/live'
      : 'https://jemeni.net/api/sandbox';
  }

  async initiateCheckout(request: CheckoutRequest): Promise<CheckoutResponse> {
    if (!this.isConfigured()) {
      throw new Error('Jemenipay API credentials are not configured');
    }

    const apiKey = this.config.get<string>('jemenipayApiKey')!;
    const secretKey = this.config.get<string>('jemenipaySecretKey')!;
    const baseUrl = this.getBaseUrl();
    const isSandbox = (this.config.get<string>('jemenipayEnv') ?? 'sandbox') === 'sandbox';

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const paymentReference = `jem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const endpointPath = '/payments/checkout';

    const payload = {
      reference: paymentReference,
      amount: request.amount,
      currency: request.currency,
      customer_email: request.email,
      customer_id: request.userId,
      country_code: 'ML',
      payment_method: request.paymentMethod,
      return_url: request.returnUrl,
      cancel_url: request.cancelUrl,
      metadata: {
        plan: request.plan,
        userId: request.userId,
        reference: paymentReference,
      },
    };

    const bodyString = JSON.stringify(payload);
    const signature = this.calculateSignature(
      secretKey,
      apiKey,
      'POST',
      endpointPath,
      bodyString,
      timestamp,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${baseUrl}${endpointPath}`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'auth-apiKey': apiKey,
          'auth-token': secretKey,
          'auth-timestamp': timestamp,
          'auth-signature': signature,
          ...(isSandbox ? { 'sandbox': 'true' } : {}),
        },
        body: bodyString,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Jemenipay checkout HTTP error ${response.status}: ${errorText}`);
        throw new Error(`Jemenipay API returned HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const checkoutUrl = data.checkout_url ?? data.checkoutUrl ?? data.url ?? `${baseUrl}/checkout/${paymentReference}`;
      const remotePaymentId = data.payment_id ?? data.paymentId ?? data.reference ?? paymentReference;

      this.logger.log(`Jemenipay checkout initiated: ${remotePaymentId} for plan ${request.plan} (${request.amount} ${request.currency})`);

      return {
        paymentId: remotePaymentId,
        checkoutUrl,
        provider: 'jemenipay',
        status: 'pending',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async verifyWebhook(
    payload: Buffer | string,
    signature: string,
    timestamp?: string,
  ): Promise<WebhookVerificationResult> {
    const secret =
      this.config.get<string>('jemenipayWebhookSecret') ||
      this.config.get<string>('jemenipaySecretKey') ||
      '';

    if (!secret || !signature) {
      return {
        valid: false,
        paymentId: '',
        status: 'failed',
        amount: 0,
        currency: 'XOF',
      };
    }

    const payloadStr = Buffer.isBuffer(payload)
      ? payload.toString('utf8')
      : payload;

    // Standard HMAC-SHA512 over the raw webhook payload
    const expectedHmac = crypto
      .createHmac('sha512', secret)
      .update(payloadStr)
      .digest('hex');

    // Also verify timestamp-appended HMAC if timestamp is provided
    const expectedHmacWithTs = timestamp
      ? crypto
          .createHmac('sha512', secret)
          .update(payloadStr + timestamp)
          .digest('hex')
      : null;

    const sigLower = signature.trim().toLowerCase();
    const isValid =
      sigLower === expectedHmac.toLowerCase() ||
      (expectedHmacWithTs && sigLower === expectedHmacWithTs.toLowerCase());

    if (!isValid) {
      this.logger.warn('Jemenipay webhook signature mismatch');
      return {
        valid: false,
        paymentId: '',
        status: 'failed',
        amount: 0,
        currency: 'XOF',
      };
    }

    try {
      const data = JSON.parse(payloadStr);
      const isSuccess =
        data.status === 'COMPLETED' ||
        data.status === 'SUCCESS' ||
        data.event === 'payment.succeeded';

      return {
        valid: true,
        paymentId: data.reference ?? data.paymentId ?? data.payment_id ?? '',
        externalReference: data.transactionId ?? data.transaction_id ?? data.id,
        status: isSuccess ? 'success' : 'failed',
        amount: Number(data.amount ?? 0),
        currency: data.currency ?? 'XOF',
        metadata: data.metadata ?? {},
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

  /**
   * Official Jɛmɛnipay signature formula:
   * Message = SK + AK + METHOD + URL + BODY + TIMESTAMP
   * HMAC-SHA512(Message, key=SK)
   */
  calculateSignature(
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
