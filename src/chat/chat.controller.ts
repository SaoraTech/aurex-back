import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { ChatService } from './chat.service';

class SendMessageDto {
  @IsOptional() @IsString() @MaxLength(100) conversationId?: string;
  @IsString() @MinLength(1) @MaxLength(20000) content!: string;
  /** Client idempotency key: replaying the same key in a conversation returns the stored answer. */
  @IsOptional() @IsString() @MaxLength(120) requestId?: string;
  @IsOptional() @IsIn(['kimi', 'qwen', 'deepseek', 'grok', 'gemini', 'groq']) model?: 'kimi' | 'qwen' | 'deepseek' | 'grok' | 'gemini' | 'groq';
  /** 'off' (default) | 'on' (search the web for this turn) | 'auto' (only on explicit recency/lookup cues). */
  @IsOptional() @IsIn(['off', 'on', 'auto']) webSearch?: 'off' | 'on' | 'auto';
}
@ApiTags('chat') @ApiBearerAuth() @UseGuards(RequireUserGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post('messages') @Protect('chat')
  send(@CurrentUserId() userId: string, @RequestId() rid: string, @Body() dto: SendMessageDto) { return this.chat.send(userId, dto, rid); }
}
