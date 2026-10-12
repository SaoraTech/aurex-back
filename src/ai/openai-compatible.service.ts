import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiMessage, AiResult } from './gemini.service';

export type CompatibleProvider = 'groq' | 'kimi' | 'qwen' | 'deepseek' | 'grok';

@Injectable()
export class OpenAiCompatibleService {
  constructor(private readonly config: ConfigService) {}

  async generate(provider: CompatibleProvider, messages: AiMessage[], options?: { systemInstruction?: string; temperature?: number; maxOutputTokens?: number }): Promise<AiResult> {
    const keyName = `${provider}ApiKey`;
    const modelName = `${provider}Model`;
    const baseName = `${provider}BaseUrl`;
    const apiKey = this.config.get<string>(keyName);
    const baseUrl = this.config.get<string>(baseName);
    const model = this.config.get<string>(modelName);
    if (!apiKey || !baseUrl || !model) throw new ServiceUnavailableException(`${provider} provider is not configured`);
    const apiMessages = [
      ...(options?.systemInstruction ? [{ role: 'system', content: options.systemInstruction }] : []),
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: apiMessages, temperature: options?.temperature ?? 0.3, max_tokens: options?.maxOutputTokens ?? 4096 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        // Do not log provider bodies: they can contain user prompts or account details.
        throw new Error(`provider returned HTTP ${response.status}`);
      }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => p.text ?? '').join('') : '';
      if (!text.trim()) throw new Error('provider returned an empty response');
      return { text, provider, model };
    } catch {
      throw new ServiceUnavailableException(`${provider} generation request failed`);
    }
  }
}
