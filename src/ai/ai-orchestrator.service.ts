import { Injectable, Logger } from '@nestjs/common';
import { ProviderError, providerErrorToHttp } from '../common/provider-error';
import { PlanName } from '../plans/plans.service';
import { UsageService } from '../observability/usage.service';
import { AiMessage, AiOptions, AiResult } from './ai.types';
import { GroqLlmService } from './groq-llm.service';

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly groq: GroqLlmService,
    private readonly usage: UsageService,
  ) {}

  listModels(_plan?: string) {
    return [{ id: 'groq', name: `Groq (${this.groq.getModel()})`, provider: 'groq' }];
  }

  async generate(
    _plan: PlanName,
    messages: AiMessage[],
    _model?: string,
    options: AiOptions = {},
    requestId?: string,
    userId?: string,
  ): Promise<AiResult> {
    const started = Date.now();
    try {
      const result = await this.groq.generate(messages, options);
      if (userId) {
        await this.usage.record({
          userId,
          kind: 'llm_call',
          provider: 'groq',
          units: result.tokens ?? 1,
          latencyMs: result.latencyMs ?? (Date.now() - started),
          outcome: 'ok',
          requestId,
        });
      }
      return result;
    } catch (error) {
      const err = error instanceof ProviderError ? error : new ProviderError('groq', 'unavailable', 'Unknown error');
      this.logger.warn({ msg: 'groq_generation_failed', kind: err.kind, detail: err.message });
      if (userId) {
        await this.usage.record({
          userId,
          kind: 'llm_call',
          provider: 'groq',
          units: 0,
          latencyMs: Date.now() - started,
          outcome: 'error',
          requestId,
        });
      }
      throw providerErrorToHttp(err, 'Le modèle de calcul et de raisonnement');
    }
  }
}
