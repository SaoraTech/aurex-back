import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';

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
  ) {}

  @Get('subscriber-token')
  @Protect('read')
  getSubscriberToken(@CurrentUserId() userId: string) {
    return this.notifications.getSubscriberToken(userId);
  }

  @Get('preferences')
  @Protect('read')
  getPreferences(@CurrentUserId() userId: string) {
    return this.preferences.getForUser(userId);
  }

  @Patch('preferences')
  @Protect('default')
  updatePreferences(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.preferences.updateForUser(userId, dto);
  }
}
