import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { PlansService } from '../plans/plans.service';
import { Protect } from '../security/protect.decorator';
import { QuotasService } from './quotas.service';

const MONITORED_FEATURES = [
  'document_analysis',
  'image_analysis',
  'exercise_photo_analysis',
  'math_compute',
];

@ApiTags('quotas')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('quotas')
export class QuotasController {
  constructor(
    private readonly quotas: QuotasService,
    private readonly plans: PlansService,
  ) {}

  @Get('status')
  @Protect('read')
  async getAllStatus(@CurrentUserId() userId: string) {
    const plan = await this.plans.getEffectivePlan(userId);
    const statuses = await Promise.all(
      MONITORED_FEATURES.map(f => this.quotas.getStatus(userId, plan, f)),
    );
    return { plan, features: statuses };
  }

  @Get(':feature')
  @Protect('read')
  async getFeatureStatus(
    @CurrentUserId() userId: string,
    @Param('feature') feature: string,
  ) {
    const plan = await this.plans.getEffectivePlan(userId);
    return this.quotas.getStatus(userId, plan, feature);
  }
}
