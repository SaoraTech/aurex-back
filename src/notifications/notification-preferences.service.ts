import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { notificationPreference } from '../db/schema';
import { newId } from '../common/ids';

export interface NotificationPreferenceUpdate {
  editorialEmailEnabled?: boolean;
  editorialPushEnabled?: boolean;
  transactionalEmailEnabled?: boolean;
  transactionalPushEnabled?: boolean;
}

const DEFAULT_PREFERENCES = {
  editorialEmailEnabled: true,
  editorialPushEnabled: true,
  transactionalEmailEnabled: true,
  transactionalPushEnabled: true,
};

@Injectable()
export class NotificationPreferencesService {
  constructor(@Inject(DRIZZLE) private readonly db: any) {}

  async getForUser(userId: string) {
    const [row] = await this.db.select().from(notificationPreference)
      .where(eq(notificationPreference.userId, userId)).limit(1);

    return row ? {
      editorialEmailEnabled: row.editorialEmailEnabled,
      editorialPushEnabled: row.editorialPushEnabled,
      transactionalEmailEnabled: row.transactionalEmailEnabled,
      transactionalPushEnabled: row.transactionalPushEnabled,
    } : DEFAULT_PREFERENCES;
  }

  async updateForUser(userId: string, update: NotificationPreferenceUpdate) {
    const now = new Date();
    const [row] = await this.db.insert(notificationPreference).values({
      id: newId(),
      userId,
      ...DEFAULT_PREFERENCES,
      ...update,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: notificationPreference.userId,
      set: { ...update, updatedAt: now },
    }).returning();

    return {
      editorialEmailEnabled: row.editorialEmailEnabled,
      editorialPushEnabled: row.editorialPushEnabled,
      transactionalEmailEnabled: row.transactionalEmailEnabled,
      transactionalPushEnabled: row.transactionalPushEnabled,
    };
  }
}
