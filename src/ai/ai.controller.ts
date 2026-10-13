import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { PlansService } from '../plans/plans.service';
import { Protect } from '../security/protect.decorator';
import { AiOrchestratorService } from './ai-orchestrator.service';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly plans: PlansService, private readonly ai: AiOrchestratorService) {}
  @Get('models') @Protect('read')
  async models(@CurrentUserId() userId: string) {
    const plan = await this.plans.getEffectivePlan(userId);
    return { plan, models: this.ai.listModels(plan) };
  }
}
