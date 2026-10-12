import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { AiModule } from '../ai/ai.module';
import { MathModule } from '../math/math.module';
import { PlansModule } from '../plans/plans.module';
@Module({ imports: [ConversationsModule, AiModule, MathModule, PlansModule], controllers: [ChatController], providers: [ChatService] })
export class ChatModule {}
