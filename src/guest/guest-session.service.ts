import {
  Injectable, OnModuleDestroy, UnauthorizedException, HttpException, Logger,
  ConflictException, GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { AiMessage } from '../ai/ai.types';
import { IdentityService } from '../identity/identity.service';

export interface GuestTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  provider?: string | null;
  model?: string | null;
  latencyMs?: number | null;
}
interface GuestSession {
  id: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  messages: GuestTurn[];
  used: number;
  generating: boolean;
  importing: boolean;
  controller?: AbortController;
}
type GuestTokenTombstone = { reason: 'expired' | 'revoked' | 'imported'; expiresAt: number };
export interface GuestChatInput { content: string }
export interface GuestStreamOptions { signal?: AbortSignal; onToken?: (delta: string) => void }
export interface GuestImportSnapshot { sessionId: string; used: number; createdAt: number; expiresAt: number; messages: GuestTurn[] }

@Injectable()
export class GuestSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(GuestSessionService.name);
  private readonly sessions = new Map<string, GuestSession>();
  private readonly tokenIndex = new Map<string, string>();
  private readonly tokenTombstones = new Map<string, GuestTokenTombstone>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService, private readonly ai: AiOrchestratorService, private readonly identity: IdentityService) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) session.controller?.abort();
    this.sessions.clear();
    this.tokenIndex.clear();
    this.tokenTombstones.clear();
  }

  create() {
    this.cleanup();
    const maxSessions = this.number('guestMaxActiveSessions', 2_000, 100, 10_000);
    if (this.sessions.size >= maxSessions) throw new HttpException({ code: 'GUEST_CAPACITY_REACHED', message: 'Le mode invité est momentanément saturé.' }, 503);
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const ttlSeconds = this.number('guestSessionTtlSeconds', 43_200, 300, 86_400);
    const maxLifetimeSeconds = this.number('guestSessionMaxLifetimeSeconds', 43_200, 300, 86_400);
    const session: GuestSession = {
      id: randomUUID(), tokenHash: this.hash(token), createdAt: now,
      expiresAt: now + Math.min(ttlSeconds, maxLifetimeSeconds) * 1000,
      messages: [], used: 0, generating: false, importing: false,
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
    if (session) {
      session.controller?.abort();
      this.sessions.delete(session.id);
      this.tokenIndex.delete(session.tokenHash);
      this.addTombstone(session.tokenHash, 'expired');
    }
    const tombstone = this.tokenTombstones.get(tokenHash);
    if (tombstone && tombstone.expiresAt > now) {
      if (tombstone.reason === 'expired') throw new GoneException({ code: 'GUEST_SESSION_EXPIRED', message: 'La session invitée a expiré.' });
      throw new GoneException({ code: tombstone.reason === 'imported' ? 'GUEST_SESSION_IMPORTED' : 'GUEST_SESSION_REVOKED', message: 'La session invitée n’est plus active.' });
    }
    this.tokenTombstones.delete(tokenHash);
    throw new UnauthorizedException({ code: 'GUEST_SESSION_INVALID', message: 'Session invitée invalide.' });
  }

  revoke(authorization?: string) {
    const session = this.authenticate(authorization);
    if (session.importing) throw new ConflictException({ code: 'GUEST_IMPORT_IN_PROGRESS', message: 'Le transfert de la conversation est en cours.' });
    session.controller?.abort();
    this.removeSession(session, 'revoked');
    return { revoked: true };
  }

  /** Locks a live Guest session and returns an immutable snapshot for one import attempt. */
  beginImport(authorization?: string): GuestImportSnapshot {
    const session = this.authenticate(authorization);
    if (session.generating) throw new ConflictException({ code: 'GUEST_GENERATION_IN_PROGRESS', message: 'Attendez la fin de la réponse avant le transfert.' });
    if (session.importing) throw new ConflictException({ code: 'GUEST_IMPORT_IN_PROGRESS', message: 'Un transfert est déjà en cours pour cette session.' });
    if (session.messages.length > 20) {
      throw new HttpException({ code: 'GUEST_CONVERSATION_TOO_LARGE', message: 'La conversation dépasse la limite de transfert.' }, 413);
    }
    session.importing = true;
    return {
      sessionId: session.id,
      used: session.used,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      messages: session.messages.map(turn => ({ ...turn })),
    };
  }

  /** Called only after the database transaction has committed successfully. */
  completeImport(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.removeSession(session, 'imported');
  }

  /** Releases the import lock after validation or persistence failure; the Guest session stays usable. */
  releaseImport(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) session.importing = false;
  }

  async send(authorization: string | undefined, input: GuestChatInput, options: GuestStreamOptions = {}) {
    const session = this.authenticate(authorization);
    const content = input.content.trim();
    if (!content || content.length > this.maxPromptChars()) throw new HttpException({ code: 'INVALID_MESSAGE', message: 'Le message est vide ou trop long.' }, 400);
    if (session.importing) throw new ConflictException({ code: 'GUEST_IMPORT_IN_PROGRESS', message: 'Le transfert de la conversation est en cours.' });
    if (session.generating) throw new HttpException({ code: 'GUEST_GENERATION_IN_PROGRESS', message: 'Une génération est déjà en cours pour cette session.' }, 409);
    const limit = this.messageLimit();
    if (session.used >= limit) throw new HttpException({ code: 'GUEST_QUOTA_EXCEEDED', message: 'Le quota du mode invité est atteint. Créez un compte pour continuer.' }, 429);
    if (options.signal?.aborted) throw new HttpException({ code: 'GENERATION_CANCELLED', message: 'La génération a été annulée.' }, 499);

    const systemInstruction = this.identity.buildSystemInstruction({
      conversation: { subject: 'general', title: 'Session invitée temporaire' },
      web: { requested: false, performed: false },
    });

    session.generating = true;
    const controller = new AbortController();
    const abortFromClient = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', abortFromClient, { once: true });
    session.controller = controller;
    const userTurn: GuestTurn = { role: 'user', content, createdAt: new Date().toISOString() };
    const candidate = [...session.messages, userTurn];
    const history = this.boundedContext(candidate).map(m => ({ role: m.role, content: m.content })) as AiMessage[];
    let partial = '';
    try {
      const result = await this.ai.generate('free', history, 'groq', {
        systemInstruction,
        signal: controller.signal,
        ...(options.onToken ? { onToken: (delta: string) => { partial += delta; options.onToken?.(delta); } } : {}),
      });
      if (controller.signal.aborted || session.expiresAt <= Date.now() || this.sessions.get(session.id) !== session) throw new HttpException({ code: 'GENERATION_CANCELLED', message: 'La session invitée a été interrompue.' }, 499);
      const assistantTurn: GuestTurn = {
        role: 'assistant', content: result.text, createdAt: new Date().toISOString(),
        provider: result.provider, model: result.model, latencyMs: result.latencyMs ?? null,
      };
      session.messages = this.boundedContext([...candidate, assistantTurn]);
      session.used += 1;
      session.expiresAt = Math.min(session.createdAt + this.number('guestSessionMaxLifetimeSeconds', 43_200, 300, 86_400) * 1000,
        Date.now() + this.number('guestSessionTtlSeconds', 43_200, 300, 86_400) * 1000);
      return {
        sessionId: session.id,
        userMessage: { role: userTurn.role, content: userTurn.content, createdAt: userTurn.createdAt },
        message: { role: 'assistant', content: result.text, provider: result.provider, model: result.model, latencyMs: result.latencyMs ?? null, createdAt: assistantTurn.createdAt },
        quota: { limit, used: session.used, remaining: Math.max(0, limit - session.used) },
        expiresAt: new Date(session.expiresAt).toISOString(),
      };
    } finally {
      // Never retain a failed/partial generation as conversation history.
      session.generating = false;
      session.controller = undefined;
      options.signal?.removeEventListener('abort', abortFromClient);
      if (controller.signal.aborted && partial) this.logger.debug({ msg: 'guest_stream_cancelled', sessionId: session.id });
    }
  }

  private removeSession(session: GuestSession, reason: GuestTokenTombstone['reason']) {
    session.controller?.abort();
    this.sessions.delete(session.id);
    this.tokenIndex.delete(session.tokenHash);
    this.addTombstone(session.tokenHash, reason);
  }

  private addTombstone(tokenHash: string, reason: GuestTokenTombstone['reason']) {
    this.tokenTombstones.set(tokenHash, { reason, expiresAt: Date.now() + 15 * 60_000 });
  }

  private hash(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private number(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get(key));
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }
  private messageLimit() { return this.number('guestMessageLimit', 10, 1, 10); }
  private contextWindow() { return this.number('guestContextMessages', 20, 2, 20); }
  private boundedContext(messages: GuestTurn[]) {
    const maxChars = Math.max(this.maxPromptChars(), this.number('guestMaxContextChars', 24_000, 1_000, 50_000));
    const selected: GuestTurn[] = [];
    let chars = 0;
    for (const turn of messages.slice(-this.contextWindow()).reverse()) {
      if (chars + turn.content.length > maxChars) break;
      selected.push(turn);
      chars += turn.content.length;
    }
    return selected.reverse();
  }
  private maxPromptChars() { return this.number('guestMaxPromptChars', 12_000, 100, 20_000); }
  private cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.removeSession(session, 'expired');
    for (const [hash, tombstone] of this.tokenTombstones) if (tombstone.expiresAt <= now) this.tokenTombstones.delete(hash);
  }
}
