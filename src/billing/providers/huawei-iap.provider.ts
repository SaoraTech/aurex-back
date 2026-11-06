import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants, verify as verifySignature } from 'node:crypto';
import { fetchWithTimeout } from '../../common/http';

export interface HuaweiVerifiedSubscription {
  userId: string;
  plan: 'plus' | 'pro';
  subscriptionId: string;
  productId: string;
  orderId: string;
  purchaseTime: Date;
  expirationDate: Date;
  isAutoRenewing: boolean;
  isActive: boolean;
}

@Injectable()
export class HuaweiIapProvider {
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('huaweiIapClientId') &&
      this.config.get<string>('huaweiIapClientSecret') &&
      this.config.get<string>('huaweiIapApiBaseUrl') &&
      this.config.get<string>('huaweiIapPublicKey') &&
      this.config.get<string>('huaweiIapPlusProductId') &&
      this.config.get<string>('huaweiIapProProductId'),
    );
  }

  verifyNotification(rawBody: Buffer | string): Record<string, any> {
    const publicKey = this.getPublicKey();
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const body = JSON.parse(raw) as Record<string, any>;
    const signedValue = body.statusUpdateNotification ?? body.data;
    const signature = body.signature;
    if (!signedValue || typeof signature !== 'string') throw new Error('Huawei IAP notification signature fields are missing');

    const signedPayload = typeof signedValue === 'string' ? signedValue : JSON.stringify(signedValue);
    const valid = this.verifySignedPayload(signedPayload, signature);
    if (!valid) throw new Error('Huawei IAP notification signature is invalid');

    return typeof signedValue === 'string' ? JSON.parse(signedValue) : signedValue;
  }

  async verifySubscriptionToken(purchaseToken: string, subscriptionId: string): Promise<HuaweiVerifiedSubscription> {
    if (!this.isConfigured()) throw new Error('Huawei IAP server verification is not configured');
    const accessToken = await this.getAccessToken();
    const baseUrl = this.config.get<string>('huaweiIapApiBaseUrl')!.replace(/\/+$/, '');
    const response = await fetchWithTimeout(
      'huawei_iap',
      `${baseUrl}/sub/applications/v2/purchases/get`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`APPAT:${accessToken}`).toString('base64')}`,
          'Content-Type': 'application/json; charset=UTF-8',
          Accept: 'application/json',
        },
        body: JSON.stringify({ purchaseToken, subscriptionId }),
      },
      15000,
    );

    if (!response.ok) throw new Error(`Huawei IAP verification returned HTTP ${response.status}`);
    const result = await response.json() as Record<string, any>;
    if (String(result.responseCode) !== '0' || !result.inAppPurchaseData || !result.dataSignature) {
      throw new Error('Huawei IAP did not confirm the subscription purchase');
    }

    const purchaseDataRaw = String(result.inAppPurchaseData);
    const valid = this.verifySignedPayload(purchaseDataRaw, String(result.dataSignature));
    if (!valid) throw new Error('Huawei IAP purchase data signature is invalid');

    const purchase = JSON.parse(purchaseDataRaw) as Record<string, any>;
    const productId = String(purchase.productId ?? '');
    const plusProductId = this.config.get<string>('huaweiIapPlusProductId');
    const proProductId = this.config.get<string>('huaweiIapProProductId');
    const plan = productId === plusProductId ? 'plus' : productId === proProductId ? 'pro' : null;
    const expirationDate = new Date(Number(purchase.expirationDate));
    const purchaseTimeCandidate = new Date(Number(purchase.purchaseTime ?? purchase.purchaseTimeMillis));
    const purchaseTime = Number.isFinite(purchaseTimeCandidate.getTime()) ? purchaseTimeCandidate : new Date();
    const payload = String(purchase.developerPayload ?? '');
    let userId = payload;
    try {
      const parsed = JSON.parse(payload);
      userId = String(parsed.userId ?? '');
    } catch {
      // Older clients may send the user ID directly as developerPayload.
    }

    if (
      purchase.kind !== 2 ||
      String(purchase.subscriptionId) !== subscriptionId ||
      !plan ||
      !userId ||
      !Number.isFinite(expirationDate.getTime())
    ) {
      throw new Error('Huawei IAP subscription data does not grant an active Aurex entitlement');
    }

    return {
      userId,
      plan,
      subscriptionId,
      productId,
      orderId: String(purchase.lastOrderId ?? purchase.orderId),
      purchaseTime,
      expirationDate,
      isAutoRenewing: Boolean(purchase.autoRenewing),
      isActive: (purchase.subIsvalid ?? purchase.subIsValid) === true && Number(purchase.purchaseState) === 0 && expirationDate > new Date(),
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken;
    const clientId = this.config.get<string>('huaweiIapClientId')!;
    const clientSecret = this.config.get<string>('huaweiIapClientSecret')!;
    const response = await fetchWithTimeout(
      'huawei_iap',
      'https://oauth-login.cloud.huawei.com/oauth2/v3/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      },
      10000,
    );
    if (!response.ok) throw new Error(`Huawei OAuth returned HTTP ${response.status}`);
    const result = await response.json() as { access_token?: string; expires_in?: number };
    if (!result.access_token) throw new Error('Huawei OAuth did not return an access token');
    this.accessToken = result.access_token;
    this.accessTokenExpiresAt = Date.now() + Number(result.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private verifySignedPayload(payload: string, signature: string): boolean {
    const algorithm = this.config.get<string>('huaweiIapSignatureAlgorithm') ?? 'SHA256withRSA';
    const key = this.getPublicKey();
    const keyOptions = algorithm === 'SHA256withRSA/PSS'
      ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }
      : key;
    return verifySignature('RSA-SHA256', Buffer.from(payload, 'utf8'), keyOptions, Buffer.from(signature, 'base64'));
  }

  private getPublicKey(): string {
    const key = this.config.get<string>('huaweiIapPublicKey');
    if (!key) throw new Error('Huawei IAP public key is not configured');
    return key.replace(/\\n/g, '\n');
  }
}
