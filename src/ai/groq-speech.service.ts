import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Groq speech adapter. Check current Groq account/model availability before enabling in production. */
@Injectable()
export class GroqSpeechService {
  constructor(private readonly config: ConfigService) {}

  async synthesize(text: string, voice = 'Fritz-PlayAI'): Promise<{ audio: Uint8Array; contentType: string }> {
    const key = this.config.get<string>('groqApiKey');
    if (!key) throw new ServiceUnavailableException('Groq is not configured');
    const base = this.config.get<string>('groqBaseUrl') ?? 'https://api.groq.com/openai/v1';
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.get<string>('groqTtsModel') ?? 'playai-tts', voice, input: text, response_format: 'wav' }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error('Groq speech synthesis failed');
      return { audio: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'audio/wav' };
    } catch { throw new ServiceUnavailableException('Groq speech synthesis failed; verify model access and API endpoint'); }
  }

  async transcribe(audio: Blob, filename = 'audio.webm'): Promise<{ text: string }> {
    const key = this.config.get<string>('groqApiKey');
    if (!key) throw new ServiceUnavailableException('Groq is not configured');
    const form = new FormData();
    form.set('file', audio, filename);
    form.set('model', this.config.get<string>('groqSttModel') ?? 'whisper-large-v3-turbo');
    const base = this.config.get<string>('groqBaseUrl') ?? 'https://api.groq.com/openai/v1';
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error('Groq speech request failed');
      const body = await res.json() as { text?: string };
      if (!body.text) throw new Error('Empty transcript');
      return { text: body.text };
    } catch { throw new ServiceUnavailableException('Groq transcription failed'); }
  }
}
