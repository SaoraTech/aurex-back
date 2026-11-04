import { ProviderError } from '../common/provider-error';
import { AudioService } from './audio.service';

const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]);

function build(o: { eleven?: Partial<any>; cfg?: Record<string, unknown> } = {}) {
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
  const plans: any = {};
  const usage: any = { record: jest.fn().mockResolvedValue(undefined) };
  return { svc: new AudioService(config, eleven, plans, usage), eleven, usage };
}

describe('AudioService - ElevenLabs Sole Provider', () => {
  it('synthesizes text using ElevenLabs exclusively', async () => {
    const { svc, eleven, usage } = build();
    const r = await svc.synthesize('u1', 'Bonjour');
    expect(r.provider).toBe('elevenlabs');
    expect(r.fallback).toBe(false);
    expect(eleven.synthesize).toHaveBeenCalledWith('Bonjour');
    expect(usage.record).toHaveBeenCalledTimes(1);
  });

  it('rejects text exceeding max length', async () => {
    const { svc } = build();
    await expect(svc.synthesize('u1', 'a'.repeat(101))).rejects.toMatchObject({ status: 413 });
  });

  it('throws 502/503 when ElevenLabs fails without falling back to secondary providers', async () => {
    const { svc } = build({
      eleven: { synthesize: jest.fn().mockRejectedValue(new ProviderError('elevenlabs', 'unavailable', 'err')) },
    });
    await expect(svc.synthesize('u1', 'Bonjour')).rejects.toMatchObject({ status: 502 });
  });

  it('transcribes valid audio using ElevenLabs', async () => {
    const { svc, eleven } = build();
    const r = await svc.transcribe('u1', WEBM);
    expect(r.provider).toBe('elevenlabs');
    expect(r.text).toBe('bonjour');
    expect(r.fallback).toBe(false);
    expect(eleven.transcribe).toHaveBeenCalled();
  });

  it('rejects invalid audio bytes', async () => {
    const { svc } = build();
    await expect(svc.transcribe('u1', Buffer.from('not an audio file'))).rejects.toMatchObject({ status: 400 });
  });
});
