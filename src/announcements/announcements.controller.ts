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
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { RequireUserGuard } from '../auth/require-user.guard';
import { RequireAdminGuard } from '../auth/require-admin.guard';
import { CurrentUserId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { PlansService } from '../plans/plans.service';
import { AnnouncementsService } from './announcements.service';
import {
  AnnouncementCategory,
  PublicationMode,
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
  @IsIn(['manual', 'automatic', 'hybrid'])
  publicationMode?: PublicationMode;

  @IsOptional()
  @IsBoolean()
  autoPublish?: boolean;
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
}

class PublishBodyDto {
  @IsOptional()
  @IsBoolean()
  sendNotification?: boolean;
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

  /**
   * Public / Authenticated route to consult published announcements.
   * Tailored to user plan if logged in, or generic ('free') if anonymous.
   */
  @Get()
  @Protect('read')
  async listPublished(@Req() req: any, @Query() query: ListAnnouncementsQueryDto) {
    let plan = 'free';
    try {
      const user = await this.users.resolve(req);
      if (user?.id) {
        plan = await this.plans.getEffectivePlan(user.id);
      }
    } catch {
      // Unauthenticated callers receive public/free announcements
    }

    return this.announcements.listPublished(plan, query.category, query.limit, query.offset);
  }

  /**
   * Admin route: List all announcements across statuses.
   */
  @Get('admin/all')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('read')
  async listAdmin(@Query('status') status?: string, @Query('limit') limit?: number, @Query('offset') offset?: number) {
    return this.announcements.listAdmin(status, limit, offset);
  }

  /**
   * Admin route: Create an announcement.
   */
  @Post()
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('default')
  async create(@CurrentUserId() adminId: string, @Body() dto: CreateAnnouncementBodyDto) {
    return this.announcements.create(dto, adminId, true);
  }

  /**
   * Admin route: Update an unpublished announcement.
   */
  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('default')
  async update(@Param('id') id: string, @Body() dto: UpdateAnnouncementBodyDto) {
    return this.announcements.update(id, dto);
  }

  /**
   * Admin route: Publish an announcement and optionally notify subscribers via Novu.
   */
  @Post(':id/publish')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard, RequireAdminGuard)
  @Protect('default')
  async publish(
    @Param('id') id: string,
    @CurrentUserId() adminId: string,
    @Body() body: PublishBodyDto,
  ) {
    return this.announcements.publish(id, body, adminId);
  }
}
