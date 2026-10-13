import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { GeminiService } from './gemini.service';
import { OpenAiCompatibleService } from './openai-compatible.service';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { GroqSpeechService } from './groq-speech.service';
import { AiController } from './ai.controller';
@Module({
  imports: [PlansModule],
  providers: [GeminiService, OpenAiCompatibleService, AiOrchestratorService, GroqSpeechService],
  controllers: [AiController],
  exports: [GeminiService, AiOrchestratorService, GroqSpeechService],
})
export class AiModule {}
