import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors';
import { fetchWithTimeout } from '../common/http';
import { ProviderError, kindFromStatus, providerErrorToHttp } from '../common/provider-error';
import { MetricsService } from '../observability/metrics.service';
import { UsageService } from '../observability/usage.service';

@Injectable()
export class MathService {
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService, private readonly usage: UsageService) {}

  async compute(input: string, userId?: string, requestId?: string): Promise<{ input: string; result: string; provider: string }> {
    const appId = this.config.get<string>('wolframAppId');
    if (!appId) throw new AppException(503, 'MATH_ENGINE_NOT_CONFIGURED', "Le moteur de calcul n'est pas configuré.");
    const started = Date.now();
    let outcome = 'ok';
    try {
      return await this.metrics.track('wolfram', 'result', async () => {
        const url = new URL('https://api.wolframalpha.com/v1/result');
        url.searchParams.set('appid', appId); url.searchParams.set('i', input); url.searchParams.set('units', 'metric');
        const res = await fetchWithTimeout('wolfram', url, {}, 12_000);
        // 501 = Wolfram|Alpha understood the query but has no short answer: a business outcome, not an outage.
        if (res.status === 501) throw new AppException(422, 'NO_SHORT_RESULT', "Aucun résultat court n'est disponible pour cette entrée.");
        if (!res.ok) throw new ProviderError('wolfram', res.status === 400 ? 'invalid_request' : kindFromStatus(res.status), `wolfram returned HTTP ${res.status}`, res.status);
        return { input, result: await res.text(), provider: 'wolfram-alpha' };
      });
    } catch (error) {
      outcome = error instanceof ProviderError ? error.kind : 'business_error';
      if (error instanceof ProviderError) throw providerErrorToHttp(error, 'Le moteur de calcul');
      throw error;
    } finally {
      if (userId) void this.usage.record({ userId, kind: 'math_call', provider: 'wolfram', latencyMs: Date.now() - started, outcome, requestId });
    }
  }
}
