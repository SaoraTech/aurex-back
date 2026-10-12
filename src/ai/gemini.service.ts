import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface AiMessage { role: 'user' | 'assistant'; content: string; }
export interface AiResult { text: string; provider: string; model: string; }

@Injectable()
export class GeminiService {
  constructor(private readonly config: ConfigService) {}

  async generate(messages: AiMessage[], options?: { systemInstruction?: string; temperature?: number; maxOutputTokens?: number }): Promise<AiResult> {
    const key = this.config.get<string>('geminiApiKey');
    if (!key) throw new ServiceUnavailableException('AI provider is not configured');
    try {
      const client = new GoogleGenerativeAI(key);
      const model = client.getGenerativeModel({
        model: this.config.get<string>('geminiModel') ?? 'gemini-2.5-flash',
        systemInstruction: options?.systemInstruction ?? 'You are Aurex, a careful mathematics tutor. Explain reasoning clearly and do not fabricate computation results.',
        generationConfig: { temperature: options?.temperature ?? 0.3, maxOutputTokens: options?.maxOutputTokens ?? 4096 },
      });
      const history = messages.slice(0, -1).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const chat = model.startChat({ history });
      const last = messages[messages.length - 1];
      const result = await chat.sendMessage(last?.content ?? '');
      return { text: result.response.text(), provider: 'gemini', model: this.config.get<string>('geminiModel') ?? 'gemini-2.5-flash' };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('AI provider request failed');
    }
  }
}
