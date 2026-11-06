import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { announcement, announcementRead, notificationDelivery } from '../db/schema';
import { newId } from '../common/ids';
import { badRequest, conflict, notFound } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateAnnouncementDto, NotificationChannel, ScheduledDeliveryMode, UpdateAnnouncementDto } from './announcement.types';

@Injectable()
export class AnnouncementsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnnouncementsService.name);
  private scheduledTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.scheduledTimer = setInterval(() => {
      void this.publishDueScheduled().catch(error => {
        this.logger.error({ msg: 'scheduled_publication_poll_failed', error: (error as Error).message });
      });
    }, 30_000);
    this.scheduledTimer.unref?.();
    void this.publishDueScheduled().catch(error => {
      this.logger.error({ msg: 'scheduled_publication_initial_poll_failed', error: (error as Error).message });
    });
  }

  onModuleDestroy() {
    if (this.scheduledTimer) clearInterval(this.scheduledTimer);
  }

  async create(dto: CreateAnnouncementDto, creatorId?: string, _isAdmin = false) {
    const mode = dto.publicationMode ?? 'IN_APP_ONLY';
    const channels = dto.notificationChannels ?? [];

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

    return created;
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
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
    const channels = dto.notificationChannels ?? existing.notificationChannels ?? [];

    if (mode === 'MULTI_CHANNEL' && channels.length === 0) {
      throw badRequest('NOTIFICATION_CHANNEL_REQUIRED', 'Sélectionnez au moins un canal Push ou Email.');
    }
    if (mode === 'SCHEDULED') {
      if (!scheduledAt || scheduledAt <= new Date()) {
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

    const result = await this.notifications.triggerWorkflow({
      topicKey: `announcements:${published.targetAudience}`,
      workflowId: 'aurex-announcement',
      payload: {
        announcementId: published.id,
        title: published.title,
        summary: published.summary,
        category: published.category,
        link: published.link,
        channels,
      },
    });

    await this.db.insert(notificationDelivery).values(channels.map(channel => ({
      id: newId(),
      announcementId: published.id,
      userId: null,
      category: 'editorial',
      channel,
      provider: 'novu',
      providerTransactionId: result.transactionId ?? null,
      status: result.sent ? 'triggered' : 'failed',
      errorCode: result.reason ?? null,
      attemptCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })));
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
        .where(and(eq(announcementRead.userId, userId), inArray(announcementRead.announcementId, rows.map(row => row.id))));
      const readIds = new Set(reads.map((row: { announcementId: string }) => row.announcementId));
      items = rows.map(row => ({ ...row, isRead: readIds.has(row.id) }));
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
