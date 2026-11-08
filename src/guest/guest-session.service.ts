import { Injectable, OnModuleDestroy, UnauthorizedException, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { AiMessage } from '../ai/ai.types';
import { IdentityService } from '../identity/identity.service';

interface GuestTurn { role: 'user' | 'assistant'; content: string }
interface GuestSession {
  id: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  messages: GuestTurn[];
  used: number;
  generating: boolean;
}
export interface GuestChatInput { content: string }
export interface GuestStreamOptions { signal?: AbortSignal; onToken?: (delta: string) => void }

@Injectable()
export class GuestSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(GuestSessionService.name);
  private readonly sessions = new Map<string, GuestSession>();
  private readonly tokenIndex = new Map<string, string>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService, private readonly ai: AiOrchestratorService, private readonly identity: IdentityService) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() { if (this.cleanupTimer) clearInterval(this.cleanupTimer); this.sessions.clear(); this.tokenIndex.clear(); }

  create() {
    this.cleanup();
    const maxSessions = this.number('guestMaxActiveSessions', 20_000, 100, 100_000);
    if (this.sessions.size >= maxSessions) throw new HttpException({ code: 'GUEST_CAPACITY_REACHED', message: 'Le mode invité est momentanément saturé.' }, 503);
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const ttlSeconds = this.number('guestSessionTtlSeconds', 43_200, 300, 86_400);
    const session: GuestSession = {
      id: randomUUID(), tokenHash: this.hash(token), createdAt: now, expiresAt: now + ttlSeconds * 1000,
      messages: [], used: 0, generating: false,
    };
    this.sessions.set(session.id, session);
    this.tokenIndex.set(session.tokenHash, session.id);
    return { sessionId: session.id, token, tokenType: 'Bearer', expiresAt: new Date(session.expiresAt).toISOString(), quota: { messages: this.messageLimit(), used: 0 } };
  }

  authenticate(authorization?: string): GuestSession {
    const match = /^Bearer\s+([A-Za-z0-9_-]{40,})$/i.exec(authorization ?? '');
    if (!match) throw new UnauthorizedException({ code: 'GUEST_SESSION_REQUIRED', message: 'Session invitée requise.' });
    const tokenHash = this.hash(match[1]);
    const now = Date.now();
    const sessionId = this.tokenIndex.get(tokenHash);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session && session.expiresAt > now) return session;
    if (sessionId) this.sessions.delete(sessionId);
    this.tokenIndex.delete(tokenHash);
    throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID', message: 'Session invitée invalide ou expirée.' });
  }

  revoke(authorization?: string) {
    const session = this.authenticate(authorization);
    this.sessions.delete(session.id);
    this.tokenIndex.delete(session.tokenHash);
    return { revoked: true };
  }

  async send(authorization: string | undefined, input: GuestChatInput, options: GuestStreamOptions = {}) {
    const session = this.authenticate(authorization);
    const content = input.content.trim();
    if (!content || content.length > this.maxPromptChars()) throw new HttpException({ code: 'INVALID_MESSAGE', message: 'Le message est vide ou trop long.' }, 400);
    if (session.generating) throw new HttpException({ code: 'GUEST_GENERATION_IN_PROGRESS', message: 'Une génération est déjà en cours pour cette session.' }, 409);
    const limit = this.messageLimit();
    if (session.used >= limit) throw new HttpException({ code: 'GUEST_QUOTA_EXCEEDED', message: 'Le quota du mode invité est atteint. Créez un compte pour continuer.' }, 429);
    if (options.signal?.aborted) throw new HttpException({ code: 'GENERATION_CANCELLED', message: 'La génération a été annulée.' }, 499);

    session.generating = true;
    const userTurn: GuestTurn = { role: 'user', content };
    const candidate = [...session.messages, userTurn];
    const history = candidate.slice(-this.contextWindow()).map(m => ({ role: m.role, content: m.content })) as AiMessage[];
    const systemInstruction = this.identity.buildSystemInstruction({
      conversation: { subject: 'general', title: 'Session invitée temporaire' },
      web: { requested: false, performed: false },
    });
    let partial = '';
    try {
      const result = await this.ai.generate('free', history, 'groq', {
        systemInstruction,
        signal: options.signal,
        ...(options.onToken ? { onToken: (delta: string) => { partial += delta; options.onToken?.(delta); } } : {}),
      });
      session.messages = [...candidate, { role: 'assistant', content: result.text }].slice(-this.contextWindow());
      session.used += 1;
      session.expiresAt = Math.min(session.createdAt + this.number('guestSessionMaxLifetimeSeconds', 43_200, 300, 86_400) * 1000,
        Date.now() + this.number('guestSessionTtlSeconds', 43_200, 300, 86_400) * 1000);
      return {
        sessionId: session.id,
        message: { role: 'assistant', content: result.text, provider: result.provider, model: result.model, latencyMs: result.latencyMs ?? null },
        quota: { limit, used: session.used, remaining: Math.max(0, limit - session.used) },
        expiresAt: new Date(session.expiresAt).toISOString(),
      };
    } finally {
      // Never retain a failed/partial generation as conversation history.
      session.generating = false;
      if (options.signal?.aborted && partial) this.logger.debug({ msg: 'guest_stream_cancelled', sessionId: session.id });
    }
  }

  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private number(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get(key));
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
  private messageLimit() { return this.number('guestMessageLimit', 10, 1, 100); }
  private contextWindow() { return this.number('guestContextMessages', 20, 2, 40); }
  private maxPromptChars() { return this.number('guestMaxPromptChars', 12_000, 100, 20_000); }
  private cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) { this.sessions.delete(id); this.tokenIndex.delete(session.tokenHash); }
  }
}
