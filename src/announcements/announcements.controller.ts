import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireUserGuard } from '../auth/require-user.guard';
import { RequireAdminGuard } from '../auth/require-admin.guard';
import { CurrentUserId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { PlansService } from '../plans/plans.service';
import { AnnouncementsService } from './announcements.service';
import {
  AnnouncementCategory,
  NotificationChannel,
  PublicationMode,
  ScheduledDeliveryMode,
  TargetAudience,
} from './announcement.types';

class CreateAnnouncementBodyDto {
  @IsString() @MinLength(3) @MaxLength(255)
  title!: string;

  @IsString() @MinLength(5) @MaxLength(1000)
  summary!: string;

  @IsString() @MinLength(10)
  content!: string;

  @IsOptional()
  @IsIn(['feature', 'improvement', 'ai_engine', 'subscription', 'maintenance'])
  category?: AnnouncementCategory;

  @IsOptional()
  @IsIn(['all', 'free', 'plus', 'pro'])
  targetAudience?: TargetAudience;

  @IsOptional()
  @IsString() @MaxLength(500)
  link?: string;

  @IsOptional()
  @IsIn(['IN_APP_ONLY', 'MULTI_CHANNEL', 'SCHEDULED'])
  publicationMode?: PublicationMode;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsIn(['IN_APP_ONLY', 'MULTI_CHANNEL'])
  scheduledDeliveryMode?: ScheduledDeliveryMode;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['push', 'email'], { each: true })
  notificationChannels?: NotificationChannel[];
}

class UpdateAnnouncementBodyDto {
  @IsOptional()
  @IsString() @MinLength(3) @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString() @MinLength(5) @MaxLength(1000)
  summary?: string;

  @IsOptional()
  @IsString() @MinLength(10)
  content?: string;

  @IsOptional()
  @IsIn(['feature', 'improvement', 'ai_engine', 'subscription', 'maintenance'])
  category?: AnnouncementCategory;

  @IsOptional()
  @IsIn(['all', 'free', 'plus', 'pro'])
  targetAudience?: TargetAudience;

  @IsOptional()
  @IsString() @MaxLength(500)
  link?: string;

  @IsOptional()
  @IsIn(['IN_APP_ONLY', 'MULTI_CHANNEL', 'SCHEDULED'])
  publicationMode?: PublicationMode;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsIn(['IN_APP_ONLY', 'MULTI_CHANNEL'])
  scheduledDeliveryMode?: ScheduledDeliveryMode | null;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['push', 'email'], { each: true })
  notificationChannels?: NotificationChannel[];
}

class ListAnnouncementsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0)
  offset?: number;
}

@ApiTags('announcements')
@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly announcements: AnnouncementsService,
    private readonly plans: PlansService,
    private readonly users: RequireUserGuard,
  ) {}

  @Get('unread-count')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard)
  @Protect('read')
  async unreadCount(@Req() req: any) {
    const user = await this.users.resolve(req);
    const plan = (await this.plans.getSubscriptionInfo(user.id)).commercialTier;
    return this.announcements.getUnreadCount(user.id, plan);
  }

  @Get()
  @Protect('read')
  async listPublished(@Req() req: any, @Query() query: ListAnnouncementsQueryDto) {
    let plan = 'free';
    let userId: string | undefined;
    try {
      const user = await this.users.resolve(req);
      if (user?.id) {
        userId = user.id;
        plan = await this.plans.getEffectivePlan(user.id);
      }
    } catch {
      // Unauthenticated callers receive public/free announcements.
    }

    return this.announcements.listPublished(plan, query.category, query.limit, query.offset, userId);
  }

  @Post(':id/read')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard)
  @Protect('default')
  markRead(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.announcements.markRead(userId, id);
  }

  @Get('admin/all')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('read')
  async listAdmin(
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.announcements.listAdmin(status, limit, offset);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('default')
  create(@CurrentUserId() adminId: string, @Body() dto: CreateAnnouncementBodyDto) {
    return this.announcements.create(dto, adminId, true);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('default')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementBodyDto) {
    return this.announcements.update(id, dto);
  }

  @Post(':id/publish')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('default')
  publish(@Param('id') id: string, @CurrentUserId() adminId: string) {
    return this.announcements.publish(id, adminId);
  }
}
