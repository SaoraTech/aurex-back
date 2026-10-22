import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import {
  artifact,
  conversation,
  libraryDocument,
  memoryItem,
  message,
  notificationPreference,
  privacyRequest,
  subscription,
} from '../db/schema';
import { newId } from '../common/ids';

@Injectable()
export class PrivacyService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async exportUserData(userId: string) {
    const conversations = await this.db.select().from(conversation).where(eq(conversation.userId, userId));
    const conversationIds = conversations.map((c: any) => c.id);
    const messages: any[] = conversationIds.length
      ? await this.db.select().from(message).where(inArray(message.conversationId, conversationIds))
      : [];
    const memories = await this.db.select().from(memoryItem).where(eq(memoryItem.userId, userId));
    const artifacts = await this.db.select().from(artifact).where(eq(artifact.userId, userId));
    const docs = await this.db
      .select({
        id: libraryDocument.id,
        filename: libraryDocument.filename,
        mimeType: libraryDocument.mimeType,
        sizeBytes: libraryDocument.sizeBytes,
        status: libraryDocument.status,
        createdAt: libraryDocument.createdAt,
      })
      .from(libraryDocument)
      .where(eq(libraryDocument.userId, userId));
    const subs = await this.db
      .select({
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
      })
      .from(subscription)
      .where(eq(subscription.userId, userId));

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      userId,
      conversations,
      messages,
      memories,
      artifacts,
      documents: docs,
      subscriptions: subs,
    };
  }

  /**
   * Idempotent account deletion request.
   * If a pending request already exists for this user, returns it without creating duplicates.
   */
  async requestDeletion(userId: string) {
    const existing = await this.db
      .select()
      .from(privacyRequest)
      .where(and(eq(privacyRequest.userId, userId), eq(privacyRequest.type, 'delete_account'), eq(privacyRequest.status, 'pending')))
      .orderBy(desc(privacyRequest.createdAt))
      .limit(1);

    if (existing[0]) {
      return {
        requestId: existing[0].id,
        status: existing[0].status,
        message: 'Une demande de suppression est déjà en cours de traitement.',
        createdAt: existing[0].createdAt,
      };
    }

    const item = {
      id: newId(),
      userId,
      type: 'delete_account',
      status: 'pending' as const,
      createdAt: new Date(),
    };
    await this.db.insert(privacyRequest).values(item);

    return {
      requestId: item.id,
      status: item.status,
      message: 'Demande de suppression enregistrée ; traitement en cours.',
      createdAt: item.createdAt,
    };
  }

  async getDeletionStatus(userId: string) {
    const rows = await this.db
      .select()
      .from(privacyRequest)
      .where(and(eq(privacyRequest.userId, userId), eq(privacyRequest.type, 'delete_account')))
      .orderBy(desc(privacyRequest.createdAt))
      .limit(1);

    const latest = rows[0];
    if (!latest) {
      return { hasRequest: false, status: null };
    }

    return {
      hasRequest: true,
      requestId: latest.id,
      status: latest.status,
      createdAt: latest.createdAt,
      completedAt: latest.completedAt ?? null,
    };
  }

  /**
   * Automated/Operator Purge of personal data while preserving legal billing obligations.
   */
  async purgeUserData(userId: string) {
    const now = new Date();
    await this.db.transaction(async (tx: any) => {
      // 1. Delete user memory
      await tx.delete(memoryItem).where(eq(memoryItem.userId, userId));

      // 2. Delete conversations (messages cascade via foreign key)
      await tx.delete(conversation).where(eq(conversation.userId, userId));

      // 3. Delete artifacts (versions cascade via foreign key)
      await tx.delete(artifact).where(eq(artifact.userId, userId));

      // 4. Delete library document records
      await tx.delete(libraryDocument).where(eq(libraryDocument.userId, userId));

      // 5. Delete notification preferences
      await tx.delete(notificationPreference).where(eq(notificationPreference.userId, userId));

      // 6. Mark pending deletion requests as completed
      await tx
        .update(privacyRequest)
        .set({ status: 'completed', completedAt: now })
        .where(and(eq(privacyRequest.userId, userId), eq(privacyRequest.type, 'delete_account'), eq(privacyRequest.status, 'pending')));
    });

    return { purged: true, completedAt: now };
  }
}
