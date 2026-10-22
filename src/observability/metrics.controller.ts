import { Controller, Get, Headers, Header, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { notFound, AppException } from '../common/errors';
import { Protect } from '../security/protect.decorator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { MetricsService } from './metrics.service';
import { UsageService } from './usage.service';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly usage: UsageService,
    private readonly config: ConfigService,
  ) {}

  /** Disabled (404) unless METRICS_TOKEN is set; then requires `Authorization: Bearer <METRICS_TOKEN>`. */
  @Get()
  @Protect('exempt')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  scrape(@Headers('authorization') authorization?: string) {
    const token = this.config.get<string>('metricsToken');
    if (!token) throw notFound('NOT_FOUND', 'Not found');
    const given = (authorization ?? '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppException(401, 'UNAUTHENTICATED', 'Invalid metrics token');
    }
    return this.metrics.render();
  }

  /**
   * User-facing aggregated usage and cost estimation (without exposing private prompts or keys).
   */
  @Get('usage-summary')
  @ApiBearerAuth()
  @UseGuards(RequireUserGuard)
  @Protect('read')
  async getUserUsageSummary(@CurrentUserId() userId: string) {
    const items = await this.usage.getUserUsageSummary(userId);
    const totalEstimatedCostUsd = items.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0);
    return {
      userId,
      items,
      totalEstimatedCostUsd: Math.round(totalEstimatedCostUsd * 1000) / 1000,
      currency: 'USD',
    };
  }
}
