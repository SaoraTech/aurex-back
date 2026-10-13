import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertOk, fetchWithTimeout } from '../common/http';
import { ProviderError, kindFromStatus } from '../common/provider-error';
import { MetricsService } from '../observability/metrics.service';

/**
 * Groq speech adapter (secondary/fallback provider). Active only when GROQ_SPEECH_ENABLED=true and a key is
 * set. Model/voice availability depends on the Groq account and changes over time: verify before relying on
 * the TTS path (it is opt-in via AUDIO_TTS_FALLBACK_PROVIDER=groq; STT fallback uses a Whisper model).
 */
@Injectable()
export class GroqSpeechService {
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {}

  isEnabled(): boolean { return !!this.config.get('groqSpeechEnabled') && !!this.config.get('groqApiKey'); }
  private base(): string { return (this.config.get<string>('groqBaseUrl') ?? 'https://api.groq.com/openai/v1').replace(/\/$/, ''); }
  private key(): string {
    const key = this.config.get<string>('groqApiKey');
    if (!this.config.get('groqSpeechEnabled') || !key) throw new ProviderError('groq', 'not_configured', 'groq speech is disabled or not configured');
    return key;
  }

  async synthesize(text: string): Promise<{ audio: Buffer; contentType: string }> {
    const key = this.key();
    return this.metrics.track('groq', 'tts', async () => {
      const res = await fetchWithTimeout('groq', `${this.base()}/audio/speech`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.get('groqTtsModel') ?? 'playai-tts', voice: this.config.get('groqTtsVoice') ?? 'Fritz-PlayAI', input: text, response_format: 'wav' }),
      }, this.config.get<number>('groqSpeechTimeoutMs') ?? 30000);
      assertOk('groq', res, kindFromStatus);
      const audio = Buffer.from(await res.arrayBuffer());
      if (!audio.length) throw new ProviderError('groq', 'bad_response', 'groq returned empty audio');
      return { audio, contentType: 'audio/wav' };
    });
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string, languageCode?: string): Promise<{ text: string; languageCode?: string }> {
    const key = this.key();
    return this.metrics.track('groq', 'stt', async () => {
      const form = new FormData();
      form.set('model', this.config.get('groqSttModel') ?? 'whisper-large-v3-turbo');
      form.set('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
      if (languageCode) form.set('language', languageCode);
      const res = await fetchWithTimeout('groq', `${this.base()}/audio/transcriptions`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      }, this.config.get<number>('groqSpeechTimeoutMs') ?? 30000);
      assertOk('groq', res, kindFromStatus);
      let json: { text?: unknown; language?: unknown };
      try { json = await res.json() as typeof json; } catch { throw new ProviderError('groq', 'bad_response', 'groq returned invalid JSON'); }
      if (typeof json.text !== 'string' || !json.text.trim()) throw new ProviderError('groq', 'bad_response', 'groq returned an empty transcript');
      return { text: json.text.trim(), languageCode: typeof json.language === 'string' ? json.language : undefined };
    });
  }
}
