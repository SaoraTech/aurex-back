import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationSubscribersService } from './notification-subscribers.service';

class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean()
  editorialEmailEnabled?: boolean;

  @IsOptional() @IsBoolean()
  editorialPushEnabled?: boolean;

  @IsOptional() @IsBoolean()
  transactionalEmailEnabled?: boolean;

  @IsOptional() @IsBoolean()
  transactionalPushEnabled?: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly subscribers: NotificationSubscribersService,
  ) {}

  @Get('subscriber-token')
  @Protect('read')
  async getSubscriberToken(@CurrentUserId() userId: string) {
    await this.subscribers.sync(userId);
    return this.notifications.getSubscriberToken(userId);
  }

  @Get('preferences')
  @Protect('read')
  getPreferences(@CurrentUserId() userId: string) {
    return this.preferences.getForUser(userId);
  }

  @Patch('preferences')
  @Protect('default')
  async updatePreferences(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    const updated = await this.preferences.updateForUser(userId, dto);
    await this.subscribers.sync(userId);
    return updated;
  }
}
