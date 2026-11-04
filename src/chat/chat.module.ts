import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { IdentityModule } from '../identity/identity.module';
import { MathModule } from '../math/math.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PlansModule } from '../plans/plans.module';
import { ResearchModule } from '../research/research.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [AiModule, IdentityModule, MathModule, ObservabilityModule, PlansModule, ResearchModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
