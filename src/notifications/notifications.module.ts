import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationSubscribersService } from './notification-subscribers.service';

@Module({
  imports: [PlansModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationPreferencesService, NotificationSubscribersService],
  exports: [NotificationsService, NotificationPreferencesService, NotificationSubscribersService],
})
export class NotificationsModule {}
