import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProviderError, isTimeoutError, kindFromStatus } from '../common/provider-error';
import { MetricsService } from '../observability/metrics.service';
import { AiMessage, AiOptions, AiResult } from './ai.types';

// Re-exported for backward compatibility with existing imports.
export type { AiMessage, AiResult } from './ai.types';

@Injectable()
export class GeminiService {
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {}

  async generate(messages: AiMessage[], options?: AiOptions): Promise<AiResult> {
    const key = this.config.get<string>('geminiApiKey');
    if (!key) throw new ProviderError('gemini', 'not_configured', 'gemini is not configured');
    const modelName = this.config.get<string>('geminiModel') ?? 'gemini-2.5-flash';
    const timeout = this.config.get<number>('aiTimeoutMs') ?? 45000;
    const started = Date.now();
    return this.metrics.track('gemini', 'generate', async () => {
      try {
        const model = new GoogleGenerativeAI(key).getGenerativeModel({
          model: modelName,
          systemInstruction: options?.systemInstruction ?? 'Tu es Aurex, un tuteur de mathématiques rigoureux. Ne fabrique jamais de résultats.',
          generationConfig: { temperature: options?.temperature ?? 0.3, maxOutputTokens: options?.maxOutputTokens ?? 4096 },
        }, { timeout });
        const history = messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(messages[messages.length - 1]?.content ?? '');
        const text = result.response.text();
        if (!text?.trim()) throw new ProviderError('gemini', 'bad_response', 'gemini returned an empty response');
        return { text, provider: 'gemini', model: modelName, latencyMs: Date.now() - started, tokens: result.response.usageMetadata?.totalTokenCount };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (isTimeoutError(error)) throw new ProviderError('gemini', 'timeout', 'gemini request timed out');
        const status = (error as { status?: number }).status;
        // Blocked/safety or malformed output surfaces as an Error without status: treat as a bad response.
        throw new ProviderError('gemini', typeof status === 'number' ? kindFromStatus(status) : 'bad_response', 'gemini request failed', status);
      }
    });
  }
}
