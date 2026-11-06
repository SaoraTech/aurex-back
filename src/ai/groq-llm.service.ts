import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderError } from '../common/provider-error';
import { AiMessage, AiOptions, AiResult } from './ai.types';

@Injectable()
export class GroqLlmService {
  private readonly logger = new Logger(GroqLlmService.name);
  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean { return Boolean(this.config.get<string>('groqApiKey')); }
  getModel(): string { return this.config.get<string>('groqLlmModel') ?? 'openai/gpt-oss-120b'; }

  private async readStream(response: Response, onToken: (delta: string) => void) {
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('groq', 'bad_response', 'Groq returned an empty stream');
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let tokens = 0;
    const consumeLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let payload: any;
      try { payload = JSON.parse(data); } catch { return; }
      const delta = payload?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length) { text += delta; onToken(delta); }
      const usage = payload?.usage;
      if (usage) tokens = (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
      if (done) break;
    }
    if (buffer) consumeLine(buffer);
    return { text, tokens };
  }

  async generate(messages: AiMessage[], options: AiOptions = {}): Promise<AiResult> {
    const apiKey = this.config.get<string>('groqApiKey');
    if (!apiKey) throw new ProviderError('groq', 'not_configured', 'Groq API key is not configured');

    const model = this.getModel();
    const formattedMessages: Array<{ role: string; content: string }> = [];
    if (options.systemInstruction) formattedMessages.push({ role: 'system', content: options.systemInstruction });
    for (const msg of messages) formattedMessages.push({ role: msg.role, content: msg.content });

    const started = Date.now();
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), 60000);
    const streaming = typeof options.onToken === 'function';

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxOutputTokens ?? 4096,
          stream: streaming,
          ...(streaming ? { stream_options: { include_usage: true } } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text();
        this.logger.error('Groq API error ' + response.status + ': ' + bodyText);
        throw new ProviderError('groq', 'unavailable', 'Groq API error: ' + response.status, response.status);
      }

      let text: string;
      let tokens: number;
      let returnedModel = model;
      if (streaming) {
        const result = await this.readStream(response, options.onToken!);
        text = result.text;
        tokens = result.tokens;
      } else {
        const json = await response.json() as any;
        text = json.choices?.[0]?.message?.content ?? '';
        tokens = (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0);
        returnedModel = json.model ?? model;
      }

      return { text, provider: 'groq', model: returnedModel, latencyMs: Date.now() - started, tokens };
    } catch (err: any) {
      if (err instanceof ProviderError) throw err;
      if (err.name === 'AbortError') {
        throw new ProviderError('groq', 'timeout', options.signal?.aborted ? 'Groq generation cancelled' : 'Groq API request timed out');
      }
      throw new ProviderError('groq', 'unavailable', err.message ?? 'Unknown Groq error');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
