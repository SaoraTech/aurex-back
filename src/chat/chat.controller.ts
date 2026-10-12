import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId } from '../common/user.decorator';
import { ChatService } from './chat.service';

class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(100) conversationId?: string;
  @IsString() @MinLength(1) @MaxLength(20000) content!: string;
  @IsOptional() @IsString() @MaxLength(120) requestId?: string;
  @IsOptional() @IsString() @MaxLength(40) model?: 'kimi'|'qwen'|'deepseek'|'grok'|'gemini'|'groq';
}
@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post('messages')
  send(@CurrentUserId() userId: string, @Body() dto: SendMessageDto) { return this.chat.send(userId, dto); }
}
