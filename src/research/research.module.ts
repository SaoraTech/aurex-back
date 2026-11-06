import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PlansModule } from '../plans/plans.module';
import { QuotasModule } from '../quotas/quotas.module';
import { ResearchController } from './research.controller';
import { BraveSearchService } from './brave-search.service';
import { WebResearchService } from './web-research.service';

@Module({
  imports: [AiModule, PlansModule, QuotasModule, ObservabilityModule],
  controllers: [ResearchController],
  providers: [BraveSearchService, WebResearchService],
  exports: [WebResearchService],
})
export class ResearchModule {}
