import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { announcement, announcementRead, notificationDelivery } from '../db/schema';
import { newId } from '../common/ids';
import { badRequest, conflict, notFound } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { CreateAnnouncementDto, NotificationChannel, ScheduledDeliveryMode, UpdateAnnouncementDto } from './announcement.types';

@Injectable()
export class AnnouncementsService {

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly notifications: NotificationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async create(dto: CreateAnnouncementDto, creatorId?: string, _isAdmin = false) {
    const mode = dto.publicationMode ?? 'IN_APP_ONLY';
    const channels = [...new Set(dto.notificationChannels ?? [])];

    if (mode === 'MULTI_CHANNEL' && channels.length === 0) {
      throw badRequest('NOTIFICATION_CHANNEL_REQUIRED', 'Sélectionnez au moins un canal Push ou Email.');
    }

    if (mode === 'SCHEDULED') {
      if (!dto.scheduledAt || !Number.isFinite(Date.parse(dto.scheduledAt)) || new Date(dto.scheduledAt) <= new Date()) {
        throw badRequest('INVALID_SCHEDULED_AT', 'La date de programmation doit être une date future valide.');
      }
      if (!dto.scheduledDeliveryMode) {
        throw badRequest('SCHEDULED_DELIVERY_MODE_REQUIRED', 'Le mode de diffusion de la publication programmée est requis.');
      }
      if (dto.scheduledDeliveryMode === 'MULTI_CHANNEL' && channels.length === 0) {
        throw badRequest('NOTIFICATION_CHANNEL_REQUIRED', 'Sélectionnez au moins un canal Push ou Email.');
      }
    }

    const now = new Date();
    const [created] = await this.db.insert(announcement).values({
      id: newId(),
      title: dto.title.trim(),
      summary: dto.summary.trim(),
      content: dto.content.trim(),
      category: dto.category ?? 'feature',
      status: mode === 'SCHEDULED' ? 'scheduled' : 'draft',
      targetAudience: dto.targetAudience ?? 'all',
      link: dto.link ?? null,
      publicationMode: mode,
      scheduledAt: mode === 'SCHEDULED' ? new Date(dto.scheduledAt!) : null,
      scheduledDeliveryMode: mode === 'SCHEDULED' ? dto.scheduledDeliveryMode : null,
      notificationChannels: mode === 'MULTI_CHANNEL' || (mode === 'SCHEDULED' && dto.scheduledDeliveryMode === 'MULTI_CHANNEL') ? channels : [],
      publishedAt: null,
      publishedBy: null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    await this.audit?.record({ actorUserId: creatorId, action: 'announcement.create', targetType: 'announcement', targetId: created.id, metadata: { publicationMode: mode, targetAudience: created.targetAudience } });
    return created;
  }

  async update(id: string, dto: UpdateAnnouncementDto, actorUserId?: string) {
    const existing = await this.getById(id);
    if (!existing) throw notFound('ANNOUNCEMENT_NOT_FOUND', 'Annonce introuvable.');
    if (existing.status === 'published' || existing.status === 'archived') {
      throw conflict('ANNOUNCEMENT_NOT_EDITABLE', 'Cette publication ne peut plus être modifiée.');
    }

    const mode = dto.publicationMode ?? existing.publicationMode;
    const scheduledAt = dto.scheduledAt === undefined
      ? existing.scheduledAt
      : dto.scheduledAt === null ? null : new Date(dto.scheduledAt);
    const scheduledDeliveryMode = dto.scheduledDeliveryMode === undefined
      ? existing.scheduledDeliveryMode
      : dto.scheduledDeliveryMode;
    const channels = [...new Set(dto.notificationChannels ?? existing.notificationChannels ?? [])];

    if (mode === 'MULTI_CHANNEL' && channels.length === 0) {
      throw badRequest('NOTIFICATION_CHANNEL_REQUIRED', 'Sélectionnez au moins un canal Push ou Email.');
    }
    if (mode === 'SCHEDULED') {
      if (!scheduledAt || !Number.isFinite(scheduledAt.getTime()) || scheduledAt <= new Date()) {
        throw badRequest('INVALID_SCHEDULED_AT', 'La date de programmation doit être une date future valide.');
      }
      if (!scheduledDeliveryMode) {
        throw badRequest('SCHEDULED_DELIVERY_MODE_REQUIRED', 'Le mode de diffusion de la publication programmée est requis.');
      }
      if (scheduledDeliveryMode === 'MULTI_CHANNEL' && channels.length === 0) {
        throw badRequest('NOTIFICATION_CHANNEL_REQUIRED', 'Sélectionnez au moins un canal Push ou Email.');
      }
    }

    const [updated] = await this.db.update(announcement).set({
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary.trim() } : {}),
      ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.targetAudience !== undefined ? { targetAudience: dto.targetAudience } : {}),
      ...(dto.link !== undefined ? { link: dto.link } : {}),
      publicationMode: mode,
      scheduledAt: mode === 'SCHEDULED' ? scheduledAt : null,
      scheduledDeliveryMode: mode === 'SCHEDULED' ? scheduledDeliveryMode : null,
      notificationChannels: mode === 'MULTI_CHANNEL' || (mode === 'SCHEDULED' && scheduledDeliveryMode === 'MULTI_CHANNEL') ? channels : [],
      status: mode === 'SCHEDULED' ? 'scheduled' : 'draft',
      updatedAt: new Date(),
    }).where(eq(announcement.id, id)).returning();

