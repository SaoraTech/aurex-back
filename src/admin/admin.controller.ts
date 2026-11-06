import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireAdminGuard } from '../auth/require-admin.guard';
import { RequireUserGuard } from '../auth/require-user.guard';
import { Protect } from '../security/protect.decorator';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(RequireUserGuard, RequireAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  @Protect('read')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('audit-events')
  @Protect('read')
  auditEvents(
    @Query('action') action?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('targetType') targetType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listAuditEvents(action, actorUserId, targetType, limit, offset);
  }

  @Get('publications')
  @Protect('read')
  publications(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listPublications(status, limit, offset);
  }

  @Get('billing/payments')
  @Protect('read')
  payments(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listPayments(status, limit, offset);
  }

  @Get('billing/subscriptions')
  @Protect('read')
  subscriptions(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listSubscriptions(status, limit, offset);
  }

  @Get('notifications/deliveries')
  @Protect('read')
  notificationDeliveries(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.listNotificationDeliveries(status, category, limit, offset);
  }

  @Get('notifications/summary')
  @Protect('read')
  notificationSummary() {
    return this.admin.notificationSummary();
  }

  @Get('settings')
  @Protect('read')
  settings() {
    return this.admin.getSettingsStatus();
  }
}
