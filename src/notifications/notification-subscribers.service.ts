import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../db/db.constants';
import { user as userTable } from '../db/schema';
import { PlansService } from '../plans/plans.service';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';

@Injectable()
export class NotificationSubscribersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: any,
    private readonly plans: PlansService,
    private readonly preferences: NotificationPreferencesService,
    private readonly notifications: NotificationsService,
  ) {}

  async sync(userId: string) {
    const [profile] = await this.db.select({
      email: userTable.email,
      name: userTable.name,
    }).from(userTable).where(eq(userTable.id, userId)).limit(1);

    if (!profile) return { sent: false, reason: 'user_not_found' as const };

    const subscription = await this.plans.getSubscriptionInfo(userId);
    const preferences = await this.preferences.getForUser(userId);

    return this.notifications.syncSubscriber({
      subscriberId: userId,
      email: profile.email,
      firstName: profile.name,
      plan: subscription.commercialTier,
      preferences,
    });
  }
}
