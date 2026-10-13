import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, badRequest } from '../common/errors';
import { ProviderError, isFallbackEligible, providerErrorToHttp } from '../common/provider-error';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { PlanName } from '../plans/plans.service';
import { AiMessage, AiOptions, AiResult, AurexModelId } from './ai.types';
import { GeminiService } from './gemini.service';
import { CompatibleProvider, OpenAiCompatibleService } from './openai-compatible.service';

export type { AurexModelId } from './ai.types';
const FREE_MODELS: AurexModelId[] = ['kimi', 'qwen', 'deepseek', 'grok'];
const PAID_MODELS: AurexModelId[] = ['gemini', 'groq'];

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);
  constructor(
    private readonly gemini: GeminiService,
    private readonly compatible: OpenAiCompatibleService,
    private readonly registry: ProviderRegistryService,
    private readonly config: ConfigService,
  ) {}

  allowedModels(plan: PlanName): AurexModelId[] { return plan === 'free' ? FREE_MODELS : PAID_MODELS; }

  listModels(plan: PlanName) {
    return this.allowedModels(plan).map(id => ({
      id, provider: this.registry.llmLabel(id), defaultForPlan: id === this.allowedModels(plan)[0], available: this.registry.isLlmConfigured(id),
    }));
  }

  /**
   * Generates an answer with controlled fallback:
   *  - the model must be allowed by the user's plan (server-side);
   *  - only configured providers are attempted; at most 1 + AI_MAX_FALLBACKS provider calls are made;
   *  - a fallback happens ONLY for provider-side failures (timeout, quota, rate limit, 5xx, bad output);
   *    an invalid request never triggers a second billed call;
   *  - the result reports which provider answered and which one it replaced.
   */
  async generate(plan: PlanName, messages: AiMessage[], requestedModel?: string, options?: AiOptions): Promise<AiResult> {
    const allowed = this.allowedModels(plan);
    if (requestedModel && !allowed.includes(requestedModel as AurexModelId)) throw badRequest('MODEL_NOT_AVAILABLE', `Model is not available on the ${plan} plan`);
    const first = (requestedModel as AurexModelId | undefined) ?? allowed[0];
    const maxCalls = 1 + (this.config.get<number>('aiMaxFallbacks') ?? 1);
    const candidates = [first, ...allowed.filter(m => m !== first)].filter(m => this.registry.isLlmConfigured(m));
    if (!candidates.length) throw new AppException(503, 'AI_NOT_CONFIGURED', "Aucun modèle d'IA n'est configuré pour ce forfait.");

    let lastError: ProviderError | undefined;
    let attempts = 0;
    for (const model of candidates) {
      if (attempts >= maxCalls) break;
      attempts++;
      try {
        const result = await this.call(model, messages, options);
        return model === first ? result : { ...result, fallbackFrom: first };
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        lastError = error;
        this.logger.warn({ msg: 'ai_provider_failed', provider: model, kind: error.kind, willFallback: isFallbackEligible(error.kind) && attempts < maxCalls });
        if (!isFallbackEligible(error.kind)) throw providerErrorToHttp(error, 'Le modèle');
      }
    }
    throw lastError ? providerErrorToHttp(lastError, 'Le modèle') : new AppException(503, 'AI_UNAVAILABLE', "Aucun modèle d'IA n'est disponible.");
  }

  private call(model: AurexModelId, messages: AiMessage[], options?: AiOptions): Promise<AiResult> {
    if (model === 'gemini') return this.gemini.generate(messages, options);
    return this.compatible.generate(model as CompatibleProvider, messages, options);
  }
}
