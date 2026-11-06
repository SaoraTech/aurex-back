import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../observability/metrics.service';
import { AzureSpeechService } from './azure-speech.service';

const configValues: Record<string, unknown> = {
  azureSpeechEnabled: 'true',
  azureSpeechKey: 'test-key',
  azureSpeechRegion: 'eastus',
  azureSpeechResourceName: 'aurex-speech',
  azureSpeechTimeoutMs: 5000,
  azureSpeechTtsVoiceFr: 'fr-FR-DeniseNeural',
  azureSpeechTtsVoiceEn: 'en-US-JennyNeural',
  azureSpeechTtsOutputFormat: 'audio-16khz-128kbitrate-mono-mp3',
};

describe('AzureSpeechService', () => {
  let service: AzureSpeechService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    const config = { get: (key: string) => configValues[key] } as unknown as ConfigService;
    const metrics = { track: (_provider: string, _operation: string, fn: () => Promise<unknown>) => fn() } as unknown as MetricsService;
    service = new AzureSpeechService(config, metrics);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends escaped SSML to the regional Azure TTS endpoint', async () => {
    fetchSpy.mockResolvedValue(new Response(Buffer.from('mp3-data'), {
      status: 200, headers: { 'content-type': 'audio/mpeg' },
    }));
    const result = await service.synthesize('A < B & C', 'fr');
    expect(result.audio.toString()).toBe('mp3-data');
    expect(result.contentType).toBe('audio/mpeg');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
    expect((init as RequestInit).headers).toMatchObject({
      'Ocp-Apim-Subscription-Key': 'test-key',
      'Content-Type': 'application/ssml+xml',
    });
    expect(String((init as RequestInit).body)).toContain('A &lt; B &amp; C');
  });

  it('posts raw audio and locale definition to Azure Fast Transcription', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      durationMilliseconds: 4200,
      combinedPhrases: [{ text: 'Bonjour.', locale: 'fr-FR' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await service.transcribe(Buffer.from('audio'), 'audio/webm', 'sample.webm', 'fr');
    expect(result).toEqual({ text: 'Bonjour.', languageCode: 'fr-FR', durationMilliseconds: 4200 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('https://aurex-speech.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15');
    const form = (init as RequestInit).body as FormData;
    expect(JSON.parse(String(form.get('definition')))).toEqual({ locales: ['fr-FR'] });
    expect(form.get('audio')).toBeTruthy();
    expect((init as RequestInit).headers).toMatchObject({ 'Ocp-Apim-Subscription-Key': 'test-key' });
  });

  it('rejects empty transcription responses without exposing provider payloads', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ durationMilliseconds: 10, combinedPhrases: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await expect(service.transcribe(Buffer.from('audio'), 'audio/wav', 'sample.wav', 'en'))
      .rejects.toMatchObject({ provider: 'azure-speech', kind: 'bad_response' });
  });
});
