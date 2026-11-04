import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RequireUserGuard } from '../auth/require-user.guard';
import { CurrentUserId, RequestId } from '../common/user.decorator';
import { Protect } from '../security/protect.decorator';
import { ChatService } from './chat.service';

class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  conversationId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  requestId?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(['off', 'on', 'auto'])
  webSearch?: 'off' | 'on' | 'auto';
}

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(RequireUserGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('messages')
  @Protect('chat')
  send(@CurrentUserId() userId: string, @RequestId() rid: string, @Body() dto: SendMessageDto) {
    const { model: _ignored, ...rest } = dto;
    return this.chat.send(userId, { ...rest, model: 'groq' }, rid);
  }
}
