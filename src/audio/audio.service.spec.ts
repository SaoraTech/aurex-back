import { ProviderError } from '../common/provider-error';
import { AudioService } from './audio.service';

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
function build(o: { eleven?: Partial<any>; groq?: Partial<any>; cfg?: Record<string, unknown>; used?: number } = {}) {
  const eleven: any = { isEnabled: () => true, synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('mp3'), contentType: 'audio/mpeg' }), transcribe: jest.fn().mockResolvedValue({ text: 'bonjour' }), ...o.eleven };
  const groq: any = { isEnabled: () => true, synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('wav'), contentType: 'audio/wav' }), transcribe: jest.fn().mockResolvedValue({ text: 'salut' }), ...o.groq };
  const config: any = { get: (k: string) => ({ elevenLabsMaxTextChars: 100, audioMaxUploadBytes: 1000, audioDefaultLanguage: 'fr', audioSttProvider: 'elevenlabs', audioSttFallbackProvider: 'groq', audioTtsFallbackProvider: 'none', ...o.cfg } as any)[k] };
  const plans: any = { getEffectivePlan: async () => 'free', getLimits: () => ({ free: { dailySpeechChars: 500, dailyTranscriptions: 2 } }) };
  const usage: any = { sumSince: jest.fn().mockResolvedValue(o.used ?? 0), record: jest.fn().mockResolvedValue(undefined) };
  return { svc: new AudioService(config, eleven, groq, plans, usage), eleven, groq, usage };
}

describe('AudioService TTS', () => {
  it('uses ElevenLabs and records usage', async () => {
    const { svc, usage } = build();
    const r = await svc.synthesize('u1', 'Bonjour', undefined, 'rid');
    expect(r).toMatchObject({ provider: 'elevenlabs', contentType: 'audio/mpeg', fallback: false });
    expect(usage.record).toHaveBeenCalledTimes(1);
  });
  it('rejects too long text without calling a provider', async () => {
    const { svc, eleven } = build();
    await expect(svc.synthesize('u1', 'a'.repeat(101))).rejects.toMatchObject({ status: 413 });
    expect(eleven.synthesize).not.toHaveBeenCalled();
  });
  it('enforces the daily plan quota', async () => {
    const { svc, eleven } = build({ used: 499 });
    await expect(svc.synthesize('u1', 'Bonjour tout le monde')).rejects.toMatchObject({ status: 429 });
    expect(eleven.synthesize).not.toHaveBeenCalled();
  });
  it('reports 503 when no TTS provider is configured', async () => {
    const { svc } = build({ eleven: { isEnabled: () => false } });
    await expect(svc.synthesize('u1', 'Bonjour')).rejects.toMatchObject({ status: 503 });
  });
  it('does not fall back to Groq unless explicitly enabled', async () => {
    const { svc, groq } = build({ eleven: { synthesize: jest.fn().mockRejectedValue(new ProviderError('elevenlabs', 'unavailable', 'x')) } });
    await expect(svc.synthesize('u1', 'Bonjour')).rejects.toMatchObject({ status: 502 });
    expect(groq.synthesize).not.toHaveBeenCalled();
  });
  it('falls back to Groq on provider outage when enabled', async () => {
    const { svc, groq } = build({ cfg: { audioTtsFallbackProvider: 'groq' }, eleven: { synthesize: jest.fn().mockRejectedValue(new ProviderError('elevenlabs', 'timeout', 'x')) } });
    expect(await svc.synthesize('u1', 'Bonjour')).toMatchObject({ provider: 'groq', fallback: true });
    expect(groq.synthesize).toHaveBeenCalledTimes(1);
  });
  it('never falls back on an invalid request (no second billed call)', async () => {
    const { svc, groq } = build({ cfg: { audioTtsFallbackProvider: 'groq' }, eleven: { synthesize: jest.fn().mockRejectedValue(new ProviderError('elevenlabs', 'invalid_request', 'x', 422)) } });
    await expect(svc.synthesize('u1', 'Bonjour')).rejects.toMatchObject({ status: 400 });
    expect(groq.synthesize).not.toHaveBeenCalled();
  });
});

describe('AudioService STT', () => {
  it('rejects non-audio bytes regardless of declared type', async () => {
    const { svc, eleven } = build();
    await expect(svc.transcribe('u1', Buffer.from('<html>not audio</html>'))).rejects.toMatchObject({ status: 415 });
    expect(eleven.transcribe).not.toHaveBeenCalled();
  });
  it('rejects oversized audio', async () => {
    const { svc } = build();
    await expect(svc.transcribe('u1', Buffer.concat([WEBM, Buffer.alloc(2000)]))).rejects.toMatchObject({ status: 413 });
  });
  it('transcribes with ElevenLabs', async () => {
    const { svc } = build();
    expect(await svc.transcribe('u1', WEBM)).toMatchObject({ text: 'bonjour', provider: 'elevenlabs', fallback: false });
  });
  it('falls back to Groq Whisper on provider failure', async () => {
    const { svc, groq } = build({ eleven: { transcribe: jest.fn().mockRejectedValue(new ProviderError('elevenlabs', 'rate_limited', 'x', 429)) } });
    expect(await svc.transcribe('u1', WEBM)).toMatchObject({ text: 'salut', provider: 'groq', fallback: true });
    expect(groq.transcribe).toHaveBeenCalledTimes(1);
  });
  it('does not fall back for an invalid audio request', async () => {
    const { svc, groq } = build({ eleven: { transcribe: jest.fn().mockRejectedValue(new ProviderError('elevenlabs', 'invalid_request', 'x', 422)) } });
    await expect(svc.transcribe('u1', WEBM)).rejects.toMatchObject({ status: 400 });
    expect(groq.transcribe).not.toHaveBeenCalled();
  });
  it('enforces the daily transcription quota', async () => {
    const { svc } = build({ used: 2 });
    await expect(svc.transcribe('u1', WEBM)).rejects.toMatchObject({ status: 429 });
  });
});
