import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, badRequest, payloadTooLarge, tooManyRequests, unsupportedMedia } from '../common/errors';
import { ProviderError, isFallbackEligible, providerErrorToHttp } from '../common/provider-error';
import { GroqSpeechService } from '../ai/groq-speech.service';
import { UsageService, startOfUtcDay } from '../observability/usage.service';
import { PlansService } from '../plans/plans.service';
import { sniffAudio } from '../storage/file-signature';
import { ElevenLabsService } from './elevenlabs.service';
import { normalizeForSpeech } from './speech-text';

export interface SynthesisResult { audio: Buffer; contentType: string; provider: 'elevenlabs' | 'groq'; fallback: boolean }
export interface TranscriptionResult { text: string; languageCode?: string; provider: 'elevenlabs' | 'groq'; fallback: boolean }

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  constructor(
    private readonly config: ConfigService,
    private readonly eleven: ElevenLabsService,
    private readonly groq: GroqSpeechService,
    private readonly plans: PlansService,
    private readonly usage: UsageService,
  ) {}

  private get defaultLanguage() { return this.config.get<string>('audioDefaultLanguage') ?? 'fr'; }

  async synthesize(userId: string, text: string, languageCode?: string, requestId?: string): Promise<SynthesisResult> {
    const maxChars = this.config.get<number>('elevenLabsMaxTextChars') ?? 5000;
    const language = languageCode ?? this.defaultLanguage;
    const spoken = normalizeForSpeech(text, language);
    if (!spoken) throw badRequest('EMPTY_TEXT', 'Aucun texte à vocaliser.');
    if (spoken.length > maxChars) throw payloadTooLarge('TEXT_TOO_LONG', `Le texte dépasse ${maxChars} caractères.`);

    const useGroqFallback = this.config.get('audioTtsFallbackProvider') === 'groq' && this.groq.isEnabled();
    if (!this.eleven.isEnabled() && !useGroqFallback) throw new AppException(503, 'TTS_UNAVAILABLE', "La synthèse vocale n'est pas configurée sur ce serveur.");

    const plan = await this.plans.getEffectivePlan(userId);
    const used = await this.usage.sumSince(userId, 'tts_chars', startOfUtcDay());
    const limit = this.plans.getLimits()[plan].dailySpeechChars;
    if (used + spoken.length > limit) throw tooManyRequests('SPEECH_QUOTA_EXCEEDED', 'Quota quotidien de synthèse vocale atteint.');

    const started = Date.now();
    if (this.eleven.isEnabled()) {
      try {
        const r = await this.eleven.synthesize(spoken, languageCode);
        await this.usage.record({ userId, kind: 'tts_chars', provider: 'elevenlabs', units: spoken.length, latencyMs: Date.now() - started, outcome: 'ok', requestId });
        return { ...r, provider: 'elevenlabs', fallback: false };
      } catch (error) {
        const err = error instanceof ProviderError ? error : new ProviderError('elevenlabs', 'unavailable', 'unexpected');
        await this.usage.record({ userId, kind: 'tts_chars', provider: 'elevenlabs', units: 0, latencyMs: Date.now() - started, outcome: err.kind, requestId });
        if (!(useGroqFallback && isFallbackEligible(err.kind))) throw providerErrorToHttp(err, 'Le service vocal');
        this.logger.warn({ msg: 'tts_fallback_to_groq', kind: err.kind });
      }
    }
    try {
      const r = await this.groq.synthesize(spoken);
      await this.usage.record({ userId, kind: 'tts_chars', provider: 'groq', units: spoken.length, latencyMs: Date.now() - started, outcome: 'ok', requestId });
      return { ...r, provider: 'groq', fallback: this.eleven.isEnabled() };
    } catch (error) {
      throw providerErrorToHttp(error instanceof ProviderError ? error : new ProviderError('groq', 'unavailable', 'unexpected'), 'Le service vocal');
    }
  }

  async transcribe(userId: string, body: Buffer | undefined, languageCode?: string, requestId?: string): Promise<TranscriptionResult> {
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('AUDIO_REQUIRED', "Envoyez l'audio dans le corps de la requête.");
    const max = this.config.get<number>('audioMaxUploadBytes') ?? 20971520;
    if (body.length > max) throw payloadTooLarge('AUDIO_TOO_LARGE', `Audio trop volumineux (max ${max} octets).`);
    // Trust the bytes, not the client-declared Content-Type.
    const kind = sniffAudio(body);
    if (!kind) throw unsupportedMedia('UNSUPPORTED_AUDIO_TYPE', 'Format audio non pris en charge.');

    const primary = this.config.get<'elevenlabs' | 'groq'>('audioSttProvider') ?? 'elevenlabs';
    const fallbackName = this.config.get<'none' | 'groq'>('audioSttFallbackProvider') ?? 'groq';
    const order: Array<'elevenlabs' | 'groq'> = [primary];
    if (fallbackName === 'groq' && primary !== 'groq') order.push('groq');
    const available = order.filter(p => (p === 'elevenlabs' ? this.eleven.isEnabled() : this.groq.isEnabled()));
    if (!available.length) throw new AppException(503, 'STT_UNAVAILABLE', "La transcription n'est pas configurée sur ce serveur.");

    const plan = await this.plans.getEffectivePlan(userId);
    const used = await this.usage.sumSince(userId, 'stt_call', startOfUtcDay());
    if (used >= this.plans.getLimits()[plan].dailyTranscriptions) throw tooManyRequests('TRANSCRIPTION_QUOTA_EXCEEDED', 'Quota quotidien de transcription atteint.');

    const language = languageCode ?? this.defaultLanguage;
    let lastError: ProviderError | undefined;
    for (const [i, provider] of available.entries()) {
      const started = Date.now();
      try {
        const file = `audio.${kind.ext}`;
        const r = provider === 'elevenlabs' ? await this.eleven.transcribe(body, kind.mime, file, language) : await this.groq.transcribe(body, kind.mime, file, language);
        await this.usage.record({ userId, kind: 'stt_call', provider, units: 1, latencyMs: Date.now() - started, outcome: 'ok', requestId });
        return { ...r, provider, fallback: i > 0 };
      } catch (error) {
        const err = error instanceof ProviderError ? error : new ProviderError(provider, 'unavailable', 'unexpected');
        await this.usage.record({ userId, kind: 'stt_call', provider, units: 1, latencyMs: Date.now() - started, outcome: err.kind, requestId });
        lastError = err;
        if (!isFallbackEligible(err.kind)) break; // invalid audio must not trigger another billed call
        this.logger.warn({ msg: 'stt_provider_failed', provider, kind: err.kind, willFallback: i < available.length - 1 });
      }
    }
    throw providerErrorToHttp(lastError!, 'Le service de transcription');
  }
}
