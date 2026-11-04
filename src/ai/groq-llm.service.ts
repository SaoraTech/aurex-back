import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderError } from '../common/provider-error';
import { AiMessage, AiOptions, AiResult } from './ai.types';

@Injectable()
export class GroqLlmService {
  private readonly logger = new Logger(GroqLlmService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.config.get<string>('groqApiKey'));
  }

  getModel(): string {
    return this.config.get<string>('groqLlmModel') ?? 'openai/gpt-oss-120b';
  }

  async generate(messages: AiMessage[], options: AiOptions = {}): Promise<AiResult> {
    const apiKey = this.config.get<string>('groqApiKey');
    if (!apiKey) {
      throw new ProviderError('groq', 'not_configured', 'Groq API key is not configured');
    }

    const model = this.getModel();
    const systemInstruction = options.systemInstruction;
    const temperature = options.temperature ?? 0.3;
    const maxTokens = options.maxOutputTokens ?? 4096;

    const formattedMessages: Array<{ role: string; content: string }> = [];
    if (systemInstruction) {
      formattedMessages.push({ role: 'system', content: systemInstruction });
    }
    for (const msg of messages) {
      formattedMessages.push({ role: msg.role, content: msg.content });
    }

    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        this.logger.error(`Groq API error ${response.status}: ${bodyText}`);
        throw new ProviderError('groq', 'unavailable', `Groq API error: ${response.status}`, response.status);
      }

      const json = await response.json();
      const text = json.choices?.[0]?.message?.content ?? '';
      const tokens = (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0);
      const latencyMs = Date.now() - started;

      return {
        text,
        provider: 'groq',
        model: json.model ?? model,
        latencyMs,
        tokens,
      };
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      if (err.name === 'AbortError') {
        throw new ProviderError('groq', 'timeout', 'Groq API request timed out');
      }
      throw new ProviderError('groq', 'unavailable', err.message ?? 'Unknown Groq error');
    } finally {
      clearTimeout(timeout);
    }
  }
}
