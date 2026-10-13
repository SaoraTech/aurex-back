import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchWithTimeout, assertOk } from '../common/http';
import { ProviderError, kindFromStatus } from '../common/provider-error';
import { MetricsService } from '../observability/metrics.service';
import { AiMessage, AiOptions, AiResult } from './ai.types';

export type CompatibleProvider = 'groq' | 'kimi' | 'qwen' | 'deepseek' | 'grok';

@Injectable()
export class OpenAiCompatibleService {
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {}

  async generate(provider: CompatibleProvider, messages: AiMessage[], options?: AiOptions): Promise<AiResult> {
    const apiKey = this.config.get<string>(`${provider}ApiKey`);
    const baseUrl = this.config.get<string>(`${provider}BaseUrl`);
    const model = this.config.get<string>(`${provider}Model`);
    if (!apiKey || !baseUrl || !model) throw new ProviderError(provider, 'not_configured', `${provider} is not configured`);
    const apiMessages = [
      ...(options?.systemInstruction ? [{ role: 'system', content: options.systemInstruction }] : []),
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];
    const started = Date.now();
    return this.metrics.track(provider, 'generate', async () => {
      const res = await fetchWithTimeout(provider, `${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: apiMessages, temperature: options?.temperature ?? 0.3, max_tokens: options?.maxOutputTokens ?? 4096 }),
      }, this.config.get<number>('aiTimeoutMs') ?? 45000);
      assertOk(provider, res, kindFromStatus); // provider bodies may contain prompts/account data: never read or log them
      let data: { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>; usage?: { total_tokens?: number } };
      try { data = await res.json() as typeof data; } catch { throw new ProviderError(provider, 'bad_response', `${provider} returned invalid JSON`); }
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => p.text ?? '').join('') : '';
      if (!text.trim()) throw new ProviderError(provider, 'bad_response', `${provider} returned an empty response`);
      return { text, provider, model, latencyMs: Date.now() - started, tokens: data.usage?.total_tokens };
    });
  }
}
