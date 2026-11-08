import { Inject, Injectable, ConflictException, HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { conversation, message } from '../db/schema';
import { newId } from '../common/ids';
import { GuestImportSnapshot, GuestSessionService } from './guest-session.service';

export interface GuestImportMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
export interface GuestImportInput {
  transferId: string;
  messages: GuestImportMessage[];
}

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string; cause?: { code?: string } })?.code === '23505' ||
  (error as { cause?: { code?: string } })?.cause?.code === '23505';

@Injectable()
export class GuestImportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly guests: GuestSessionService,
  ) {}

  async importConversation(authorization: string | undefined, userId: string, input: GuestImportInput) {
    const conversationId = this.conversationId(userId, input.transferId);
    let existing: { id: string; userId: string } | undefined;
    try { existing = await this.findById(conversationId); }
    catch { throw this.persistenceUnavailable(); }
    if (existing) {
      if (existing.userId !== userId) throw new ConflictException({ code: 'GUEST_TRANSFER_CONFLICT', message: 'Cet identifiant de transfert est déjà utilisé.' });
      return { conversationId, imported: true, idempotentReplay: true, messageCount: await this.safeCountMessages(conversationId) };
    }

    const snapshot = this.guests.beginImport(authorization);
    try {
      const messages = this.mergeAndValidate(input.messages, snapshot);
      const firstAt = new Date(messages[0].createdAt);
      const lastAt = new Date(messages[messages.length - 1].createdAt);
      const title = messages.find(turn => turn.role === 'user')!.content.replace(/\s+/g, ' ').trim().slice(0, 70) || 'Conversation importée';
      const metadata = new Map(snapshot.messages.map(turn => [this.messageKey(turn), turn]));

      await this.db.transaction(async (tx: any) => {
        await tx.insert(conversation).values({
          id: conversationId,
          userId,
          title,
          subject: 'general',
          archivedAt: null,
          createdAt: firstAt,
          updatedAt: lastAt,
        });
        await tx.insert(message).values(messages.map(turn => {
          const authoritative = metadata.get(this.messageKey(turn));
          return {
            id: newId(),
            conversationId,
            role: turn.role,
            content: turn.content,
            mathInput: null,
            mathResult: null,
            computation: null,
            provider: turn.role === 'assistant' ? authoritative?.provider ?? 'groq' : null,
            model: turn.role === 'assistant' ? authoritative?.model ?? null : null,
            latencyMs: turn.role === 'assistant' ? authoritative?.latencyMs ?? null : null,
            tokenCount: null,
            requestId: null,
            sources: null,
            createdAt: new Date(turn.createdAt),
          };
        }));
      });

      // The Guest token is revoked only after Neon confirms the transaction commit.
      this.guests.completeImport(snapshot.sessionId);
      return { conversationId, imported: true, idempotentReplay: false, messageCount: messages.length };
    } catch (error) {
      this.guests.releaseImport(snapshot.sessionId);
      if (isUniqueViolation(error)) {
        let raced: { id: string; userId: string } | undefined;
        try { raced = await this.findById(conversationId); }
        catch { throw this.persistenceUnavailable(); }
        if (raced?.userId === userId) {
          this.guests.completeImport(snapshot.sessionId);
          return { conversationId, imported: true, idempotentReplay: true, messageCount: await this.safeCountMessages(conversationId) };
        }
        if (raced) throw new ConflictException({ code: 'GUEST_TRANSFER_CONFLICT', message: 'Cet identifiant de transfert est déjà utilisé.' });
      }
      if (error instanceof HttpException) throw error;
      throw this.persistenceUnavailable();
    }
  }

  /**
   * The mobile transcript is the durable-in-process source for older turns. The Guest service keeps
   * only a bounded model-context suffix. Unioning by role + server-issued timestamp recovers a
   * completed assistant answer if the network dropped before the mobile received the SSE done event.
   */
  private mergeAndValidate(payload: GuestImportMessage[], snapshot: GuestImportSnapshot): GuestImportMessage[] {
    if (!Array.isArray(payload)) {
      throw new HttpException({ code: 'GUEST_IMPORT_INVALID_PAYLOAD', message: 'Le contenu du transfert est invalide.' }, 400);
    }
    if (snapshot.used > 10 || payload.length > 20 || snapshot.messages.length > 20) {
      throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_TOO_LARGE', message: 'La conversation dépasse les limites autorisées.' }, 413);
    }

    const byKey = new Map<string, GuestImportMessage>();
    const now = Date.now();
    let totalChars = 0;
    const add = (item: GuestImportMessage) => {
      const timestamp = Date.parse(item?.createdAt ?? '');
      if (!item || !['user', 'assistant'].includes(item.role) ||
          typeof item.content !== 'string' || item.content.length < 1 || item.content.length > 20_000 ||
          !Number.isFinite(timestamp) || timestamp < snapshot.createdAt - 1_000 ||
          timestamp > Math.min(snapshot.expiresAt + 60_000, now + 60_000)) {
        throw new HttpException({ code: 'GUEST_IMPORT_INVALID_MESSAGE', message: 'Un message du transfert est invalide.' }, 400);
      }
      totalChars += item.content.length;
      const key = this.messageKey(item);
      const existing = byKey.get(key);
      if (existing && existing.content !== item.content) {
        throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_MISMATCH', message: 'Un message fourni ne correspond pas à la session invitée.' }, 400);
      }
      if (!existing) byKey.set(key, { role: item.role, content: item.content, createdAt: new Date(timestamp).toISOString() });
    };

    // The mobile transcript must preserve its own order; the server snapshot may start mid-thread.
    let previousClientTimestamp = 0;
    for (let index = 0; index < payload.length; index += 1) {
      const item = payload[index];
      const timestamp = Date.parse(item?.createdAt ?? '');
      if (item?.role !== (index % 2 === 0 ? 'user' : 'assistant') || !Number.isFinite(timestamp) || timestamp < previousClientTimestamp) {
        throw new HttpException({ code: 'GUEST_IMPORT_INVALID_ORDER', message: 'L’ordre des messages est invalide.' }, 400);
      }
      previousClientTimestamp = timestamp;
    }
    // Prefer server-held copies for the suffix and merge the mobile-held older transcript.
    for (const item of snapshot.messages) add(item);
    for (const item of payload) add(item);
    if (totalChars > 800_000) {
      throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_TOO_LARGE', message: 'La conversation dépasse la taille autorisée.' }, 413);
    }

    const merged = [...byKey.values()].sort((a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (a.role === 'user' ? -1 : 1),
    );
    if (!merged.length) {
      throw new HttpException({ code: 'GUEST_CONVERSATION_EMPTY', message: 'Aucun échange à transférer.' }, 422);
    }
    if (merged.length > 20) {
      throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_TOO_LARGE', message: 'La conversation dépasse 20 messages.' }, 413);
    }

    const completedMessages = snapshot.used * 2;
    const hasPendingUserTurn = merged.length === completedMessages + 1 && merged[merged.length - 1].role === 'user';
    if (merged.length !== completedMessages && !hasPendingUserTurn) {
      throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_MISMATCH', message: 'Le nombre de messages ne correspond pas aux échanges Guest terminés.' }, 400);
    }
    for (let index = 0; index < merged.length; index += 1) {
      if (merged[index].role !== (index % 2 === 0 ? 'user' : 'assistant')) {
        throw new HttpException({ code: 'GUEST_IMPORT_INVALID_ORDER', message: 'L’ordre des messages est invalide.' }, 400);
      }
    }
    return merged;
  }

  private messageKey(message: Pick<GuestImportMessage, 'role' | 'createdAt'>) {
    return message.role + ':' + Date.parse(message.createdAt);
  }

  private conversationId(userId: string, transferId: string) {
    const digest = createHash('sha256').update(userId).update('\0').update(transferId).digest('hex');
    return 'guest_' + digest;
  }

  private async findById(id: string): Promise<{ id: string; userId: string } | undefined> {
    const [row] = await this.db.select({ id: conversation.id, userId: conversation.userId })
      .from(conversation).where(eq(conversation.id, id)).limit(1);
    return row;
  }

  private async countMessages(conversationId: string) {
    const rows = await this.db.select({ id: message.id }).from(message).where(eq(message.conversationId, conversationId));
    return rows.length;
  }

  private async safeCountMessages(conversationId: string) {
    try { return await this.countMessages(conversationId); }
    catch { throw this.persistenceUnavailable(); }
  }

  private persistenceUnavailable() {
    return new HttpException({ code: 'GUEST_IMPORT_PERSISTENCE_FAILED', message: 'Le transfert n’a pas pu être enregistré. Réessayez sans fermer cette conversation.' }, 503);
  }
}
