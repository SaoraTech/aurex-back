import { ProviderError } from '../common/provider-error';
import { AudioService } from './audio.service';

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);

function build(o: { eleven?: Partial<any>; cfg?: Record<string, unknown>; quotaAllowed?: boolean } = {}) {
  const eleven: any = {
    isEnabled: () => true,
    synthesize: jest.fn().mockResolvedValue({ audio: Buffer.from('mp3'), contentType: 'audio/mpeg' }),
    transcribe: jest.fn().mockResolvedValue({ text: 'bonjour' }),
    ...o.eleven,
  };
  const config: any = {
    get: (k: string) =>
      ({
        elevenLabsMaxTextChars: 100,
        audioMaxUploadBytes: 1000,
        audioDefaultLanguage: 'fr',
        ...o.cfg,
      })[k],
  };
  const plans: any = {
    getEffectivePlan: jest.fn().mockResolvedValue('free'),
  };
  const quotas: any = {
    reserveQuota: jest.fn().mockResolvedValue({
      allowed: o.quotaAllowed ?? true,
      limit: 10,
      used: 10,
      remaining: 0,
      resetAt: new Date().toISOString(),
      errorCode: 'FEATURE_LIMIT_REACHED',
      errorMessage: 'Quota de synthèse vocale atteint.',
    }),
    commitQuota: jest.fn().mockResolvedValue(undefined),
    compensateQuota: jest.fn().mockResolvedValue(undefined),
  };
  const usage: any = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    svc: new AudioService(config, eleven, plans, quotas, usage),
    eleven,
    quotas,
    usage,
  };
}

describe('AudioService - ElevenLabs Sole Provider & Atomic Quotas', () => {
  it('synthesizes text using ElevenLabs exclusively with quota reservation', async () => {
    const { svc, eleven, quotas, usage } = build();
    const r = await svc.synthesize('u1', 'Bonjour');
    expect(r.provider).toBe('elevenlabs');
    expect(r.fallback).toBe(false);
    expect(eleven.synthesize).toHaveBeenCalledWith('Bonjour');
    expect(quotas.reserveQuota).toHaveBeenCalledWith('u1', 'tts_speech', 'free', expect.any(String), 7);
    expect(quotas.commitQuota).toHaveBeenCalled();
    expect(usage.record).toHaveBeenCalledTimes(1);
  });

  it('rejects text exceeding max length before reserving quota', async () => {
    const { svc, quotas } = build();
    await expect(svc.synthesize('u1', 'a'.repeat(101))).rejects.toMatchObject({ status: 413 });
    expect(quotas.reserveQuota).not.toHaveBeenCalled();
  });

  it('throws 429 when tts quota limit is reached', async () => {
    const { svc } = build({ quotaAllowed: false });
    await expect(svc.synthesize('u1', 'Bonjour')).rejects.toMatchObject({ status: 429 });
  });

  it('compensates reserved quota when ElevenLabs fails', async () => {
    const { svc, quotas } = build({
      eleven: { synthesize: jest.fn().mockRejectedValue(new ProviderError('elevenlabs', 'unavailable', 'err')) },
    });
    await expect(svc.synthesize('u1', 'Bonjour')).rejects.toMatchObject({ status: 502 });
    expect(quotas.compensateQuota).toHaveBeenCalled();
  });

  it('transcribes valid audio using ElevenLabs with quota check', async () => {
    const { svc, eleven, quotas } = build();
    const r = await svc.transcribe('u1', WEBM);
    expect(r.provider).toBe('elevenlabs');
    expect(r.text).toBe('bonjour');
    expect(r.fallback).toBe(false);
    expect(quotas.reserveQuota).toHaveBeenCalledWith('u1', 'stt_transcription', 'free', expect.any(String), 1);
    expect(eleven.transcribe).toHaveBeenCalled();
  });

  it('rejects invalid audio bytes without consuming quota', async () => {
    const { svc, quotas } = build();
    await expect(svc.transcribe('u1', Buffer.from('not an audio file'))).rejects.toMatchObject({ status: 400 });
    expect(quotas.reserveQuota).not.toHaveBeenCalled();
  });
});
