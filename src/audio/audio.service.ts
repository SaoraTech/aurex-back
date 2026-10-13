import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroqSpeechService } from '../ai/groq-speech.service';

export interface TtsOptions {
  voice?: string;
  model?: string;
  provider?: 'elevenlabs' | 'groq';
}

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  provider: 'elevenlabs' | 'groq';
}

export interface SttResult {
  text: string;
  provider: 'groq' | 'elevenlabs';
}

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly groqSpeech: GroqSpeechService,
  ) {}

  /**
   * Synthèse vocale (TTS) avec ElevenLabs comme fournisseur officiel prioritaire
   * et repli transparent vers Groq Speech en cas d'indisponibilité ou d'absence de clé.
   */
  async synthesize(text: string, options: TtsOptions = {}): Promise<TtsResult> {
    const trimmed = text?.trim();
    if (!trimmed) {
      throw new BadRequestException('Le texte à synthétiser ne peut pas être vide.');
    }

    const maxChars = this.config.get<number>('audio.maxTtsChars', 4000);
    if (trimmed.length > maxChars) {
      throw new BadRequestException(
        `Le texte dépasse la limite maximale autorisée de ${maxChars} caractères.`,
      );
    }

    const elevenKey = this.config.get<string>('elevenLabs.apiKey');
    const requestedProvider = options.provider;

    // Tentative ElevenLabs si spécifié ou si la clé est présente et qu'aucun autre fournisseur n'est forcé
    if (requestedProvider === 'elevenlabs' || (!requestedProvider && elevenKey)) {
      if (!elevenKey) {
        if (requestedProvider === 'elevenlabs') {
          throw new ServiceUnavailableException('ElevenLabs n’est pas configuré (clé API manquante).');
        }
      } else {
        try {
          const voiceId = options.voice ?? this.config.get<string>('elevenLabs.voiceId', '21m00Tcm4TlvDq8ikWAM');
          const modelId = options.model ?? this.config.get<string>('elevenLabs.modelId', 'eleven_multilingual_v2');
          const baseUrl = this.config.get<string>('elevenLabs.baseUrl', 'https://api.elevenlabs.io/v1').replace(/\/$/, '');

          const res = await fetch(`${baseUrl}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
              'xi-api-key': elevenKey,
              'Content-Type': 'application/json',
              Accept: 'audio/mpeg',
            },
            body: JSON.stringify({
              text: trimmed,
              model_id: modelId,
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
              },
            }),
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            this.logger.warn(`Échec TTS ElevenLabs (${res.status}): ${errText}`);
            throw new Error(`ElevenLabs error: ${res.status}`);
          }

          const arrayBuffer = await res.arrayBuffer();
          return {
            audio: Buffer.from(arrayBuffer),
            contentType: res.headers.get('content-type') ?? 'audio/mpeg',
            provider: 'elevenlabs',
          };
        } catch (err) {
          if (requestedProvider === 'elevenlabs') {
            throw new ServiceUnavailableException('Le service ElevenLabs est temporairement indisponible.');
          }
          this.logger.warn(`Repli automatique vers Groq TTS suite à l'erreur ElevenLabs: ${(err as Error).message}`);
        }
      }
    }

    // Fournisseur secondaire ou repli : Groq Speech
    try {
      const groqResult = await this.groqSpeech.synthesize(trimmed, options.voice ?? 'Fritz-PlayAI');
      return {
        audio: Buffer.from(groqResult.audio),
        contentType: groqResult.contentType,
        provider: 'groq',
      };
    } catch (groqErr) {
      this.logger.error('Échec de la synthèse vocale sur tous les fournisseurs disponibles', (groqErr as Error).stack);
      throw new ServiceUnavailableException('Aucun service de synthèse vocale n’est actuellement disponible.');
    }
  }

  /**
   * Transcription vocale (STT) avec validation stricte du format et de la taille.
   */
  async transcribe(
    file: { buffer: Buffer; mimetype: string; originalname: string },
    options: { provider?: 'groq' | 'elevenlabs' } = {},
  ): Promise<SttResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Aucun fichier audio valide n’a été transmis.');
    }

    const maxBytes = this.config.get<number>('audio.maxFileBytes', 25_000_000);
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException(`Fichier trop volumineux. Taille maximale : ${maxBytes / 1_000_000} Mo.`);
    }

    const allowedMime = [
      'audio/webm',
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/m4a',
      'audio/x-m4a',
      'audio/ogg',
      'audio/flac',
      'audio/mp4',
    ];

    if (!allowedMime.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        `Type MIME '${file.mimetype}' non supporté. Formats acceptés : WebM, WAV, MP3, M4A, OGG, FLAC.`,
      );
    }

    // Utilisation de Groq Whisper (hautement performant et économique pour la transcription)
    try {
      const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
      const res = await this.groqSpeech.transcribe(blob, file.originalname || 'speech.webm');
      return {
        text: res.text,
        provider: 'groq',
      };
    } catch (err) {
      this.logger.error('Échec de la transcription audio:', (err as Error).stack);
      throw new ServiceUnavailableException('Le service de transcription vocale est temporairement indisponible.');
    }
  }

  /**
   * Retourne l'état des configurations des fournisseurs audio.
   */
  getStatus() {
    const hasElevenLabs = !!this.config.get<string>('elevenLabs.apiKey');
    const hasGroq = !!this.config.get<string>('groqApiKey');
    return {
      elevenLabsConfigured: hasElevenLabs,
      groqConfigured: hasGroq,
      defaultTtsProvider: hasElevenLabs ? 'elevenlabs' : hasGroq ? 'groq' : 'none',
      defaultSttProvider: hasGroq ? 'groq' : 'none',
    };
  }
}
