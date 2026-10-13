import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LlmModelId = 'kimi' | 'qwen' | 'deepseek' | 'grok' | 'gemini' | 'groq';
/**
 * `configured` means "enabled and credentials present". It is NOT a live health check: no provider is called
 * to produce this snapshot (calls are billed). Use real traffic metrics for actual availability.
 */
export type ProviderState = 'disabled' | 'not_configured' | 'configured' | 'not_implemented';

const LLM_LABELS: Record<LlmModelId, string> = {
  kimi: 'Moonshot Kimi', qwen: 'Alibaba Qwen', deepseek: 'DeepSeek', grok: 'xAI Grok', gemini: 'Google Gemini', groq: 'Groq',
};

@Injectable()
export class ProviderRegistryService {
  constructor(private readonly config: ConfigService) {}

  llmLabel(id: LlmModelId) { return LLM_LABELS[id]; }
  isLlmConfigured(id: LlmModelId): boolean {
    if (id === 'gemini') return !!this.config.get('geminiApiKey');
    return !!this.config.get(`${id}ApiKey`) && !!this.config.get(`${id}BaseUrl`) && !!this.config.get(`${id}Model`);
  }

  private state(enabled: boolean, ready: boolean): ProviderState {
    if (!enabled) return 'disabled';
    return ready ? 'configured' : 'not_configured';
  }

  snapshot() {
    const c = (k: string) => this.config.get(k);
    const llm = (Object.keys(LLM_LABELS) as LlmModelId[]).map(id => ({
      id, provider: LLM_LABELS[id], state: this.isLlmConfigured(id) ? 'configured' as ProviderState : 'not_configured' as ProviderState,
    }));
    const elevenReady = !!c('elevenLabsApiKey') && !!c('elevenLabsTtsVoiceId');
    const groqSpeechReady = !!c('groqApiKey');
    return {
      llm,
      webSearch: { tavily: this.state(!!c('tavilyEnabled'), !!c('tavilyApiKey')) },
      speech: {
        textToSpeech: {
          elevenlabs: this.state(!!c('elevenLabsEnabled'), elevenReady),
          groq: c('audioTtsFallbackProvider') === 'groq' ? this.state(!!c('groqSpeechEnabled'), groqSpeechReady) : 'disabled' as ProviderState,
        },
        speechToText: {
          elevenlabs: this.state(!!c('elevenLabsEnabled'), elevenReady),
          groq: this.state(!!c('groqSpeechEnabled'), groqSpeechReady),
        },
      },
      storage: { cloudflareR2: this.state(!!c('r2Enabled'), !!c('r2AccountId') && !!c('r2Bucket') && !!c('r2AccessKeyId') && !!c('r2SecretAccessKey')) },
      math: { wolframAlpha: this.state(true, !!c('wolframAppId')) },
      security: { arcjet: c('arcjetMode') === 'disabled' ? 'disabled' as ProviderState : this.state(true, !!c('arcjetKey')) },
      // Novu/Resend/payment adapters are not implemented in this codebase: never presented as active.
      notifications: { novu: 'not_implemented' as ProviderState, resend: 'not_implemented' as ProviderState },
      payments: { provider: String(c('paymentProvider') ?? 'disabled'), state: 'not_implemented' as ProviderState },
    };
  }
}
