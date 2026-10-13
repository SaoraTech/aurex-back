import { Controller, Get, Headers, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { notFound, AppException } from '../common/errors';
import { Protect } from '../security/protect.decorator';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService, private readonly config: ConfigService) {}

  /** Disabled (404) unless METRICS_TOKEN is set; then requires `Authorization: Bearer <METRICS_TOKEN>`. */
  @Get()
  @Protect('exempt')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  scrape(@Headers('authorization') authorization?: string) {
    const token = this.config.get<string>('metricsToken');
    if (!token) throw notFound('NOT_FOUND', 'Not found');
    const given = (authorization ?? '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(given); const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppException(401, 'UNAUTHENTICATED', 'Invalid metrics token');
    return this.metrics.render();
  }
}
