import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import { MathModule } from '../math/math.module';
import { ObservabilityModule } from '../observability/observability.module';
import { PlansModule } from '../plans/plans.module';
import { QuotasModule } from '../quotas/quotas.module';
import { ResearchModule } from '../research/research.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [
    AiModule,
    ConversationsModule,
    IdentityModule,
    MathModule,
    ObservabilityModule,
    PlansModule,
    QuotasModule,
    ResearchModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
