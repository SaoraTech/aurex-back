export type PaymentMethodType = 'orange_money_mali' | 'moov_africa_mali' | 'card';

export interface CheckoutRequest {
  userId: string;
  email: string;
  plan: 'plus' | 'pro' | 'plus_promo' | 'pro_promo';
  amount: number;
  currency: 'XOF';
  paymentMethod: PaymentMethodType;
  returnUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutResponse {
  paymentId: string;
  checkoutUrl?: string;
  qrCode?: string;
  provider: 'jemenipay';
  status: 'pending' | 'success' | 'failed';
}

export interface WebhookVerificationResult {
  valid: boolean;
  paymentId: string;
  externalReference?: string;
  status: 'success' | 'failed' | 'pending';
  amount: number;
  currency: string;
  metadata?: Record<string, any>;
}

export interface PaymentProvider {
  readonly providerName: 'jemenipay';
  isConfigured(): boolean;
  initiateCheckout(request: CheckoutRequest): Promise<CheckoutResponse>;
  verifyWebhook(payload: Buffer | string, signature: string, timestamp?: string): Promise<WebhookVerificationResult>;
}
