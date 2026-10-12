import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MathService {
  constructor(private readonly config: ConfigService) {}
  async compute(input: string): Promise<{ input: string; result: string; provider: string }> {
    const appId = this.config.get<string>('wolframAppId');
    if (!appId) throw new ServiceUnavailableException('Mathematical computation provider is not configured');
    const url = new URL('https://api.wolframalpha.com/v1/result');
    url.searchParams.set('appid', appId);
    url.searchParams.set('i', input);
    url.searchParams.set('units', 'metric');
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    const text = await response.text();
    if (!response.ok) throw new ServiceUnavailableException('Mathematical computation failed');
    return { input, result: text, provider: 'wolfram-alpha' };
  }
}
