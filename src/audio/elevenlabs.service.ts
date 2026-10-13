import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertOk, fetchWithTimeout } from '../common/http';
import { ProviderError, kindFromStatus } from '../common/provider-error';
import { MetricsService } from '../observability/metrics.service';

const BASE = 'https://api.elevenlabs.io';

/** ElevenLabs adapter. Voice, models and output format come from server configuration only. */
@Injectable()
export class ElevenLabsService {
  constructor(private readonly config: ConfigService, private readonly metrics: MetricsService) {}

  isEnabled(): boolean { return !!this.config.get('elevenLabsEnabled') && !!this.config.get('elevenLabsApiKey') && !!this.config.get('elevenLabsTtsVoiceId'); }
  private key(): string {
    if (!this.isEnabled()) throw new ProviderError('elevenlabs', 'not_configured', 'elevenlabs is disabled or not configured');
    return this.config.get<string>('elevenLabsApiKey')!;
  }
  private get timeout() { return this.config.get<number>('elevenLabsTimeoutMs') ?? 30000; }

  async synthesize(text: string, languageCode?: string): Promise<{ audio: Buffer; contentType: string }> {
    const key = this.key();
    const voiceId = this.config.get<string>('elevenLabsTtsVoiceId')!;
    const modelId = this.config.get<string>('elevenLabsTtsModelId') ?? 'eleven_multilingual_v2';
    const format = this.config.get<string>('elevenLabsTtsOutputFormat') ?? 'mp3_44100_128';
    return this.metrics.track('elevenlabs', 'tts', async () => {
      const url = new URL(`${BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
      url.searchParams.set('output_format', format);
      const body: Record<string, unknown> = { text, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } };
      // language_code is not supported by eleven_multilingual_v2 (it infers the language from the text).
      if (languageCode && modelId !== 'eleven_multilingual_v2') body.language_code = languageCode;
      const res = await fetchWithTimeout('elevenlabs', url, {
        method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body),
      }, this.timeout);
      assertOk('elevenlabs', res, kindFromStatus);
      const audio = Buffer.from(await res.arrayBuffer());
      if (!audio.length) throw new ProviderError('elevenlabs', 'bad_response', 'elevenlabs returned empty audio');
      return { audio, contentType: 'audio/mpeg' };
    });
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string, languageCode?: string): Promise<{ text: string; languageCode?: string }> {
    const key = this.key();
    return this.metrics.track('elevenlabs', 'stt', async () => {
      const form = new FormData();
      form.set('model_id', this.config.get<string>('elevenLabsSttModelId') ?? 'scribe_v2');
      form.set('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
      if (languageCode) form.set('language_code', languageCode);
      const res = await fetchWithTimeout('elevenlabs', `${BASE}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: form }, this.timeout);
      assertOk('elevenlabs', res, kindFromStatus);
      let json: { text?: unknown; language_code?: unknown };
      try { json = await res.json() as typeof json; } catch { throw new ProviderError('elevenlabs', 'bad_response', 'elevenlabs returned invalid JSON'); }
      if (typeof json.text !== 'string' || !json.text.trim()) throw new ProviderError('elevenlabs', 'bad_response', 'elevenlabs returned an empty transcript');
      return { text: json.text.trim(), languageCode: typeof json.language_code === 'string' ? json.language_code : undefined };
    });
  }
}
