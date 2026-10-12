import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, eq, gte } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DRIZZLE } from '../db/db.constants';
import { subscription } from '../db/schema';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { AiOrchestratorService } from './ai-orchestrator.service';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('ai')
export class AiController {
  constructor(@Inject(DRIZZLE) private readonly db: any, private readonly ai: AiOrchestratorService) {}
  @Get('models')
  async models(@CurrentUserId() userId: string) {
    const now = new Date();
    const rows = await this.db.select({ plan: subscription.plan }).from(subscription)
      .where(and(eq(subscription.userId, userId), eq(subscription.status, 'active'), gte(subscription.currentPeriodEnd, now)))
      .orderBy(subscription.updatedAt).limit(1);
    const plan = rows[0]?.plan === 'plus' || rows[0]?.plan === 'pro' ? rows[0].plan : 'free';
    return { plan, models: this.ai.listModels(plan) };
  }
}
