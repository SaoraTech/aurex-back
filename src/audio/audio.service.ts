import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { badRequest, payloadTooLarge } from '../common/errors';
import { ProviderError, providerErrorToHttp } from '../common/provider-error';
import { PlansService } from '../plans/plans.service';
import { UsageService } from '../observability/usage.service';
import { ElevenLabsService } from './elevenlabs.service';
import { sniffAudio } from '../storage/file-signature';
import { normalizeForSpeech } from './speech-text';

export interface SynthesisResult {
  audio: Buffer;
  contentType: string;
  provider: 'elevenlabs';
  fallback: false;
}

export interface TranscriptionResult {
  text: string;
  languageCode?: string;
  provider: 'elevenlabs';
  fallback: false;
}

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly eleven: ElevenLabsService,
    private readonly plans: PlansService,
    private readonly usage: UsageService,
  ) {}

  async synthesize(userId: string, rawText: string, requestId?: string): Promise<SynthesisResult> {
    const spoken = normalizeForSpeech(rawText);
    const maxChars = this.config.get<number>('elevenLabsMaxTextChars') ?? 5000;
    if (!spoken) throw badRequest('EMPTY_TEXT', 'Le texte est vide.');
    if (spoken.length > maxChars) {
      throw payloadTooLarge('TEXT_TOO_LONG', `Le texte dépasse ${maxChars} caractères.`);
    }

    const started = Date.now();
    try {
      const r = await this.eleven.synthesize(spoken);
      await this.usage.record({
        userId,
        kind: 'tts_chars',
        provider: 'elevenlabs',
        units: spoken.length,
        latencyMs: Date.now() - started,
        outcome: 'ok',
        requestId,
      });
      return { ...r, provider: 'elevenlabs', fallback: false };
    } catch (error) {
      const err = error instanceof ProviderError ? error : new ProviderError('elevenlabs', 'unavailable', 'unexpected');
      await this.usage.record({
        userId,
        kind: 'tts_chars',
        provider: 'elevenlabs',
        units: 0,
        latencyMs: Date.now() - started,
        outcome: 'error',
        requestId,
      });
      throw providerErrorToHttp(err, 'La synthèse vocale');
    }
  }

  async transcribe(
    userId: string,
    body: Buffer | undefined,
    options: { declaredMime?: string; filename?: string; language?: string } = {},
    requestId?: string,
  ): Promise<TranscriptionResult> {
    if (!body || !body.length) throw badRequest('EMPTY_BODY', 'Fichier audio manquant.');
    const maxBytes = this.config.get<number>('audioMaxUploadBytes') ?? 20971520;
    if (body.length > maxBytes) {
      throw payloadTooLarge('AUDIO_TOO_LARGE', `Audio trop volumineux (max ${Math.round(maxBytes / 1048576)} Mo).`);
    }

    const kind = sniffAudio(body);
    if (!kind) {
      throw badRequest('INVALID_AUDIO', 'Format audio non reconnu.');
    }

    const file = options.filename ?? `audio.${kind.ext}`;
    const language = options.language ?? this.config.get<string>('audioDefaultLanguage') ?? 'fr';

    if (!this.eleven.isEnabled()) {
      throw providerErrorToHttp(
        new ProviderError('elevenlabs', 'not_configured', 'ElevenLabs STT is not configured'),
        'Le service de reconnaissance vocale',
      );
    }

    const started = Date.now();
    try {
      const r = await this.eleven.transcribe(body, kind.mime, file, language);
      await this.usage.record({
        userId,
        kind: 'stt_call',
        provider: 'elevenlabs',
        units: 1,
        latencyMs: Date.now() - started,
        outcome: 'ok',
        requestId,
      });
      return { text: r.text, languageCode: r.languageCode, provider: 'elevenlabs', fallback: false };
    } catch (error) {
      const err = error instanceof ProviderError ? error : new ProviderError('elevenlabs', 'unavailable', 'unexpected');
      await this.usage.record({
        userId,
        kind: 'stt_call',
        provider: 'elevenlabs',
        units: 0,
        latencyMs: Date.now() - started,
        outcome: 'error',
        requestId,
      });
      throw providerErrorToHttp(err, 'La reconnaissance vocale');
    }
  }
}
