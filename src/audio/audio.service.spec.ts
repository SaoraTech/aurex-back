import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AudioService } from './audio.service';
import { GroqSpeechService } from '../ai/groq-speech.service';

describe('AudioService', () => {
  let service: AudioService;
  let configService: jest.Mocked<ConfigService>;
  let groqSpeech: jest.Mocked<GroqSpeechService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'elevenLabs.apiKey') return 'test-eleven-key';
        if (key === 'elevenLabs.voiceId') return 'test-voice';
        if (key === 'elevenLabs.modelId') return 'eleven_multilingual_v2';
        if (key === 'elevenLabs.baseUrl') return 'https://api.elevenlabs.io/v1';
        if (key === 'audio.maxTtsChars') return 4000;
        if (key === 'audio.maxFileBytes') return 25_000_000;
        if (key === 'groqApiKey') return 'test-groq-key';
        return defaultValue;
      }),
    } as any;

    groqSpeech = {
      synthesize: jest.fn().mockResolvedValue({
        audio: new Uint8Array([1, 2, 3]),
        contentType: 'audio/wav',
      }),
      transcribe: jest.fn().mockResolvedValue({
        text: 'Transcription réussie de la formule mathématique',
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: ConfigService, useValue: configService },
        { provide: GroqSpeechService, useValue: groqSpeech },
      ],
    }).compile();

    service = module.get<AudioService>(AudioService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects empty text for synthesis', async () => {
    await expect(service.synthesize('')).rejects.toThrow(BadRequestException);
  });

  it('rejects text exceeding character limit', async () => {
    const longText = 'a'.repeat(4001);
    await expect(service.synthesize(longText)).rejects.toThrow(BadRequestException);
  });

  it('synthesizes text using ElevenLabs when API key is configured', async () => {
    const mockAudioBytes = new Uint8Array([10, 20, 30]);
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      headers: {
        get: (h: string) => (h.toLowerCase() === 'content-type' ? 'audio/mpeg' : null),
      },
      arrayBuffer: async () => mockAudioBytes.buffer,
    } as any);

    const result = await service.synthesize('Bonjour Aurex');
    expect(result.provider).toBe('elevenlabs');
    expect(result.contentType).toBe('audio/mpeg');
    expect(result.audio).toBeInstanceOf(Buffer);
  });

  it('falls back to Groq TTS when ElevenLabs fails with a transient error', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as any);

    const result = await service.synthesize('Calcul d’intégrale');
    expect(result.provider).toBe('groq');
    expect(groqSpeech.synthesize).toHaveBeenCalledWith('Calcul d’intégrale', 'Fritz-PlayAI');
  });

  it('transcribes valid audio with Groq Whisper', async () => {
    const fakeFile = {
      buffer: Buffer.from([1, 2, 3, 4]),
      mimetype: 'audio/webm',
      originalname: 'test.webm',
    };

    const res = await service.transcribe(fakeFile);
    expect(res.text).toContain('Transcription réussie');
    expect(res.provider).toBe('groq');
  });

  it('rejects unsupported MIME types for transcription', async () => {
    const fakeFile = {
      buffer: Buffer.from([1, 2, 3]),
      mimetype: 'application/pdf',
      originalname: 'doc.pdf',
    };

    await expect(service.transcribe(fakeFile)).rejects.toThrow(BadRequestException);
  });
});
