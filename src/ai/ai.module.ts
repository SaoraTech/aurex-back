import { Module } from '@nestjs/common';
import { ObservabilityModule } from '../observability/observability.module';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { GroqLlmService } from './groq-llm.service';

@Module({
  imports: [ObservabilityModule],
  providers: [GroqLlmService, AiOrchestratorService],
  exports: [GroqLlmService, AiOrchestratorService],
})
export class AiModule {}