    if (updated) {
      await this.audit?.record({ actorUserId, action: 'announcement.update', targetType: 'announcement', targetId: id, metadata: { publicationMode: mode, targetAudience: updated.targetAudience } });
    }
    return updated;
  }

  async publish(id: string, publishedBy: string) {
    const existing = await this.getById(id);
    if (!existing) throw notFound('ANNOUNCEMENT_NOT_FOUND', 'Annonce introuvable.');
    if (existing.status === 'published') return existing;
    if (existing.status === 'archived') {
      throw conflict('ANNOUNCEMENT_ARCHIVED', 'Une publication archivée ne peut pas être publiée.');
    }

    const [published] = await this.db.update(announcement).set({
      status: 'published',
      publishedAt: new Date(),
      publishedBy,
      scheduledAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(announcement.id, id),
      inArray(announcement.status, ['draft', 'pending_review', 'scheduled']),
    )).returning();

    if (!published) return this.getById(id);

    await this.audit?.record({ actorUserId: publishedBy, action: 'announcement.publish', targetType: 'announcement', targetId: id, metadata: { targetAudience: published.targetAudience, publicationMode: published.publicationMode } });

    const deliveryMode = published.publicationMode === 'SCHEDULED'
      ? published.scheduledDeliveryMode
      : published.publicationMode;

    if (deliveryMode === 'MULTI_CHANNEL') {
      await this.dispatchEditorialNotification(published);
    }

    return published;
  }

  private async dispatchEditorialNotification(published: any) {
    const channels = (published.notificationChannels ?? []) as NotificationChannel[];
    if (channels.length === 0) return;

    const topicKey = published.targetAudience === 'all'
      ? 'announcements:all'
      : `announcements:${published.targetAudience}`;
    const now = new Date();
    const deliveryIds = channels.map(channel => `announcement:${published.id}:${channel}`);

    // Persist the outbox rows before calling Novu. If the process crashes after
    // the external request, the deterministic transaction ID and stable row IDs
    // allow the scheduled worker to safely retry the dispatch.
    await this.db.insert(notificationDelivery).values(channels.map((channel, index) => ({
      id: deliveryIds[index],
      announcementId: published.id,
      userId: null,
      category: 'editorial',
      channel,
      provider: 'novu',
      providerTransactionId: null,
      status: 'pending',
      errorCode: null,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    }))).onConflictDoNothing({ target: notificationDelivery.id });

    const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const claimed = await this.db.update(notificationDelivery).set({
      status: 'processing',
      updatedAt: now,
    }).where(and(
      inArray(notificationDelivery.id, deliveryIds),
      or(
        eq(notificationDelivery.status, 'pending'),
        eq(notificationDelivery.status, 'failed'),
        and(
          eq(notificationDelivery.status, 'processing'),
          lte(notificationDelivery.updatedAt, staleBefore),
        ),
      ),
    )).returning({ id: notificationDelivery.id });

    if (claimed.length === 0) return;

    const result = await this.notifications.triggerWorkflow({
      topicKey,
      workflowId: 'aurex-announcement',
      transactionId: `aurex-announcement-${published.id}`,
      payload: {
        announcementId: published.id,
        targetAudience: published.targetAudience,
        title: published.title,
        summary: published.summary,
        category: published.category,
        link: published.link,
        channels,
      },
    });

    await this.db.update(notificationDelivery).set({
      providerTransactionId: result.transactionId ?? null,
      status: result.sent ? 'triggered' : 'failed',
      errorCode: result.reason ?? null,
      attemptCount: sql`${notificationDelivery.attemptCount} + 1`,
      updatedAt: new Date(),
    }).where(inArray(notificationDelivery.id, claimed.map((row: { id: string }) => row.id)));
  }

  async publishDueScheduled() {
    const now = new Date();
    const due = await this.db.select().from(announcement).where(and(
      eq(announcement.status, 'scheduled'),
      lte(announcement.scheduledAt, now),
    )).orderBy(announcement.scheduledAt).limit(50);

    for (const item of due) {
      await this.publish(item.id, 'system');
    }
    return { processed: due.length };
  }

  async retryFailedEditorialNotifications() {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    const retryable = await this.db.select({
      announcementId: notificationDelivery.announcementId,
    }).from(notificationDelivery).where(and(
      eq(notificationDelivery.category, 'editorial'),
      inArray(notificationDelivery.status, ['failed', 'pending', 'processing']),
      lte(notificationDelivery.updatedAt, staleBefore),
      sql`${notificationDelivery.attemptCount} < 5`,
    )).orderBy(notificationDelivery.createdAt).limit(100);

    const announcementIds = [...new Set(
      retryable.map((row: { announcementId: string | null }) => row.announcementId).filter(Boolean),
    )] as string[];

    let retried = 0;
    for (const id of announcementIds) {
      const item = await this.getById(id);
      if (!item || item.status !== 'published') continue;
      const mode = item.publicationMode === 'SCHEDULED' ? item.scheduledDeliveryMode : item.publicationMode;
      if (mode !== 'MULTI_CHANNEL') continue;
      await this.dispatchEditorialNotification(item);
      retried += 1;
    }

    return { retried };
  }

  async getById(id: string) {
    const [row] = await this.db.select().from(announcement).where(eq(announcement.id, id)).limit(1);
    return row ?? null;
  }

  async listPublished(userPlan?: string, category?: string, limit = 20, offset = 0, userId?: string) {
    const audiences = ['all'];
    if (userPlan && userPlan !== 'all') audiences.push(userPlan);

    const conditions = [
      eq(announcement.status, 'published'),
      inArray(announcement.targetAudience, audiences),
    ];
    if (category) conditions.push(eq(announcement.category, category));

    const rows = await this.db.select().from(announcement)
      .where(and(...conditions))
      .orderBy(desc(announcement.publishedAt))
      .limit(Math.min(Math.max(1, limit), 50))
      .offset(Math.max(0, offset));

    const countRes = await this.db.select({ count: sql<number>`count(*)` })
      .from(announcement)
      .where(and(...conditions));

    let items = rows;
    if (userId && rows.length) {
      const reads = await this.db.select({ announcementId: announcementRead.announcementId })
        .from(announcementRead)
        .where(and(eq(announcementRead.userId, userId), inArray(announcementRead.announcementId, rows.map((row: { id: string }) => row.id))));
      const readIds = new Set<string>(reads.map((row: { announcementId: string }) => row.announcementId));
      items = rows.map((row: { id: string }) => ({ ...row, isRead: readIds.has(row.id) }));
    }

    return {
      items,
      total: Number(countRes[0]?.count ?? 0),
      limit,
      offset,
    };
  }

  async markRead(userId: string, announcementId: string) {
    const existing = await this.getById(announcementId);
    if (!existing || existing.status !== 'published') {
      throw notFound('ANNOUNCEMENT_NOT_FOUND', 'Publication introuvable.');
    }

    await this.db.insert(announcementRead).values({
      id: newId(),
      announcementId,
      userId,
      readAt: new Date(),
    }).onConflictDoNothing();

    return { announcementId, isRead: true };
  }

  async getUnreadCount(userId: string, userPlan?: string) {
    const audiences = ['all'];
    if (userPlan && userPlan !== 'all') audiences.push(userPlan);

    const [row] = await this.db.select({ count: sql<number>`count(*)` })
      .from(announcement)
      .leftJoin(announcementRead, and(
        eq(announcementRead.announcementId, announcement.id),
        eq(announcementRead.userId, userId),
      ))
      .where(and(
        eq(announcement.status, 'published'),
        inArray(announcement.targetAudience, audiences),
        isNull(announcementRead.id),
      ));

    return { unreadCount: Number(row?.count ?? 0) };
  }

  async listAdmin(status?: string, limit = 50, offset = 0) {
    const conditions = [];
    if (status) conditions.push(eq(announcement.status, status));

    const rows = await this.db.select().from(announcement)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(announcement.createdAt))
      .limit(Math.min(Math.max(1, limit), 100))
      .offset(Math.max(0, offset));

    return { items: rows };
  }
}
