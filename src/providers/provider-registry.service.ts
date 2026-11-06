import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LlmModelId = 'groq';
export type ProviderState = 'disabled' | 'not_configured' | 'configured' | 'not_implemented';

@Injectable()
export class ProviderRegistryService {
  constructor(private readonly config: ConfigService) {}

  private state(enabled: boolean, ready: boolean): ProviderState {
    if (!enabled) return 'disabled';
    return ready ? 'configured' : 'not_configured';
  }

  snapshot() {
    const c = (k: string) => this.config.get(k);
    const groqReady = !!c('groqApiKey');
    const azureReady = !!c('azureSpeechKey') && !!c('azureSpeechRegion') && !!c('azureSpeechResourceName');

    return {
      llm: [
        {
          id: 'groq' as LlmModelId,
          provider: 'Groq',
          state: groqReady ? ('configured' as ProviderState) : ('not_configured' as ProviderState),
        },
      ],
      webSearch: {
        brave: this.state(!!c('braveSearchEnabled'), !!c('braveSearchApiKey')),
      },
      speech: {
        textToSpeech: {
          azure: this.state(!!c('azureSpeechEnabled'), azureReady),
        },
        speechToText: {
          azure: this.state(!!c('azureSpeechEnabled'), azureReady),
        },
      },
      storage: {
        cloudflareR2: this.state(
          !!c('r2Enabled'),
          !!c('r2AccountId') && !!c('r2Bucket') && !!c('r2AccessKeyId') && !!c('r2SecretAccessKey'),
        ),
      },
      math: {
        sagemath: 'configured' as ProviderState,
      },
      security: {
        arcjet: c('arcjetMode') === 'disabled' ? ('disabled' as ProviderState) : this.state(true, !!c('arcjetKey')),
      },
      notifications: {
        novu: 'not_implemented' as ProviderState,
        resend: 'not_implemented' as ProviderState,
      },
      payments: {
        provider: 'jemenipay',
        state: (c('jemenipayApiKey') && c('jemenipaySecretKey')) ? ('configured' as ProviderState) : ('not_configured' as ProviderState),
      },
    };
  }
}
