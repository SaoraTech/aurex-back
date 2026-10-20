import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { announcement } from '../db/schema';
import { newId } from '../common/ids';
import { conflict, notFound } from '../common/errors';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateAnnouncementDto,
  PublishAnnouncementOptions,
  UpdateAnnouncementDto,
} from './announcement.types';

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateAnnouncementDto, creatorId?: string, isAdmin = false) {
    const id = newId();
    const mode = dto.publicationMode ?? 'hybrid';

    let initialStatus: 'draft' | 'pending_review' | 'published' = 'pending_review';
    let publishedAt: Date | null = null;
    let publishedBy: string | null = null;

    if (mode === 'manual') {
      if (isAdmin && dto.autoPublish) {
        initialStatus = 'published';
        publishedAt = new Date();
        publishedBy = creatorId ?? 'admin';
      } else {
        initialStatus = 'draft';
      }
    } else if (mode === 'automatic') {
      if (dto.autoPublish) {
        initialStatus = 'published';
        publishedAt = new Date();
        publishedBy = 'system';
      } else {
        initialStatus = 'pending_review';
      }
    } else {
      // Hybrid mode (default)
      if (isAdmin && dto.autoPublish) {
        initialStatus = 'published';
        publishedAt = new Date();
        publishedBy = creatorId ?? 'admin';
      } else {
        initialStatus = 'pending_review';
      }
    }

    const [created] = await this.db.insert(announcement).values({
      id,
      title: dto.title.trim(),
      summary: dto.summary.trim(),
      content: dto.content.trim(),
      category: dto.category ?? 'feature',
      status: initialStatus,
      targetAudience: dto.targetAudience ?? 'all',
      link: dto.link ?? null,
      publicationMode: mode,
      publishedAt,
      publishedBy,
    }).returning();

    return created;
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const existing = await this.getById(id);
    if (!existing) throw notFound('ANNOUNCEMENT_NOT_FOUND', 'Annonce introuvable.');

    if (existing.status === 'published') {
      throw conflict('ANNOUNCEMENT_ALREADY_PUBLISHED', 'Impossible de modifier une annonce déjà publiée.');
    }

    const [updated] = await this.db.update(announcement).set({
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary.trim() } : {}),
      ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.targetAudience !== undefined ? { targetAudience: dto.targetAudience } : {}),
      ...(dto.link !== undefined ? { link: dto.link } : {}),
      updatedAt: new Date(),
    }).where(eq(announcement.id, id)).returning();

    return updated;
  }

  async publish(id: string, options: PublishAnnouncementOptions = {}, publishedBy: string) {
    const existing = await this.getById(id);
    if (!existing) throw notFound('ANNOUNCEMENT_NOT_FOUND', 'Annonce introuvable.');

    if (existing.status === 'published') {
      return existing; // idempotent publish
    }

    const now = new Date();
    const [published] = await this.db.update(announcement).set({
      status: 'published',
      publishedAt: now,
      publishedBy,
      updatedAt: now,
    }).where(eq(announcement.id, id)).returning();

    // Broadcast or trigger Novu workflow if explicitly requested
    if (options.sendNotification) {
      try {
        await this.notifications.triggerWorkflow({
          subscriberId: `topic:announcements:${published.targetAudience}`,
          workflowId: 'aurex-announcement',
          payload: {
            announcementId: published.id,
            title: published.title,
            summary: published.summary,
            category: published.category,
            link: published.link,
          },
        });
      } catch (err) {
        this.logger.warn({ msg: 'novu_announcement_notification_failed', id, error: (err as Error).message });
      }
    }

    return published;
  }

  async getById(id: string) {
    const [row] = await this.db.select().from(announcement).where(eq(announcement.id, id)).limit(1);
    return row ?? null;
  }

  async listPublished(userPlan?: string, category?: string, limit = 20, offset = 0) {
    const audiences = ['all'];
    if (userPlan && userPlan !== 'all') {
      audiences.push(userPlan);
    }

    const conditions = [
      eq(announcement.status, 'published'),
      inArray(announcement.targetAudience, audiences),
    ];

    if (category) {
      conditions.push(eq(announcement.category, category));
    }

    const rows = await this.db.select().from(announcement)
      .where(and(...conditions))
      .orderBy(desc(announcement.publishedAt))
      .limit(Math.min(Math.max(1, limit), 50))
      .offset(Math.max(0, offset));

    const countRes = await this.db.select({ count: sql<number>`count(*)` })
      .from(announcement)
      .where(and(...conditions));

    return {
      items: rows,
      total: Number(countRes[0]?.count ?? 0),
      limit,
      offset,
    };
  }

  async listAdmin(status?: string, limit = 50, offset = 0) {
    const conditions = [];
    if (status) {
      conditions.push(eq(announcement.status, status));
    }

    const rows = await this.db.select().from(announcement)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(announcement.createdAt))
      .limit(Math.min(Math.max(1, limit), 100))
      .offset(Math.max(0, offset));

    return { items: rows };
  }
}
