import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { UsageService } from './usage.service';
import { MetricsController } from './metrics.controller';

@Global()
@Module({ providers: [MetricsService, UsageService], controllers: [MetricsController], exports: [MetricsService, UsageService] })
export class ObservabilityModule {}
