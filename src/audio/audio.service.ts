import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, badRequest, payloadTooLarge } from '../common/errors';
import { newId } from '../common/ids';
import { ProviderError, providerErrorToHttp, toProviderError } from '../common/provider-error';
import { PlansService } from '../plans/plans.service';
import { QuotasService } from '../quotas/quotas.service';
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
    private readonly quotas: QuotasService,
    private readonly usage: UsageService,
  ) {}

  async synthesize(
    userId: string,
    rawText: string,
    requestId?: string,
  ): Promise<SynthesisResult> {
    const spoken = normalizeForSpeech(rawText);
    const maxChars = this.config.get<number>('elevenLabsMaxTextChars') ?? 5000;
    if (!spoken) throw badRequest('EMPTY_TEXT', 'Le texte est vide.');
    if (spoken.length > maxChars) {
      throw payloadTooLarge(
        'TEXT_TOO_LONG',
        `Le texte dépasse ${maxChars} caractères.`,
      );
    }

    if (!this.eleven.isEnabled()) {
      throw providerErrorToHttp(
        new ProviderError('elevenlabs', 'not_configured', 'ElevenLabs TTS is not configured'),
        'Le service de synthèse vocale',
      );
    }

    // Atomic Quota Check & Reservation for TTS character count
    const plan = await this.plans.getEffectivePlan(userId);
    const opId = requestId ?? newId();
    const quotaRes = await this.quotas.reserveQuota(
      userId,
      'tts_speech',
      plan,
      opId,
      spoken.length,
    );

    if (!quotaRes.allowed) {
      throw new AppException(
        429,
        quotaRes.errorCode ?? 'TTS_QUOTA_EXCEEDED',
        quotaRes.errorMessage ?? 'Quota de synthèse vocale atteint.',
        {
          feature: quotaRes.feature,
          limit: quotaRes.limit,
          used: quotaRes.used,
          remaining: quotaRes.remaining,
          resetAt: quotaRes.resetAt,
          retryAfterSeconds: quotaRes.retryAfterSeconds,
        },
        quotaRes.retryAfterSeconds,
      );
    }

    const started = Date.now();
    try {
      const r = await this.eleven.synthesize(spoken);
      await this.quotas.commitQuota(opId);

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
      // Compensate quota reservation on provider error
      await this.quotas.compensateQuota(opId);

      const err = toProviderError('elevenlabs', error);
      this.logger.warn(JSON.stringify({
        event: 'audio.provider_failure',
        provider: err.provider,
        operation: 'tts',
        kind: err.kind,
        httpStatus: err.status ?? null,
        durationMs: Date.now() - started,
        requestId: requestId ?? null,
      }));

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
      throw payloadTooLarge(
        'AUDIO_TOO_LARGE',
        `Audio trop volumineux (max ${Math.round(maxBytes / 1048576)} Mo).`,
      );
    }

    const kind = sniffAudio(body);
    if (!kind) {
      throw badRequest('INVALID_AUDIO', 'Format audio non reconnu.');
    }

    if (!this.eleven.isEnabled()) {
      throw providerErrorToHttp(
        new ProviderError('elevenlabs', 'not_configured', 'ElevenLabs STT is not configured'),
        'Le service de reconnaissance vocale',
      );
    }

    // Atomic Quota Check & Reservation for STT transcription call
    const plan = await this.plans.getEffectivePlan(userId);
    const opId = requestId ?? newId();
    const quotaRes = await this.quotas.reserveQuota(
      userId,
      'stt_transcription',
      plan,
      opId,
      1,
    );

    if (!quotaRes.allowed) {
      throw new AppException(
        429,
        quotaRes.errorCode ?? 'STT_QUOTA_EXCEEDED',
        quotaRes.errorMessage ?? 'Quota de reconnaissance vocale atteint.',
        {
          feature: quotaRes.feature,
          limit: quotaRes.limit,
          used: quotaRes.used,
          remaining: quotaRes.remaining,
          resetAt: quotaRes.resetAt,
          retryAfterSeconds: quotaRes.retryAfterSeconds,
        },
        quotaRes.retryAfterSeconds,
      );
    }

    const file = options.filename ?? `audio.${kind.ext}`;
    const language =
      options.language ??
      this.config.get<string>('audioDefaultLanguage') ??
      'fr';

    const started = Date.now();
    try {
      const r = await this.eleven.transcribe(body, kind.mime, file, language);
      await this.quotas.commitQuota(opId);

      await this.usage.record({
        userId,
        kind: 'stt_call',
        provider: 'elevenlabs',
        units: 1,
        latencyMs: Date.now() - started,
        outcome: 'ok',
        requestId,
      });

      return {
        text: r.text,
        languageCode: r.languageCode,
        provider: 'elevenlabs',
        fallback: false,
      };
    } catch (error) {
      await this.quotas.compensateQuota(opId);

      const err = toProviderError('elevenlabs', error);
      this.logger.warn(JSON.stringify({
        event: 'audio.provider_failure',
        provider: err.provider,
        operation: 'stt',
        kind: err.kind,
        httpStatus: err.status ?? null,
        durationMs: Date.now() - started,
        requestId: requestId ?? null,
      }));

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
