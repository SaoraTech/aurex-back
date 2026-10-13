import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { AiModule } from '../ai/ai.module';
import { PlansModule } from '../plans/plans.module';
import { ResearchModule } from '../research/research.module';
@Module({ imports: [ConversationsModule, AiModule, PlansModule, ResearchModule], controllers: [ChatController], providers: [ChatService] })
export class ChatModule {}
