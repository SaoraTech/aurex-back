export type PaymentMethodType = 'orange_money_mali' | 'moov_africa_mali' | 'card';
export type PaymentProviderName = 'jemenipay' | 'dodo_payments' | 'revenuecat' | 'huawei_iap';

export interface CheckoutRequest {
  userId: string;
  email: string;
  plan: 'plus' | 'pro' | 'plus_promo' | 'pro_promo';
  amount: number;
  currency: 'XOF';
  paymentMethod: PaymentMethodType;
  returnUrl?: string;
  cancelUrl?: string;
  localPaymentId?: string;
  idempotencyKey?: string;
}

export interface CheckoutResponse {
  paymentId: string;
  checkoutUrl?: string;
  qrCode?: string;
  provider: PaymentProviderName;
  status: 'pending' | 'success' | 'failed';
}

export interface WebhookVerificationResult {
  valid: boolean;
  paymentId: string;
  externalReference?: string;
  status: 'success' | 'failed' | 'pending';
  amount: number;
  currency: string;
  eventId?: string;
  metadata?: Record<string, any>;
}

export interface PaymentProvider {
  readonly providerName: PaymentProviderName;
  isConfigured(): boolean;
  initiateCheckout(request: CheckoutRequest): Promise<CheckoutResponse>;
  verifyWebhook(payload: Buffer | string, signature: string, timestamp?: string): Promise<WebhookVerificationResult>;
}
