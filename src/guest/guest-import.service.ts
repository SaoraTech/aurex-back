import { Inject, Injectable, ConflictException, HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { conversation, message } from '../db/schema';
import { newId } from '../common/ids';
import { GuestImportSnapshot, GuestSessionService } from './guest-session.service';

export interface GuestImportInput {
  transferId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>;
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
      this.assertPayload(input.messages, snapshot);
      const firstAt = new Date(input.messages[0].createdAt);
      const lastAt = new Date(input.messages[input.messages.length - 1].createdAt);
      const title = input.messages[0].content.replace(/\s+/g, ' ').trim().slice(0, 70) || 'Conversation importée';

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
        await tx.insert(message).values(input.messages.map((turn, index) => {
          const authoritative = snapshot.messages[index - Math.max(0, input.messages.length - snapshot.messages.length)];
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
      return { conversationId, imported: true, idempotentReplay: false, messageCount: input.messages.length };
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

  private assertPayload(messages: GuestImportInput['messages'], snapshot: GuestImportSnapshot) {
    if (!Array.isArray(messages) || messages.length < 2 || snapshot.used < 1) {
      throw new HttpException({ code: 'GUEST_CONVERSATION_EMPTY', message: 'Aucun échange terminé à transférer.' }, 422);
    }
    if (snapshot.used > 10 || messages.length > 20 || messages.length !== snapshot.used * 2) {
      throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_MISMATCH', message: 'Le nombre de messages ne correspond pas aux échanges Guest terminés.' }, 400);
    }
    let totalChars = 0;
    let previousTimestamp = 0;
    const now = Date.now();
    for (let index = 0; index < messages.length; index += 1) {
      const item = messages[index];
      const timestamp = Date.parse(item?.createdAt ?? '');
      if (!item || !['user', 'assistant'].includes(item.role) ||
          typeof item.content !== 'string' || item.content.length < 1 || item.content.length > 20_000 ||
          !Number.isFinite(timestamp) || timestamp < snapshot.createdAt - 1_000 ||
          timestamp > Math.min(snapshot.expiresAt + 60_000, now + 60_000) || timestamp < previousTimestamp) {
        throw new HttpException({ code: 'GUEST_IMPORT_INVALID_MESSAGE', message: 'Un message du transfert est invalide.' }, 400);
      }
      if (item.role !== (index % 2 === 0 ? 'user' : 'assistant')) {
        throw new HttpException({ code: 'GUEST_IMPORT_INVALID_ORDER', message: 'L’ordre des messages est invalide.' }, 400);
      }
      totalChars += item.content.length;
      previousTimestamp = timestamp;
    }
    if (totalChars > 400_000) {
      throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_TOO_LARGE', message: 'La conversation dépasse la taille autorisée.' }, 413);
    }

    // Verify the suffix still retained by the ephemeral server context. Older turns are supplied by
    // the mobile's volatile transcript because the model context may have been truncated by design.
    const suffix = snapshot.messages;
    if (suffix.length > messages.length) {
      throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_MISMATCH', message: 'La conversation fournie ne correspond pas à la session invitée.' }, 400);
    }
    const offset = messages.length - suffix.length;
    for (let index = 0; index < suffix.length; index += 1) {
      const incoming = messages[offset + index];
      const stored = suffix[index];
      if (incoming.role !== stored.role || incoming.content !== stored.content ||
          Date.parse(incoming.createdAt) !== Date.parse(stored.createdAt)) {
        throw new HttpException({ code: 'GUEST_IMPORT_PAYLOAD_MISMATCH', message: 'Les derniers messages ne correspondent pas à la session invitée.' }, 400);
      }
    }
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
