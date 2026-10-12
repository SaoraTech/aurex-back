import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiMessage, AiResult, GeminiService } from './gemini.service';
import { CompatibleProvider, OpenAiCompatibleService } from './openai-compatible.service';
import { PlanName } from '../plans/plans.service';

export type AurexModelId = 'kimi' | 'qwen' | 'deepseek' | 'grok' | 'gemini' | 'groq';
const FREE_MODELS: AurexModelId[] = ['kimi', 'qwen', 'deepseek', 'grok'];
const PAID_MODELS: AurexModelId[] = ['gemini', 'groq'];

@Injectable()
export class AiOrchestratorService {
  constructor(private readonly gemini: GeminiService, private readonly compatible: OpenAiCompatibleService) {}

  listModels(plan: PlanName) {
    const ids = plan === 'free' ? FREE_MODELS : PAID_MODELS;
    return ids.map(id => ({ id, provider: id === 'kimi' ? 'Moonshot' : id === 'qwen' ? 'Alibaba Qwen' : id === 'deepseek' ? 'DeepSeek' : id === 'grok' ? 'xAI' : id === 'gemini' ? 'Google Gemini' : 'Groq', defaultForPlan: true }));
  }

  async generate(plan: PlanName, messages: AiMessage[], requestedModel?: string, options?: { systemInstruction?: string; temperature?: number; maxOutputTokens?: number }): Promise<AiResult> {
    const allowed = plan === 'free' ? FREE_MODELS : PAID_MODELS;
    const model = (requestedModel as AurexModelId | undefined) ?? (plan === 'free' ? 'kimi' : 'gemini');
    if (!allowed.includes(model)) throw new BadRequestException(`Model is not available on the ${plan} plan`);
    if (model === 'gemini') return this.gemini.generate(messages, options);
    if (model === 'groq' || model === 'kimi' || model === 'qwen' || model === 'deepseek' || model === 'grok') {
      return this.compatible.generate(model as CompatibleProvider, messages, options);
    }
    throw new ServiceUnavailableException('No AI model is available for this plan');
  }
}
